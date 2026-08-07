// Root Cause Analysis — camada de I/O. Cria classificações de causa, detecta recorrência
// (abrindo uma sessão de 5 Porquês quando o limiar configurado é atingido), gerencia
// evidências (Storage privado) e serve as visões de Pareto/agrupamento do dashboard.
//
// rca_records referencia a divergência de origem de forma polimórfica (source_module +
// source_item_id) — de propósito, para não precisar de FK cruzando inventory_count_import_items
// / full_operation_items / nfe_invoice_items, três tabelas de módulos que já funcionam e não
// devem ser alteradas por este módulo.

import { supabase } from './supabase';
import type {
  RcaRecord, RcaEvidence, RcaFiveWhysSession, RcaFiveWhysAnswer, RcaSettings,
  RcaSourceModule, RcaCauseCategory,
} from './supabase';
import { logAuditEvent } from './auditLogService';
import { checkRecurrence, computeParetoBuckets, groupByDimension, computeTrend, type ParetoBucket, type DimensionBucket, type RcaDimension, type TrendResult } from './rcaAlgorithm';

const EVIDENCE_BUCKET = 'rca-evidence';
const DEFAULT_THRESHOLD_COUNT = 3;
const DEFAULT_WINDOW_DAYS = 30;

export interface RcaClassificationInput {
  sourceModule: RcaSourceModule;
  sourceItemId: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  location: string | null;
  operatorUserId: string | null;
  operatorName: string | null;
  supplierName?: string | null;
  supplierCnpj?: string | null;
  divergenceQty: number;
  causeCategory: RcaCauseCategory;
  customCauseLabel?: string | null;
  notes?: string | null;
  occurredAt?: string;
}

export interface RcaFilters {
  from?: string;
  to?: string;
  causeCategory?: RcaCauseCategory;
  sku?: string;
  operatorName?: string;
  location?: string;
  supplierName?: string;
  recurringOnly?: boolean;
}

function applyFilters(query: any, filters?: RcaFilters) {
  if (!filters) return query;
  if (filters.from) query = query.gte('occurred_at', filters.from);
  if (filters.to) query = query.lte('occurred_at', filters.to);
  if (filters.causeCategory) query = query.eq('cause_category', filters.causeCategory);
  if (filters.sku) query = query.ilike('sku', `%${filters.sku}%`);
  if (filters.operatorName) query = query.ilike('operator_name', `%${filters.operatorName}%`);
  if (filters.location) query = query.ilike('location', `%${filters.location}%`);
  if (filters.supplierName) query = query.ilike('supplier_name', `%${filters.supplierName}%`);
  return query;
}

export async function getSettings(companyId: string): Promise<RcaSettings> {
  const { data, error } = await supabase.from('rca_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (error) console.error('[RCA] Error loading settings:', error);
  return (data as RcaSettings | null) ?? {
    company_id: companyId,
    recurrence_threshold_count: DEFAULT_THRESHOLD_COUNT,
    recurrence_window_days: DEFAULT_WINDOW_DAYS,
    updated_at: new Date().toISOString(),
  };
}

export async function updateSettings(
  companyId: string,
  settings: { thresholdCount: number; windowDays: number },
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.from('rca_settings').upsert({
    company_id: companyId,
    recurrence_threshold_count: settings.thresholdCount,
    recurrence_window_days: settings.windowDays,
    updated_at: new Date().toISOString(),
  });
  if (error) { console.error('[RCA] Error saving settings:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.settings_updated', resourceType: 'rca_settings', metadata: settings });
}

/** Cria a classificação e, em seguida, verifica recorrência (mesmo SKU ou mesma causa
 *  dentro da janela configurada). Se o limiar for atingido e ainda não houver uma sessão
 *  de 5 Porquês aberta para essa chave, abre uma automaticamente. */
export async function createRcaRecord(
  input: RcaClassificationInput,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<RcaRecord | null> {
  const { data: record, error } = await supabase
    .from('rca_records')
    .insert({
      company_id: companyId,
      source_module: input.sourceModule,
      source_item_id: input.sourceItemId,
      product_id: input.productId,
      sku: input.sku,
      product_name: input.productName,
      location: input.location,
      operator_user_id: input.operatorUserId,
      operator_name: input.operatorName,
      supplier_name: input.supplierName ?? null,
      supplier_cnpj: input.supplierCnpj ?? null,
      divergence_qty: input.divergenceQty,
      cause_category: input.causeCategory,
      custom_cause_label: input.causeCategory === 'outro' ? (input.customCauseLabel ?? null) : null,
      notes: input.notes ?? null,
      classified_by: userId,
      classified_by_email: userEmail,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (error || !record) { console.error('[RCA] Error creating record:', error); return null; }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'rca.divergence_classified',
    resourceType: 'rca_record', resourceId: record.id,
    metadata: { sourceModule: input.sourceModule, causeCategory: input.causeCategory, sku: input.sku },
  });

  await checkAndOpenFiveWhys(record as RcaRecord, companyId, userId, userEmail);
  return record as RcaRecord;
}

async function checkAndOpenFiveWhys(record: RcaRecord, companyId: string, userId: string, userEmail: string): Promise<void> {
  const settings = await getSettings(companyId);
  const since = new Date(Date.now() - settings.recurrence_window_days * 86400000).toISOString();

  const { data, error } = await supabase
    .from('rca_records')
    .select('*')
    .eq('company_id', companyId)
    .gte('occurred_at', since);
  if (error) { console.error('[RCA] Error checking recurrence:', error); return; }

  const recurrence = checkRecurrence(data as RcaRecord[], record, settings.recurrence_threshold_count);

  const triggers: { type: 'sku' | 'cause_category'; key: string; count: number }[] = [];
  if (recurrence.skuRecurrence && record.sku) triggers.push({ type: 'sku', key: record.sku, count: recurrence.skuOccurrenceCount });
  if (recurrence.causeRecurrence) triggers.push({ type: 'cause_category', key: record.cause_category, count: recurrence.causeOccurrenceCount });

  for (const trigger of triggers) {
    const { data: existing } = await supabase
      .from('rca_five_whys_sessions')
      .select('id')
      .eq('company_id', companyId)
      .eq('trigger_type', trigger.type)
      .eq('trigger_key', trigger.key)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) continue;

    const { data: session, error: sessionError } = await supabase
      .from('rca_five_whys_sessions')
      .insert({
        company_id: companyId,
        trigger_type: trigger.type,
        trigger_key: trigger.key,
        trigger_rca_record_id: record.id,
        occurrence_count: trigger.count,
        window_days: settings.recurrence_window_days,
      })
      .select()
      .maybeSingle();
    if (sessionError || !session) { console.error('[RCA] Error opening 5-whys session:', sessionError); continue; }

    await logAuditEvent({
      companyId, userId, userEmail, action: 'rca.five_whys_opened',
      resourceType: 'rca_five_whys_session', resourceId: session.id,
      metadata: { triggerType: trigger.type, triggerKey: trigger.key, occurrenceCount: trigger.count },
    });
  }
}

export async function listRecords(companyId: string, filters?: RcaFilters): Promise<RcaRecord[]> {
  let query = supabase.from('rca_records').select('*').eq('company_id', companyId).order('occurred_at', { ascending: false });
  query = applyFilters(query, filters);
  const { data, error } = await query;
  if (error) { console.error('[RCA] Error listing records:', error); return []; }
  const records = data as RcaRecord[];
  if (!filters?.recurringOnly) return records;

  const skuCounts = new Map<string, number>();
  for (const r of records) if (r.sku) skuCounts.set(r.sku, (skuCounts.get(r.sku) ?? 0) + 1);
  return records.filter(r => r.sku && (skuCounts.get(r.sku) ?? 0) > 1);
}

export async function getParetoSummary(companyId: string, filters?: RcaFilters): Promise<ParetoBucket[]> {
  return computeParetoBuckets(await listRecords(companyId, filters));
}

export async function getCauseBreakdown(companyId: string, dimension: RcaDimension, filters?: RcaFilters): Promise<DimensionBucket[]> {
  return groupByDimension(await listRecords(companyId, filters), dimension);
}

export interface RcaTrendPoint {
  period: string;
  count: number;
}

export async function getTrend(companyId: string, days = 90): Promise<RcaTrendPoint[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const records = await listRecords(companyId, { from: since });
  const byDay = new Map<string, number>();
  for (const r of records) {
    const day = r.occurred_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([period, count]) => ({ period, count }));
}

/** Para a Análise de Tendência (Auditoria de Estoque): carrega os registros do período e
 *  isola a série + classificação de um valor específico de dimensão (ex.: uma rua, um
 *  operador). `days` largo por padrão (180) para dar duas metades de janela com volume. */
export async function getTrendForDimensionValue(
  companyId: string,
  dimension: RcaDimension,
  key: string,
  label: string,
  days = 180
): Promise<TrendResult> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const records = await listRecords(companyId, { from: since });
  return computeTrend(records, dimension, key, label);
}

/** Storage privado — mesma estratégia de signed URL sob demanda do FloorPlanBackground
 *  (src/lib/slottingLayoutService.ts): o path fica salvo, a URL de exibição é assinada e
 *  expira, então nunca é persistida junto com a evidência. */
export async function uploadEvidence(
  rcaRecordId: string,
  companyId: string,
  files: File[],
  userId: string
): Promise<RcaEvidence[]> {
  const uploaded: RcaEvidence[] = [];
  for (const file of files) {
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${companyId}/${rcaRecordId}-${Date.now()}-${uploaded.length}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file);
    if (uploadError) { console.error('[RCA] Error uploading evidence:', uploadError); continue; }

    const { data, error } = await supabase
      .from('rca_evidence')
      .insert({ rca_record_id: rcaRecordId, company_id: companyId, file_path: path, file_name: file.name, uploaded_by: userId })
      .select()
      .maybeSingle();
    if (error || !data) { console.error('[RCA] Error saving evidence row:', error); continue; }
    uploaded.push(data as RcaEvidence);
  }
  return uploaded;
}

export async function getEvidenceForRecord(rcaRecordId: string, companyId: string): Promise<RcaEvidence[]> {
  const { data, error } = await supabase.from('rca_evidence').select('*').eq('rca_record_id', rcaRecordId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error loading evidence:', error); return []; }
  return data as RcaEvidence[];
}

export async function getEvidenceSignedUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(filePath, 3600);
  if (error) { console.error('[RCA] Error creating evidence signed URL:', error); return null; }
  return data.signedUrl;
}

export async function getOpenFiveWhysSessions(companyId: string): Promise<RcaFiveWhysSession[]> {
  const { data, error } = await supabase
    .from('rca_five_whys_sessions')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false });
  if (error) { console.error('[RCA] Error loading 5-whys sessions:', error); return []; }
  return data as RcaFiveWhysSession[];
}

export async function getFiveWhysAnswers(sessionId: string, companyId: string): Promise<RcaFiveWhysAnswer[]> {
  const { data, error } = await supabase
    .from('rca_five_whys_answers')
    .select('*')
    .eq('session_id', sessionId)
    .eq('company_id', companyId)
    .order('level', { ascending: true });
  if (error) { console.error('[RCA] Error loading 5-whys answers:', error); return []; }
  return data as RcaFiveWhysAnswer[];
}

export async function answerFiveWhys(
  sessionId: string,
  companyId: string,
  level: number,
  answer: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.from('rca_five_whys_answers').insert({
    session_id: sessionId, company_id: companyId, level, answer, answered_by: userId, answered_by_email: userEmail,
  });
  if (error) { console.error('[RCA] Error saving 5-whys answer:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.five_whys_answered', resourceType: 'rca_five_whys_session', resourceId: sessionId, metadata: { level } });
}

export async function completeFiveWhysSession(
  sessionId: string,
  companyId: string,
  rootCauseSummary: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase
    .from('rca_five_whys_sessions')
    .update({ status: 'completed', root_cause_summary: rootCauseSummary, completed_at: new Date().toISOString(), completed_by: userId })
    .eq('id', sessionId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error completing 5-whys session:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.five_whys_completed', resourceType: 'rca_five_whys_session', resourceId: sessionId });
}

// ── API de leitura pronta para integração futura (Risk Score / CBC / ABC+XYZ) ───────────────
// Só disponibiliza os dados — não altera as fórmulas de riskAlgorithm.ts/cbcAlgorithm.ts/
// abcXyzAlgorithm.ts, que continuam funcionando exatamente como antes deste módulo.

export async function getCauseCountsForProducts(productIds: string[], companyId: string): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('rca_records')
    .select('product_id')
    .eq('company_id', companyId)
    .in('product_id', productIds);
  if (error) { console.error('[RCA] Error loading cause counts:', error); return new Map(); }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.product_id) continue;
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }
  return counts;
}

export async function getDominantCauseForProduct(productId: string, companyId: string): Promise<RcaCauseCategory | null> {
  const { data, error } = await supabase
    .from('rca_records')
    .select('cause_category')
    .eq('company_id', companyId)
    .eq('product_id', productId);
  if (error || !data || data.length === 0) return null;

  const counts = new Map<RcaCauseCategory, number>();
  for (const row of data) counts.set(row.cause_category as RcaCauseCategory, (counts.get(row.cause_category as RcaCauseCategory) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}
