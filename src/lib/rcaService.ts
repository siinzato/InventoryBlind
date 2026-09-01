// Root Cause Analysis — camada de I/O. Cria a classificação inicial de cada divergência,
// escalona para Caso de RCA completo quando os critérios do workspace são atingidos,
// conduz a cadeia dos Porquês de profundidade variável, o plano de ação (que se apoia no
// módulo de Tarefas já existente) e a verificação de eficácia, além de servir as visões de
// Pareto/cobertura/fila do dashboard.
//
// rca_records referencia a divergência de origem de forma polimórfica (source_module +
// source_item_id, sem FK) — de propósito, para não precisar de FK cruzando
// inventory_count_import_items / full_operation_items / nfe_invoice_items, três tabelas de
// módulos que já funcionam e não devem ser alteradas por este módulo.

import { supabase } from './supabase';
import type {
  RcaRecord, RcaEvidence, RcaEvidenceType, RcaFiveWhysSession, RcaFiveWhysAnswer, RcaSettings,
  RcaSourceModule, RcaCauseCategory, RcaProcessArea, RcaSeverity,
  RcaCauseCategoryRow, RcaCauseSubcauseRow, RcaCase, RcaCaseStatus, RcaCaseWhyStep, RcaWhyStepRole,
  RcaCaseAction, RcaActionType, RcaVerificationResult,
} from './supabase';
import { logAuditEvent } from './auditLogService';
import { createTask } from './tasks/taskService';
import {
  computeParetoBuckets, groupByDimension, computeTrend, type ParetoBucket, type DimensionBucket, type RcaDimension, type TrendResult,
  DEFAULT_CAUSE_CATEGORIES, DEFAULT_SUBCAUSES, evaluateEscalation, groupByRecurrenceSignature, countRecurrenceForRecord,
  type EscalationReason,
} from './rcaAlgorithm';

const EVIDENCE_BUCKET = 'rca-evidence';
const EVIDENCE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const EVIDENCE_MAX_SIZE_BYTES = 15 * 1024 * 1024;
const DEFAULT_THRESHOLD_COUNT = 3;
const DEFAULT_WINDOW_DAYS = 60;

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
  processArea: RcaProcessArea;
  causeCategory: RcaCauseCategory;
  subcauseCode?: string | null;
  customCauseLabel?: string | null;
  severity: RcaSeverity;
  containmentNeeded?: boolean;
  knownRecurrence?: boolean;
  manualEscalation?: boolean;
  financialImpact?: number | null;
  notes?: string | null;
  occurredAt?: string;
}

export interface RcaFilters {
  from?: string;
  to?: string;
  causeCategory?: RcaCauseCategory;
  processArea?: RcaProcessArea;
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
  if (filters.processArea) query = query.eq('process_area', filters.processArea);
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
    financial_impact_threshold: null,
    updated_at: new Date().toISOString(),
  };
}

export async function updateSettings(
  companyId: string,
  settings: { thresholdCount: number; windowDays: number; financialImpactThreshold: number | null },
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.from('rca_settings').upsert({
    company_id: companyId,
    recurrence_threshold_count: settings.thresholdCount,
    recurrence_window_days: settings.windowDays,
    financial_impact_threshold: settings.financialImpactThreshold,
    updated_at: new Date().toISOString(),
  });
  if (error) { console.error('[RCA] Error saving settings:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.settings_updated', resourceType: 'rca_settings', metadata: settings });
}

// ── Taxonomia de causa (configurável por workspace, padrões fornecidos a todos) ──────────

export interface RcaTaxonomyCategory {
  code: string;
  label: string;
  isDefault: boolean;
  isActive: boolean;
  subcauses: { code: string; label: string; isDefault: boolean; isActive: boolean }[];
}

/** Mescla os padrões hardcoded com overrides da empresa (desativação de padrão ou
 *  categoria/subcausa customizada) — mesmo espírito de getSettings: nunca exige linha no
 *  banco para uma empresa que só usa os padrões. */
export async function getCauseTaxonomy(companyId: string): Promise<RcaTaxonomyCategory[]> {
  const [{ data: categoryRows, error: catError }, { data: subcauseRows, error: subError }] = await Promise.all([
    supabase.from('rca_cause_categories').select('*').eq('company_id', companyId),
    supabase.from('rca_cause_subcauses').select('*').eq('company_id', companyId),
  ]);
  if (catError) console.error('[RCA] Error loading cause categories:', catError);
  if (subError) console.error('[RCA] Error loading cause subcauses:', subError);

  const categoryOverrides = new Map((categoryRows as RcaCauseCategoryRow[] | null ?? []).map(r => [r.code, r]));
  const customCategories = (categoryRows as RcaCauseCategoryRow[] | null ?? []).filter(r => !r.is_default);
  const subcauseOverrides = new Map((subcauseRows as RcaCauseSubcauseRow[] | null ?? []).map(r => [`${r.category_code}:${r.code}`, r]));

  const codes = [...DEFAULT_CAUSE_CATEGORIES.map(c => c.value), ...customCategories.map(c => c.code)];

  return codes.map(code => {
    const defaultDef = DEFAULT_CAUSE_CATEGORIES.find(c => c.value === code);
    const override = categoryOverrides.get(code);
    const label = override?.label ?? defaultDef?.label ?? code;
    const isActive = override ? override.is_active : true;

    const defaultSubcauses = DEFAULT_SUBCAUSES[code] ?? [];
    const customSubcauses = (subcauseRows as RcaCauseSubcauseRow[] | null ?? []).filter(s => s.category_code === code && !s.is_default);
    const subcauseCodes = [...defaultSubcauses.map(s => s.value), ...customSubcauses.map(s => s.code)];

    return {
      code,
      label,
      isDefault: !defaultDef ? false : true,
      isActive,
      subcauses: subcauseCodes.map(subCode => {
        const defaultSub = defaultSubcauses.find(s => s.value === subCode);
        const subOverride = subcauseOverrides.get(`${code}:${subCode}`);
        return {
          code: subCode,
          label: subOverride?.label ?? defaultSub?.label ?? subCode,
          isDefault: !!defaultSub,
          isActive: subOverride ? subOverride.is_active : true,
        };
      }),
    };
  });
}

export async function setCauseCategoryActive(companyId: string, code: string, label: string, isDefault: boolean, isActive: boolean, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('rca_cause_categories').upsert({ company_id: companyId, code, label, is_default: isDefault, is_active: isActive }, { onConflict: 'company_id,code' });
  if (error) { console.error('[RCA] Error updating cause category:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.taxonomy_updated', resourceType: 'rca_cause_categories', metadata: { code, isActive } });
}

export async function setCauseSubcauseActive(companyId: string, categoryCode: string, code: string, label: string, isDefault: boolean, isActive: boolean, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('rca_cause_subcauses').upsert({ company_id: companyId, category_code: categoryCode, code, label, is_default: isDefault, is_active: isActive }, { onConflict: 'company_id,category_code,code' });
  if (error) { console.error('[RCA] Error updating cause subcause:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.taxonomy_updated', resourceType: 'rca_cause_subcauses', metadata: { categoryCode, code, isActive } });
}

// ── Classificação inicial ────────────────────────────────────────────────────────────────

/** Cria a classificação inicial e, se os critérios de escalonamento do workspace forem
 *  atingidos, abre automaticamente um Caso de RCA completo (rca_cases) — substitui o antigo
 *  auto-abertura de sessão de "5 Porquês" por recorrência simples de SKU/categoria. */
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
      process_area: input.processArea,
      cause_category: input.causeCategory,
      subcause_code: input.subcauseCode ?? null,
      custom_cause_label: input.causeCategory === 'outro' ? (input.customCauseLabel ?? null) : null,
      severity: input.severity,
      classification_status: 'classified',
      containment_needed: input.containmentNeeded ?? false,
      known_recurrence: input.knownRecurrence ?? false,
      manual_escalation: input.manualEscalation ?? false,
      financial_impact: input.financialImpact ?? null,
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
    metadata: { sourceModule: input.sourceModule, processArea: input.processArea, causeCategory: input.causeCategory, sku: input.sku },
  });

  await evaluateAndOpenCase(record as RcaRecord, companyId, userId, userEmail);
  return record as RcaRecord;
}

/** "Classificar depois" — mantém a divergência rastreável (fila de regularização) sem
 *  exigir causa completa agora. Nunca fabrica causa. */
export async function createPendingClassification(
  sourceModule: RcaSourceModule,
  item: { sourceItemId: string; productId: string | null; sku: string | null; productName: string | null; location: string | null; operatorUserId: string | null; operatorName: string | null; supplierName?: string | null; supplierCnpj?: string | null; divergenceQty: number; occurredAt?: string },
  companyId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.from('rca_records').insert({
    company_id: companyId,
    source_module: sourceModule,
    source_item_id: item.sourceItemId,
    product_id: item.productId,
    sku: item.sku,
    product_name: item.productName,
    location: item.location,
    operator_user_id: item.operatorUserId,
    operator_name: item.operatorName,
    supplier_name: item.supplierName ?? null,
    supplier_cnpj: item.supplierCnpj ?? null,
    divergence_qty: item.divergenceQty,
    classification_status: 'pending',
    classified_by: userId,
    classified_by_email: userEmail,
    occurred_at: item.occurredAt ?? new Date().toISOString(),
  });
  if (error) { console.error('[RCA] Error creating pending classification:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.classification_pending', resourceType: 'rca_record', metadata: { sourceModule, sourceItemId: item.sourceItemId } });
}

async function evaluateAndOpenCase(record: RcaRecord, companyId: string, userId: string, userEmail: string): Promise<void> {
  const settings = await getSettings(companyId);
  const since = new Date(Date.now() - settings.recurrence_window_days * 86400000).toISOString();

  const { data, error } = await supabase
    .from('rca_records')
    .select('*')
    .eq('company_id', companyId)
    .eq('classification_status', 'classified')
    .gte('occurred_at', since);
  if (error) { console.error('[RCA] Error checking recurrence:', error); return; }

  const recentRecords = data as RcaRecord[];
  const recurrenceCount = countRecurrenceForRecord(record, recentRecords, settings.recurrence_window_days);

  const escalation = evaluateEscalation(
    {
      severity: record.severity,
      financialImpact: record.financial_impact,
      controlFailure: record.cause_category === 'controle_governanca',
      manualEscalation: record.manual_escalation,
      recurrenceCount,
    },
    { recurrenceThresholdCount: settings.recurrence_threshold_count, financialImpactThreshold: settings.financial_impact_threshold }
  );
  if (!escalation.shouldEscalate) return;

  // Mesma assinatura de recorrência já com um caso aberto? Agrupa em vez de duplicar.
  const groups = groupByRecurrenceSignature(recentRecords, settings.recurrence_window_days);
  const sameGroup = Array.from(groups.values()).find(g => g.some(r => (r as RcaRecord).id === record.id));
  const linkedCaseId = sameGroup?.map(r => (r as RcaRecord).rca_case_id).find(id => !!id) ?? null;

  if (linkedCaseId) {
    await linkDivergenceToCase(linkedCaseId, record.id, companyId, userId);
    return;
  }

  await openRcaCase(record, escalation.reasons, companyId, userId, userEmail);
}

// ── Caso de RCA ───────────────────────────────────────────────────────────────────────────

async function openRcaCase(record: RcaRecord, reasons: EscalationReason[], companyId: string, userId: string, userEmail: string): Promise<RcaCase | null> {
  const year = new Date().getFullYear();
  const { data: caseNumber, error: numberError } = await supabase.rpc('rca_next_case_number', { p_company_id: companyId, p_year: year });
  if (numberError || caseNumber == null) { console.error('[RCA] Error generating case number:', numberError); return null; }

  const { data: rcaCase, error } = await supabase
    .from('rca_cases')
    .insert({
      company_id: companyId,
      case_number: caseNumber,
      case_year: year,
      status: 'rascunho',
      severity: record.severity,
      process_area: record.process_area,
      cause_category: record.cause_category,
      subcause_code: record.subcause_code,
      problem_what: record.product_name ? `Divergência de ${record.divergence_qty > 0 ? '+' : ''}${record.divergence_qty} em ${record.product_name}` : `Divergência de ${record.divergence_qty > 0 ? '+' : ''}${record.divergence_qty}`,
      problem_where: record.location,
      problem_when: record.occurred_at,
      problem_impact_qty: record.divergence_qty,
      financial_impact: record.financial_impact,
      escalation_reasons: reasons,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error || !rcaCase) { console.error('[RCA] Error opening case:', error); return null; }

  await supabase.from('rca_records').update({ rca_case_id: rcaCase.id }).eq('id', record.id);
  await supabase.from('rca_case_divergence_links').insert({ case_id: rcaCase.id, rca_record_id: record.id, company_id: companyId, linked_by: userId });

  if (record.containment_needed) {
    await createCaseAction(rcaCase.id, 'contencao', { title: `Contenção — ${record.location ?? record.sku ?? 'divergência'}`, responsibleUserId: userId, dueDate: null, effectivenessCriteria: null }, companyId, userId, userEmail);
  }

  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.case_opened', resourceType: 'rca_case', resourceId: rcaCase.id, metadata: { reasons } });
  return rcaCase as RcaCase;
}

export async function linkDivergenceToCase(caseId: string, rcaRecordId: string, companyId: string, userId: string): Promise<void> {
  await supabase.from('rca_case_divergence_links').upsert({ case_id: caseId, rca_record_id: rcaRecordId, company_id: companyId, linked_by: userId }, { onConflict: 'case_id,rca_record_id' });
  await supabase.from('rca_records').update({ rca_case_id: caseId }).eq('id', rcaRecordId);
}

export async function unlinkDivergenceFromCase(caseId: string, rcaRecordId: string, userId: string, userEmail: string, companyId: string): Promise<void> {
  const { error } = await supabase.from('rca_case_divergence_links').delete().eq('case_id', caseId).eq('rca_record_id', rcaRecordId);
  if (error) { console.error('[RCA] Error unlinking divergence:', error); return; }
  await supabase.from('rca_records').update({ rca_case_id: null }).eq('id', rcaRecordId).eq('rca_case_id', caseId);
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.case_status_changed', resourceType: 'rca_case', resourceId: caseId, metadata: { unlinkedRecord: rcaRecordId } });
}

export async function getCase(caseId: string, companyId: string): Promise<RcaCase | null> {
  const { data, error } = await supabase.from('rca_cases').select('*').eq('id', caseId).eq('company_id', companyId).maybeSingle();
  if (error) { console.error('[RCA] Error loading case:', error); return null; }
  return data as RcaCase | null;
}

export async function listCases(companyId: string, statuses?: RcaCaseStatus[]): Promise<RcaCase[]> {
  let query = supabase.from('rca_cases').select('*').eq('company_id', companyId).order('opened_at', { ascending: false });
  if (statuses && statuses.length > 0) query = query.in('status', statuses);
  const { data, error } = await query;
  if (error) { console.error('[RCA] Error listing cases:', error); return []; }
  return data as RcaCase[];
}

/** Contagem de divergências vinculadas por caso, para a coluna "Recorrências" da tabela
 *  "Casos que exigem atenção" sem uma consulta N+1 por linha. */
export async function getCaseDivergenceCounts(companyId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('rca_case_divergence_links').select('case_id').eq('company_id', companyId);
  if (error) { console.error('[RCA] Error counting case divergences:', error); return new Map(); }
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.case_id, (counts.get(row.case_id) ?? 0) + 1);
  return counts;
}

export async function getCaseDivergences(caseId: string, companyId: string): Promise<RcaRecord[]> {
  const { data: links, error: linkError } = await supabase.from('rca_case_divergence_links').select('rca_record_id').eq('case_id', caseId).eq('company_id', companyId);
  if (linkError || !links || links.length === 0) return [];
  const { data, error } = await supabase.from('rca_records').select('*').in('id', links.map(l => l.rca_record_id));
  if (error) { console.error('[RCA] Error loading case divergences:', error); return []; }
  return data as RcaRecord[];
}

export async function updateCaseProblem(
  caseId: string,
  companyId: string,
  fields: { problemWhat: string; problemWhere: string | null; problemWhen: string | null; problemImpactQty: number | null; problemExpectedPattern: string | null; problemObservedResult: string | null; financialImpact: number | null; ownerId: string | null; dueAt: string | null },
  userId: string
): Promise<void> {
  const { error } = await supabase.from('rca_cases').update({
    problem_what: fields.problemWhat,
    problem_where: fields.problemWhere,
    problem_when: fields.problemWhen,
    problem_impact_qty: fields.problemImpactQty,
    problem_expected_pattern: fields.problemExpectedPattern,
    problem_observed_result: fields.problemObservedResult,
    financial_impact: fields.financialImpact,
    owner_id: fields.ownerId,
    due_at: fields.dueAt,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', caseId).eq('company_id', companyId);
  if (error) console.error('[RCA] Error updating case problem:', error);
}

export async function setCaseStatus(caseId: string, companyId: string, status: RcaCaseStatus, userId: string, userEmail: string): Promise<void> {
  const { data: before } = await supabase.from('rca_cases').select('status').eq('id', caseId).maybeSingle();
  const { error } = await supabase.from('rca_cases').update({ status, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', caseId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error updating case status:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.case_status_changed', resourceType: 'rca_case', resourceId: caseId, metadata: { from: before?.status ?? null, to: status } });
}

export async function closeCase(caseId: string, companyId: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('rca_cases').update({ status: 'encerrado', closed_at: new Date().toISOString(), closed_by: userId }).eq('id', caseId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error closing case:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.case_closed', resourceType: 'rca_case', resourceId: caseId });
}

/** Verificação ineficaz reabre o caso — preserva toda a análise anterior (nunca apaga
 *  causa raiz/cadeia/ações já registradas). */
export async function reopenCase(caseId: string, companyId: string, reason: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('rca_cases').update({ status: 'ineficaz_reaberto', closed_at: null, closed_by: null, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', caseId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error reopening case:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.case_reopened', resourceType: 'rca_case', resourceId: caseId, metadata: { reason } });
}

// ── Cadeia dos Porquês (profundidade variável) ───────────────────────────────────────────

export async function getWhySteps(caseId: string, companyId: string): Promise<RcaCaseWhyStep[]> {
  const { data, error } = await supabase.from('rca_case_why_steps').select('*').eq('case_id', caseId).eq('company_id', companyId).order('order_index', { ascending: true });
  if (error) { console.error('[RCA] Error loading why steps:', error); return []; }
  return data as RcaCaseWhyStep[];
}

export async function addWhyStep(
  caseId: string, companyId: string,
  fields: { parentStepId: string | null; orderIndex: number; question?: string; answer: string; role: RcaWhyStepRole },
  userId: string, userEmail: string
): Promise<RcaCaseWhyStep | null> {
  const { data, error } = await supabase.from('rca_case_why_steps').insert({
    case_id: caseId, company_id: companyId, parent_step_id: fields.parentStepId, order_index: fields.orderIndex,
    question: fields.question ?? 'Por quê?', answer: fields.answer, role: fields.role,
    author_id: userId, author_email: userEmail,
  }).select().maybeSingle();
  if (error || !data) { console.error('[RCA] Error adding why step:', error); return null; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.why_step_added', resourceType: 'rca_case_why_step', resourceId: data.id, metadata: { caseId } });
  return data as RcaCaseWhyStep;
}

export async function updateWhyStep(stepId: string, companyId: string, answer: string, role: RcaWhyStepRole): Promise<void> {
  const { error } = await supabase.from('rca_case_why_steps').update({ answer, role, updated_at: new Date().toISOString() }).eq('id', stepId).eq('company_id', companyId);
  if (error) console.error('[RCA] Error updating why step:', error);
}

/** Remover só é permitido pela UI enquanto o caso não tiver causa raiz confirmada — a
 *  camada de serviço confia nessa checagem já feita pelo chamador (canConfirmRootCause /
 *  status do caso), mesmo padrão de outras ações sensíveis do módulo. */
export async function removeWhyStep(stepId: string, caseId: string, companyId: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('rca_case_why_steps').delete().eq('id', stepId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error removing why step:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.why_step_removed', resourceType: 'rca_case_why_step', resourceId: stepId, metadata: { caseId } });
}

export async function confirmRootCause(
  caseId: string, companyId: string,
  fields: { rootCauseText: string; justification: string; causeCategory: string; subcauseCode: string | null },
  userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase.from('rca_cases').update({
    root_cause_text: fields.rootCauseText,
    root_cause_status: 'confirmada',
    root_cause_confirmed_by: userId,
    root_cause_confirmed_at: new Date().toISOString(),
    root_cause_justification: fields.justification,
    cause_category: fields.causeCategory,
    subcause_code: fields.subcauseCode,
    status: 'plano_em_execucao',
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', caseId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error confirming root cause:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.root_cause_confirmed', resourceType: 'rca_case', resourceId: caseId });
}

// ── Plano de ação (apoiado no módulo de Tarefas existente) ───────────────────────────────

export interface ActionTaskSummary {
  status: string;
  dueDate: string | null;
  priority: string;
  assigneeName: string | null;
}

/** Leitura leve (sem os 6 joins de getTaskDetail) só do necessário para exibir
 *  responsável/prazo/status de cada ação do plano — reaproveita as tabelas de Tarefas
 *  já existentes em vez de duplicar campos no módulo de RCA. */
export async function getActionTaskSummaries(taskIds: string[]): Promise<Map<string, ActionTaskSummary>> {
  const ids = taskIds.filter(Boolean);
  if (ids.length === 0) return new Map();

  const [{ data: tasks, error: taskError }, { data: assignees, error: assigneeError }] = await Promise.all([
    supabase.from('tasks').select('id, status, due_date, priority').in('id', ids),
    supabase.from('task_assignees').select('task_id, user_id').in('task_id', ids),
  ]);
  if (taskError) console.error('[RCA] Error loading action tasks:', taskError);
  if (assigneeError) console.error('[RCA] Error loading action task assignees:', assigneeError);

  const userIds = Array.from(new Set((assignees ?? []).map(a => a.user_id)));
  const { data: profiles } = userIds.length > 0 ? await supabase.from('profiles').select('id, name, email').in('id', userIds) : { data: [] };
  const nameById = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email ?? null]));
  const assigneeByTask = new Map<string, string | null>();
  for (const a of assignees ?? []) if (!assigneeByTask.has(a.task_id)) assigneeByTask.set(a.task_id, nameById.get(a.user_id) ?? null);

  const result = new Map<string, ActionTaskSummary>();
  for (const t of tasks ?? []) {
    result.set(t.id, { status: t.status, dueDate: t.due_date, priority: t.priority, assigneeName: assigneeByTask.get(t.id) ?? null });
  }
  return result;
}

export async function getCaseActions(caseId: string, companyId: string): Promise<RcaCaseAction[]> {
  const { data, error } = await supabase.from('rca_case_actions').select('*').eq('case_id', caseId).eq('company_id', companyId).order('created_at', { ascending: true });
  if (error) { console.error('[RCA] Error loading case actions:', error); return []; }
  return data as RcaCaseAction[];
}

export async function createCaseAction(
  caseId: string,
  actionType: RcaActionType,
  fields: { title: string; description?: string; responsibleUserId: string; dueDate: string | null; effectivenessCriteria: string | null; observationWindowDays?: number | null; expectedResult?: string | null },
  companyId: string,
  userId: string,
  userEmail: string = ''
): Promise<RcaCaseAction | null> {
  const taskId = await createTask({
    type: 'corporate',
    title: fields.title,
    description: fields.description ?? null,
    category: 'Root Cause Analysis',
    priority: actionType === 'contencao' ? 'urgent' : 'high',
    due_date: fields.dueDate,
    due_time: null,
    assigneeIds: [fields.responsibleUserId],
    checklist: [],
  }).catch(err => { console.error('[RCA] Error creating linked task:', err); return null; });

  const { data, error } = await supabase.from('rca_case_actions').insert({
    case_id: caseId, company_id: companyId, action_type: actionType, task_id: taskId,
    effectiveness_criteria: fields.effectivenessCriteria,
    observation_window_days: fields.observationWindowDays ?? null,
    expected_result: fields.expectedResult ?? null,
    created_by: userId,
  }).select().maybeSingle();
  if (error || !data) { console.error('[RCA] Error creating case action:', error); return null; }

  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.action_created', resourceType: 'rca_case_action', resourceId: data.id, metadata: { caseId, actionType, taskId } });
  return data as RcaCaseAction;
}

export async function verifyCaseAction(
  actionId: string, companyId: string,
  fields: { observedResult: string; verificationResult: RcaVerificationResult },
  userId: string, userEmail: string
): Promise<void> {
  const { data: action, error } = await supabase.from('rca_case_actions').update({
    observed_result: fields.observedResult,
    verification_result: fields.verificationResult,
    verified_by: userId,
    verified_at: new Date().toISOString(),
  }).eq('id', actionId).eq('company_id', companyId).select('case_id').maybeSingle();
  if (error) { console.error('[RCA] Error verifying case action:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'rca.action_verified', resourceType: 'rca_case_action', resourceId: actionId, metadata: { result: fields.verificationResult } });

  if (fields.verificationResult === 'ineficaz' && action?.case_id) {
    await reopenCase(action.case_id, companyId, `Ação ${actionId} avaliada como ineficaz`, userId, userEmail);
  }
}

// ── Fila de regularização e cobertura ────────────────────────────────────────────────────

export async function getPendingClassificationQueue(companyId: string): Promise<RcaRecord[]> {
  const { data, error } = await supabase.from('rca_records').select('*').eq('company_id', companyId).eq('classification_status', 'pending').order('occurred_at', { ascending: false });
  if (error) { console.error('[RCA] Error loading pending queue:', error); return []; }
  return data as RcaRecord[];
}

export interface LegacyUnclassifiedItem {
  sourceModule: RcaSourceModule;
  sourceItemId: string;
  sku: string | null;
  productName: string | null;
  location: string | null;
  divergenceQty: number;
  occurredAt: string;
}

/** Varredura read-only (nenhuma tabela de origem é alterada) das divergências fechadas
 *  antes de existir classificação para elas, ou que nunca passaram pelo modal — mesma
 *  lógica de detecção de divergência que cada tela já usa para montar PendingRcaItem. */
export async function getLegacyUnclassifiedDivergences(companyId: string): Promise<LegacyUnclassifiedItem[]> {
  const { data: classifiedRows } = await supabase.from('rca_records').select('source_module, source_item_id').eq('company_id', companyId);
  const classifiedByModule = new Map<RcaSourceModule, Set<string>>();
  for (const row of classifiedRows ?? []) {
    const set = classifiedByModule.get(row.source_module as RcaSourceModule) ?? new Set<string>();
    set.add(row.source_item_id);
    classifiedByModule.set(row.source_module as RcaSourceModule, set);
  }

  const results: LegacyUnclassifiedItem[] = [];

  const { data: countItems, error: countError } = await supabase
    .from('inventory_count_import_items')
    .select('id, sku, produto_nome, local, diferenca, status, created_at')
    .eq('company_id', companyId)
    .neq('status', 'correct');
  if (countError) console.error('[RCA] Error scanning legacy count divergences:', countError);
  const classifiedCount = classifiedByModule.get('import_count') ?? new Set();
  for (const item of countItems ?? []) {
    if (classifiedCount.has(item.id)) continue;
    results.push({ sourceModule: 'import_count', sourceItemId: item.id, sku: item.sku, productName: item.produto_nome, location: item.local, divergenceQty: item.diferenca ?? 0, occurredAt: item.created_at });
  }

  const { data: fullItems, error: fullError } = await supabase
    .from('full_operation_items')
    .select('id, sku, product_name, location, quantity_picked, quantity_requested, status, created_at')
    .eq('company_id', companyId)
    .in('status', ['not_found', 'picking_error', 'skipped']);
  if (fullError) console.error('[RCA] Error scanning legacy full operation divergences:', fullError);
  const classifiedFull = classifiedByModule.get('full_operation') ?? new Set();
  for (const item of fullItems ?? []) {
    if (classifiedFull.has(item.id)) continue;
    results.push({ sourceModule: 'full_operation', sourceItemId: item.id, sku: item.sku, productName: item.product_name, location: item.location, divergenceQty: (item.quantity_picked ?? 0) - (item.quantity_requested ?? 0), occurredAt: item.created_at });
  }

  const { data: nfeItems, error: nfeError } = await supabase
    .from('nfe_invoice_items')
    .select('id, snapshot_sku, snapshot_product_name, expected_quantity, physical_quantity, result_status, created_at')
    .eq('company_id', companyId)
    .in('result_status', ['missing', 'surplus']);
  if (nfeError) console.error('[RCA] Error scanning legacy nfe divergences:', nfeError);
  const classifiedNfe = classifiedByModule.get('nfe_receiving') ?? new Set();
  for (const item of nfeItems ?? []) {
    if (classifiedNfe.has(item.id)) continue;
    results.push({ sourceModule: 'nfe_receiving', sourceItemId: item.id, sku: item.snapshot_sku, productName: item.snapshot_product_name, location: null, divergenceQty: (item.physical_quantity ?? 0) - (item.expected_quantity ?? 0), occurredAt: item.created_at });
  }

  return results.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export interface ClassificationCoverage {
  classified: number;
  pending: number;
  legacy: number;
  totalClosed: number;
  coveragePct: number | null;
}

export async function getClassificationCoverage(companyId: string): Promise<ClassificationCoverage> {
  const [{ count: classified }, pending, legacy] = await Promise.all([
    supabase.from('rca_records').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('classification_status', 'classified'),
    getPendingClassificationQueue(companyId),
    getLegacyUnclassifiedDivergences(companyId),
  ]);
  const classifiedCount = classified ?? 0;
  const totalClosed = classifiedCount + pending.length + legacy.length;
  return {
    classified: classifiedCount,
    pending: pending.length,
    legacy: legacy.length,
    totalClosed,
    coveragePct: totalClosed > 0 ? (classifiedCount / totalClosed) * 100 : null,
  };
}

// ── Indicadores agregados do dashboard ───────────────────────────────────────────────────

/** Ações (não-contenção) com tarefa vinculada vencida e sem verificação de eficácia ainda. */
export async function getOverdueActionsCount(companyId: string): Promise<number> {
  const { data: actions, error } = await supabase.from('rca_case_actions').select('task_id').eq('company_id', companyId).is('verification_result', null);
  if (error) { console.error('[RCA] Error loading actions for overdue count:', error); return 0; }
  const taskIds = (actions ?? []).map(a => a.task_id).filter((id): id is string => !!id);
  if (taskIds.length === 0) return 0;

  const { data: tasks, error: taskError } = await supabase
    .from('tasks').select('id, due_date, status').in('id', taskIds)
    .lt('due_date', new Date().toISOString())
    .not('status', 'in', '(done,validated,cancelled)');
  if (taskError) { console.error('[RCA] Error loading tasks for overdue count:', taskError); return 0; }
  return tasks?.length ?? 0;
}

export interface EffectivenessStats {
  verifiedEffective: number;
  verifiedTotal: number;
  pct: number | null;
}

export async function getEffectivenessStats(companyId: string): Promise<EffectivenessStats> {
  const { data, error } = await supabase.from('rca_case_actions').select('verification_result').eq('company_id', companyId).not('verification_result', 'is', null);
  if (error) { console.error('[RCA] Error loading effectiveness stats:', error); return { verifiedEffective: 0, verifiedTotal: 0, pct: null }; }
  const verifiedTotal = data?.length ?? 0;
  const verifiedEffective = (data ?? []).filter(r => r.verification_result === 'eficaz').length;
  return { verifiedEffective, verifiedTotal, pct: verifiedTotal > 0 ? (verifiedEffective / verifiedTotal) * 100 : null };
}

export interface OpenActionRow {
  action: RcaCaseAction;
  caseCode: string;
  caseId: string;
}

/** Lista achatada de ações não encerradas de todos os casos — usada pela aba "Ações
 *  corretivas" do dashboard (visão consolidada, sem entrar em cada caso). */
export async function listOpenActions(companyId: string): Promise<OpenActionRow[]> {
  const { data: cases, error: caseError } = await supabase.from('rca_cases').select('id, case_number, case_year').eq('company_id', companyId).neq('status', 'encerrado');
  if (caseError || !cases || cases.length === 0) return [];
  const { data: actions, error } = await supabase.from('rca_case_actions').select('*').in('case_id', cases.map(c => c.id));
  if (error) { console.error('[RCA] Error listing open actions:', error); return []; }
  const caseById = new Map(cases.map(c => [c.id, `RCA-${c.case_year}-${String(c.case_number).padStart(3, '0')}`]));
  return (actions as RcaCaseAction[]).map(action => ({ action, caseId: action.case_id, caseCode: caseById.get(action.case_id) ?? '—' }));
}

// ── Listagens e agregações do dashboard ──────────────────────────────────────────────────

export async function listRecords(companyId: string, filters?: RcaFilters): Promise<RcaRecord[]> {
  let query = supabase.from('rca_records').select('*').eq('company_id', companyId).eq('classification_status', 'classified').order('occurred_at', { ascending: false });
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
  rcaRecordId: string | null,
  rcaCaseId: string | null,
  companyId: string,
  files: File[],
  userId: string,
  evidenceType: RcaEvidenceType = 'anexo'
): Promise<RcaEvidence[]> {
  const uploaded: RcaEvidence[] = [];
  for (const file of files) {
    if (!EVIDENCE_ALLOWED_TYPES.includes(file.type)) { console.error('[RCA] Rejected evidence upload: invalid type', file.type); continue; }
    if (file.size > EVIDENCE_MAX_SIZE_BYTES) { console.error('[RCA] Rejected evidence upload: file too large', file.size); continue; }

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${companyId}/${rcaRecordId ?? rcaCaseId}-${Date.now()}-${uploaded.length}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, file);
    if (uploadError) { console.error('[RCA] Error uploading evidence:', uploadError); continue; }

    const { data, error } = await supabase
      .from('rca_evidence')
      .insert({ rca_record_id: rcaRecordId, rca_case_id: rcaCaseId, company_id: companyId, evidence_type: evidenceType, file_path: path, file_name: file.name, uploaded_by: userId })
      .select()
      .maybeSingle();
    if (error || !data) { console.error('[RCA] Error saving evidence row:', error); continue; }
    uploaded.push(data as RcaEvidence);
  }
  return uploaded;
}

/** Vincula evidência a um registro real já existente (contagem/picking/sistema/produto/
 *  endereço/fornecedor) em vez de copiar dado como texto solto. */
export async function linkEvidenceToRecord(
  rcaCaseId: string, companyId: string,
  fields: { evidenceType: RcaEvidenceType; sourceTable: string; sourceRecordId: string; note?: string | null; whyStepId?: string | null },
  userId: string
): Promise<RcaEvidence | null> {
  const { data, error } = await supabase.from('rca_evidence').insert({
    rca_case_id: rcaCaseId, company_id: companyId, evidence_type: fields.evidenceType,
    source_table: fields.sourceTable, source_record_id: fields.sourceRecordId, note: fields.note ?? null,
    why_step_id: fields.whyStepId ?? null, uploaded_by: userId,
  }).select().maybeSingle();
  if (error || !data) { console.error('[RCA] Error linking evidence:', error); return null; }
  return data as RcaEvidence;
}

export async function getEvidenceForRecord(rcaRecordId: string, companyId: string): Promise<RcaEvidence[]> {
  const { data, error } = await supabase.from('rca_evidence').select('*').eq('rca_record_id', rcaRecordId).eq('company_id', companyId);
  if (error) { console.error('[RCA] Error loading evidence:', error); return []; }
  return data as RcaEvidence[];
}

export async function getEvidenceForCase(rcaCaseId: string, companyId: string): Promise<RcaEvidence[]> {
  const { data, error } = await supabase.from('rca_evidence').select('*').eq('rca_case_id', rcaCaseId).eq('company_id', companyId).order('created_at', { ascending: true });
  if (error) { console.error('[RCA] Error loading case evidence:', error); return []; }
  return data as RcaEvidence[];
}

export async function getEvidenceSignedUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(filePath, 3600);
  if (error) { console.error('[RCA] Error creating evidence signed URL:', error); return null; }
  return data.signedUrl;
}

// ── "5 Porquês" legado (migration 033) — mantido para não quebrar dado/objeto existente,
//    sem uso na nova UI (papel absorvido por rca_case_why_steps / getWhySteps acima). ──────

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
  for (const row of data) if (row.cause_category) counts.set(row.cause_category as RcaCauseCategory, (counts.get(row.cause_category as RcaCauseCategory) ?? 0) + 1);
  if (counts.size === 0) return null;
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}
