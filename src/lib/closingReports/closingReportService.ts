// Resumo de fechamento de linha/marca — camada de I/O. Gera o resumo quando os
// pendentes de uma linha (inventory_brands.total_sku - done_sku) chegam a zero,
// reunindo as observações das contagens (inventory_count_records.observacoes)
// daquele mesmo ciclo e classificando-as localmente (ver observationClassifier.ts).
//
// Todo indicador numérico do relatório é uma cópia lida de uma fonte já existente
// (inventory_brands, inventory_count_records) — nunca recalculado aqui. Nenhuma
// contagem, pendência ou divergência existente é alterada por este módulo.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import { computeAccuracy } from '../blindAIAgentAlgorithm';
import { classifyObservation } from './observationClassifier';
import { renderClosingSummary } from './closingSummaryTemplate';
import type {
  CategoryCountSnapshot,
  ClosingCategory,
  ClosingReport,
  ClosingReportGenerationResult,
  ClosingReportObservation,
  ClosingReportWithObservations,
} from './closingReportTypes';

// Chave estável -> definição inicial. Semeadas só quando a empresa ainda não
// tem nenhuma categoria própria (ver getCategories) — nunca sobrescreve edições
// já feitas pelo usuário.
const DEFAULT_CATEGORIES: { key: string; name: string; keywords: string[] }[] = [
  { key: 'saldo_excesso', name: 'Saldo em excesso', keywords: ['saldo em excesso', 'excesso', 'sobrou', 'sobra', 'quantidade maior', 'saldo maior', 'a mais'] },
  { key: 'saldo_falta', name: 'Saldo em falta', keywords: ['saldo em falta', 'faltou', 'falta', 'quantidade menor', 'saldo menor', 'a menos'] },
  { key: 'organizacao_vao', name: 'Organização do vão', keywords: ['atrás do vão', 'fora do vão', 'produto misturado', 'vão desorganizado', 'fora do lugar'] },
  { key: 'vao_duplicado', name: 'Vão duplicado', keywords: ['vão duplicado', 'endereço duplicado', 'local duplicado'] },
  { key: 'divergencia_recontagem', name: 'Divergência resolvida na recontagem', keywords: ['recontado', 'recontada', 'segunda contagem', 'conferido novamente'] },
];

interface CategoryRow {
  id: string; company_id: string; key: string; name: string; keywords: string[]; active: boolean; created_at: string; updated_at: string;
}
interface ReportRow {
  id: string; company_id: string; brand_id: string; cycle_start: string | null; version: number; is_current: boolean;
  total_sku: number; skus_contados: number; divergencias_encontradas: number; divergencias_recontadas: number; divergencias_reais: number;
  accuracy_initial: number | null; accuracy_final: number | null; category_counts: CategoryCountSnapshot[]; unclassified_count: number;
  summary_text: string; source_count_record_ids: string[]; generated_at: string; generated_by: string | null; created_at: string;
}
interface ObservationRow {
  id: string; report_id: string; count_record_id: string; observation_text: string; matched_category_ids: string[]; is_unclassified: boolean; created_at: string;
}

function categoryFromRow(row: CategoryRow): ClosingCategory {
  return {
    id: row.id, companyId: row.company_id, key: row.key, name: row.name,
    keywords: row.keywords ?? [], active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function reportFromRow(row: ReportRow): ClosingReport {
  return {
    id: row.id, companyId: row.company_id, brandId: row.brand_id, cycleStart: row.cycle_start,
    version: row.version, isCurrent: row.is_current, totalSku: row.total_sku, skusContados: row.skus_contados,
    divergenciasEncontradas: row.divergencias_encontradas, divergenciasRecontadas: row.divergencias_recontadas,
    divergenciasReais: row.divergencias_reais, accuracyInitial: row.accuracy_initial, accuracyFinal: row.accuracy_final,
    categoryCounts: row.category_counts ?? [], unclassifiedCount: row.unclassified_count, summaryText: row.summary_text,
    sourceCountRecordIds: row.source_count_record_ids ?? [], generatedAt: row.generated_at, generatedBy: row.generated_by,
    createdAt: row.created_at,
  };
}

function observationFromRow(row: ObservationRow): ClosingReportObservation {
  return {
    id: row.id, reportId: row.report_id, countRecordId: row.count_record_id, observationText: row.observation_text,
    matchedCategoryIds: row.matched_category_ids ?? [], isUnclassified: row.is_unclassified, createdAt: row.created_at,
  };
}

/**
 * Decisão pura: o `accuracy_final` persistido no relatório atual está desatualizado
 * em relação à acuracidade canônica (computeAccuracy sobre os totais consolidados
 * da linha)? Usada só para decidir se uma abertura/geração deve reprocessar
 * automaticamente — nunca para escrever nada sozinha.
 */
export function isAccuracyStale(persisted: number | null, canonical: number | null, epsilon = 0.05): boolean {
  if (canonical === null) return false;
  if (persisted === null) return true;
  return Math.abs(persisted - canonical) > epsilon;
}

/** Lê as categorias da empresa; semeia as 5 iniciais só se a empresa ainda não tem nenhuma. */
export async function getCategories(companyId: string): Promise<ClosingCategory[]> {
  const { data, error } = await supabase
    .from('inventory_closing_categories')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[ClosingReport] Error loading categories:', error);
    return [];
  }

  if (data && data.length > 0) return (data as CategoryRow[]).map(categoryFromRow);

  const { error: seedError } = await supabase.from('inventory_closing_categories').upsert(
    DEFAULT_CATEGORIES.map(c => ({ company_id: companyId, key: c.key, name: c.name, keywords: c.keywords })),
    { onConflict: 'company_id,key', ignoreDuplicates: true }
  );
  if (seedError) {
    console.error('[ClosingReport] Error seeding default categories:', seedError);
    return [];
  }

  const { data: seeded, error: refetchError } = await supabase
    .from('inventory_closing_categories')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (refetchError) {
    console.error('[ClosingReport] Error reloading seeded categories:', refetchError);
    return [];
  }
  return ((seeded as CategoryRow[]) ?? []).map(categoryFromRow);
}

export async function upsertCategory(
  companyId: string,
  input: { id?: string; key: string; name: string; keywords: string[] },
  userId: string,
  userEmail: string
): Promise<ClosingCategory | null> {
  const { data, error } = await supabase
    .from('inventory_closing_categories')
    .upsert(
      { id: input.id, company_id: companyId, key: input.key, name: input.name, keywords: input.keywords, updated_at: new Date().toISOString() },
      { onConflict: 'company_id,key' }
    )
    .select()
    .single();

  if (error || !data) {
    console.error('[ClosingReport] Error saving category:', error);
    return null;
  }

  await logAuditEvent({ companyId, userId, userEmail, action: 'closing_category.saved', resourceType: 'inventory_closing_categories', resourceId: data.id, metadata: { key: input.key } });
  return categoryFromRow(data as CategoryRow);
}

/** Desativa a categoria — nunca apaga fisicamente, para preservar relatórios históricos que a referenciam. */
export async function setCategoryActive(companyId: string, categoryId: string, active: boolean, userId: string, userEmail: string): Promise<boolean> {
  const { error } = await supabase
    .from('inventory_closing_categories')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', categoryId);

  if (error) {
    console.error('[ClosingReport] Error toggling category:', error);
    return false;
  }
  if (!active) {
    await logAuditEvent({ companyId, userId, userEmail, action: 'closing_category.deactivated', resourceType: 'inventory_closing_categories', resourceId: categoryId });
  }
  return true;
}

/** "Ciclo atual" = desde o último arquivamento da empresa (inventory_snapshots.end_date mais recente), ou null (desde sempre). */
export async function getCurrentCycleStart(companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('end_date')
    .eq('company_id', companyId)
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[ClosingReport] Error reading last snapshot:', error);
    return null;
  }
  return data?.end_date ?? null;
}

async function fetchCurrentReport(companyId: string, brandId: string, cycleStart: string | null): Promise<ReportRow | null> {
  let query = supabase
    .from('inventory_closing_reports')
    .select('*')
    .eq('company_id', companyId)
    .eq('brand_id', brandId)
    .eq('is_current', true);

  query = cycleStart ? query.eq('cycle_start', cycleStart) : query.is('cycle_start', null);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[ClosingReport] Error fetching current report:', error);
    return null;
  }
  return (data as ReportRow) ?? null;
}

export async function getObservationsForReport(reportId: string): Promise<ClosingReportObservation[]> {
  const { data, error } = await supabase
    .from('inventory_closing_report_observations')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[ClosingReport] Error loading report observations:', error);
    return [];
  }
  return ((data as ObservationRow[]) ?? []).map(observationFromRow);
}

export async function getCurrentReportForBrand(companyId: string, brandId: string): Promise<ClosingReportWithObservations | null> {
  const cycleStart = await getCurrentCycleStart(companyId);
  const row = await fetchCurrentReport(companyId, brandId, cycleStart);
  if (!row) return null;
  const report = reportFromRow(row);
  const observations = await getObservationsForReport(report.id);
  return { report, observations };
}

/**
 * Lista os relatórios `is_current=true` da empresa para o ciclo atual — usada
 * pela página "Resultados por Linha". Nunca lê outro ciclo nem outra empresa.
 */
export async function listCurrentReportsForCycle(companyId: string): Promise<ClosingReport[]> {
  const cycleStart = await getCurrentCycleStart(companyId);
  let query = supabase
    .from('inventory_closing_reports')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_current', true);
  query = cycleStart ? query.eq('cycle_start', cycleStart) : query.is('cycle_start', null);

  const { data, error } = await query;
  if (error) {
    console.error('[ClosingReport] Error listing current reports:', error);
    return [];
  }
  return ((data as ReportRow[]) ?? []).map(reportFromRow);
}

/**
 * Histórico de fechamentos da empresa — todos os ciclos, não só o atual. Traz a versão
 * vigente de cada linha/ciclo (`is_current`), que é a que o índice único parcial da
 * migration 073 garante ser única por linha+ciclo. Company-scoped como todo o resto;
 * `listCurrentReportsForCycle` continua existindo e intocada para o ciclo atual.
 *
 * Só metadados do relatório: as observações de um fechamento são lidas apenas quando ele
 * é aberto (getObservationsForReport), nunca em lote para a listagem inteira.
 */
export async function listClosingReportsHistory(companyId: string): Promise<ClosingReport[]> {
  const { data, error } = await supabase
    .from('inventory_closing_reports')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_current', true)
    .order('generated_at', { ascending: false });

  if (error) {
    console.error('[ClosingReport] Error listing closing history:', error);
    return [];
  }
  return ((data as ReportRow[]) ?? []).map(reportFromRow);
}

/** Uma linha/marca dentro de um inventário já arquivado, como o histórico a persistiu. */
export interface ArchivedInventoryClosing {
  snapshotId: string;
  snapshotName: string;
  startDate: string | null;
  endDate: string | null;
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  accuracy: number | null;
  status: string | null;
}

/** O inventário arquivado em si (o cabeçalho do snapshot), com os totais que ele já
 *  gravou. Existe mesmo quando o snapshot não tem detalhamento por linha. */
export interface ArchivedInventorySummary {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  totalSku: number | null;
  totalDone: number | null;
  totalDivergences: number | null;
  accuracy: number | null;
  status: string | null;
}

export interface ArchivedInventoryData {
  inventories: ArchivedInventorySummary[];
  lines: ArchivedInventoryClosing[];
}

/**
 * Inventários arquivados, direto da infraestrutura histórica que já existe
 * (inventory_snapshots + inventory_brand_history) — nenhuma segunda estrutura de
 * histórico, nenhum snapshot duplicado, nenhuma geração de relatório antigo.
 *
 * Devolve os dois níveis separados de propósito: `inventories` é o que o snapshot
 * gravou sobre o inventário inteiro, `lines` é o detalhamento por linha/marca. Um
 * snapshot antigo pode existir sem nenhuma linha em inventory_brand_history — nesse
 * caso `lines` vem vazio e nada é fabricado para preencher a tabela.
 *
 * Duas queries em lote (snapshots, depois as linhas de todos eles), sem N+1. As duas
 * filtram company_id: um workspace nunca recebe o histórico de outro.
 */
export async function listArchivedInventoryClosings(companyId: string): Promise<ArchivedInventoryData> {
  const { data: snapshots, error: snapshotError } = await supabase
    .from('inventory_snapshots')
    .select('id, name, start_date, end_date, total_sku, total_done, total_divergences, accuracy, status')
    .eq('company_id', companyId)
    .order('end_date', { ascending: false });

  if (snapshotError || !snapshots || snapshots.length === 0) {
    if (snapshotError) console.error('[ClosingReport] Error listing snapshots:', snapshotError);
    return { inventories: [], lines: [] };
  }

  type SnapshotRow = {
    id: string; name: string; start_date: string | null; end_date: string | null;
    total_sku: number | null; total_done: number | null; total_divergences: number | null;
    accuracy: number | null; status: string | null;
  };

  const inventories: ArchivedInventorySummary[] = (snapshots as SnapshotRow[]).map(s => ({
    id: s.id,
    name: s.name,
    startDate: s.start_date,
    endDate: s.end_date,
    totalSku: s.total_sku,
    totalDone: s.total_done,
    totalDivergences: s.total_divergences,
    accuracy: s.accuracy,
    status: s.status,
  }));

  const snapshotById = new Map((snapshots as SnapshotRow[]).map(s => [s.id, s]));

  const { data: history, error: historyError } = await supabase
    .from('inventory_brand_history')
    .select('snapshot_id, brand, total_sku, done_sku, divergences, accuracy, status')
    .eq('company_id', companyId)
    .in('snapshot_id', [...snapshotById.keys()]);

  if (historyError) {
    console.error('[ClosingReport] Error listing brand history:', historyError);
    return { inventories, lines: [] };
  }

  type HistoryRow = {
    snapshot_id: string; brand: string; total_sku: number; done_sku: number;
    divergences: number; accuracy: number | null; status: string | null;
  };

  const lines = ((history as HistoryRow[]) ?? []).flatMap(row => {
    const snapshot = snapshotById.get(row.snapshot_id);
    if (!snapshot) return [];
    return [{
      snapshotId: snapshot.id,
      snapshotName: snapshot.name,
      startDate: snapshot.start_date,
      endDate: snapshot.end_date,
      brand: row.brand,
      totalSku: row.total_sku,
      doneSku: row.done_sku,
      divergences: row.divergences,
      accuracy: row.accuracy,
      status: row.status,
    }];
  });

  return { inventories, lines };
}

export interface ClosingResultRow {
  brandId: string;
  brandName: string;
  report: ClosingReport | null;
}

/**
 * Combinação pura (sem I/O) das linhas concluídas do ciclo com os relatórios já
 * gerados — usada pela página "Resultados por Linha". Uma linha só entra na lista
 * quando seus pendentes já chegaram a zero (total_sku - done_sku <= 0); uma linha
 * concluída sem relatório ainda entra, com `report: null`, para oferecer "Gerar
 * resumo". Ordenação: fechamentos mais recentes primeiro, sem relatório por último.
 */
export function buildClosingResults(
  brandsData: { id: string; brand: string; total_sku: number; done_sku: number }[],
  reports: ClosingReport[]
): ClosingResultRow[] {
  const reportsByBrand = new Map(reports.map(r => [r.brandId, r]));
  const rows: ClosingResultRow[] = brandsData
    .filter(b => b.total_sku - b.done_sku <= 0)
    .map(b => ({ brandId: b.id, brandName: b.brand, report: reportsByBrand.get(b.id) ?? null }));

  return rows.sort((a, b) => {
    if (a.report && b.report) return b.report.generatedAt.localeCompare(a.report.generatedAt);
    if (a.report && !b.report) return -1;
    if (!a.report && b.report) return 1;
    return a.brandName.localeCompare(b.brandName);
  });
}

interface GenerateOptions {
  force?: boolean;
  userId?: string | null;
  userEmail?: string | null;
}

/**
 * Gera (ou reprocessa) o resumo de fechamento de uma linha/marca. Idempotente: sem
 * `force`, uma chamada repetida para o mesmo ciclo devolve o relatório já existente
 * em vez de duplicar — inclusive sob corrida (o índice único parcial da migration
 * 073 rejeita o segundo insert simultâneo; o 23505 é tratado como sucesso).
 */
export async function generateClosingReport(
  companyId: string,
  brandId: string,
  options: GenerateOptions = {}
): Promise<ClosingReportGenerationResult> {
  const { force = false, userId = null, userEmail = null } = options;

  // 1. Nunca confia em estado do componente — relê a linha ao vivo.
  const { data: brand, error: brandError } = await supabase
    .from('inventory_brands')
    .select('id, brand, total_sku, done_sku, divergences')
    .eq('id', brandId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (brandError || !brand) {
    return { status: 'error', message: brandError?.message ?? 'Linha não encontrada.' };
  }
  if (brand.total_sku - brand.done_sku > 0) {
    return { status: 'skipped_pending' };
  }

  const cycleStart = await getCurrentCycleStart(companyId);
  const canonicalAccuracyFinal = computeAccuracy(brand.done_sku, brand.divergences);

  // `forceRegenerate` cobre tanto o reprocessamento explícito (botão "Reprocessar
  // resumo") quanto a autocorreção: se o accuracy_final já persistido diverge do
  // canônico (ex.: relatório antigo que copiava o último registro de contagem em
  // vez do total consolidado), a abertura do resumo já dispara uma nova versão —
  // nunca uma edição silenciosa da versão anterior.
  let forceRegenerate = force;

  if (!force) {
    const existing = await fetchCurrentReport(companyId, brandId, cycleStart);
    if (existing) {
      if (!isAccuracyStale(existing.accuracy_final, canonicalAccuracyFinal)) {
        const observations = await getObservationsForReport(existing.id);
        return { status: 'already_current', report: reportFromRow(existing), observations };
      }
      forceRegenerate = true;
    }
  }

  // 2. Contagens do ciclo atual desta linha — nunca de outra linha ou de um ciclo já arquivado.
  let recordsQuery = supabase
    .from('inventory_count_records')
    .select('*')
    .eq('company_id', companyId)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (cycleStart) recordsQuery = recordsQuery.gte('created_at', cycleStart);

  const { data: records, error: recordsError } = await recordsQuery;
  if (recordsError) {
    return { status: 'error', message: recordsError.message };
  }

  const categories = (await getCategories(companyId)).filter(c => c.active);

  let divergenciasEncontradas = 0;
  let divergenciasRecontadas = 0;
  let accuracyInitial: number | null = null;
  const categoryCountMap = new Map<string, number>();
  let unclassifiedCount = 0;
  const observationsToInsert: { countRecordId: string; text: string; matchedCategoryIds: string[]; isUnclassified: boolean }[] = [];

  for (const record of records ?? []) {
    divergenciasEncontradas += record.divergencias_encontradas ?? 0;
    divergenciasRecontadas += record.divergencias_recontadas ?? 0;
    if (record.accuracy_initial !== null) accuracyInitial = record.accuracy_initial;

    const text = (record.observacoes ?? '').trim();
    if (!text) continue;

    const match = classifyObservation(text, categories);
    if (match.isUnclassified) unclassifiedCount += 1;
    for (const categoryId of match.categoryIds) {
      categoryCountMap.set(categoryId, (categoryCountMap.get(categoryId) ?? 0) + 1);
    }
    observationsToInsert.push({ countRecordId: record.id, text, matchedCategoryIds: match.categoryIds, isUnclassified: match.isUnclassified });
  }

  const categoryCounts: CategoryCountSnapshot[] = categories
    .filter(c => (categoryCountMap.get(c.id) ?? 0) > 0)
    .map(c => ({ categoryId: c.id, key: c.key, name: c.name, count: categoryCountMap.get(c.id) ?? 0 }));

  const summaryText = renderClosingSummary({
    brandName: brand.brand,
    totalSku: brand.total_sku,
    skusContados: brand.done_sku,
    divergenciasEncontradas,
    divergenciasRecontadas,
    divergenciasReais: brand.divergences,
    accuracyFinal: canonicalAccuracyFinal,
    categoryCounts,
    unclassifiedCount,
  });

  // 3. Reprocessamento: a versão anterior vira histórico (is_current=false) antes do
  // novo insert — nunca é editada, só deixa de ser "a atual".
  let nextVersion = 1;
  if (forceRegenerate) {
    const previous = await fetchCurrentReport(companyId, brandId, cycleStart);
    if (previous) {
      nextVersion = previous.version + 1;
      const { error: demoteError } = await supabase
        .from('inventory_closing_reports')
        .update({ is_current: false })
        .eq('id', previous.id);
      if (demoteError) {
        return { status: 'error', message: demoteError.message };
      }
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('inventory_closing_reports')
    .insert({
      company_id: companyId,
      brand_id: brandId,
      cycle_start: cycleStart,
      version: nextVersion,
      is_current: true,
      total_sku: brand.total_sku,
      skus_contados: brand.done_sku,
      divergencias_encontradas: divergenciasEncontradas,
      divergencias_recontadas: divergenciasRecontadas,
      divergencias_reais: brand.divergences,
      accuracy_initial: accuracyInitial,
      accuracy_final: canonicalAccuracyFinal,
      category_counts: categoryCounts,
      unclassified_count: unclassifiedCount,
      summary_text: summaryText,
      source_count_record_ids: observationsToInsert.map(o => o.countRecordId),
      generated_by: userId,
    })
    .select()
    .single();

  if (insertError) {
    // 23505 = outra aba/clique já gerou o relatório deste ciclo entre o check acima e
    // este insert — trata como sucesso idempotente, nunca como erro pro usuário.
    if (insertError.code === '23505') {
      const existing = await fetchCurrentReport(companyId, brandId, cycleStart);
      if (existing) {
        const observations = await getObservationsForReport(existing.id);
        return { status: 'already_current', report: reportFromRow(existing), observations };
      }
    }
    return { status: 'error', message: insertError.message };
  }

  const reportRow = inserted as ReportRow;

  if (observationsToInsert.length > 0) {
    const { error: obsError } = await supabase.from('inventory_closing_report_observations').insert(
      observationsToInsert.map(o => ({
        report_id: reportRow.id,
        company_id: companyId,
        count_record_id: o.countRecordId,
        observation_text: o.text,
        matched_category_ids: o.matchedCategoryIds,
        is_unclassified: o.isUnclassified,
      }))
    );
    if (obsError) console.error('[ClosingReport] Error inserting observation links:', obsError);
  }

  if (userId && userEmail) {
    await logAuditEvent({
      companyId, userId, userEmail,
      action: forceRegenerate ? 'closing_report.reprocessed' : 'closing_report.generated',
      resourceType: 'inventory_closing_reports', resourceId: reportRow.id,
      metadata: { brandId, version: nextVersion },
    });
  }

  const observations = observationsToInsert.map((o, idx) => ({
    id: `pending-${idx}`, reportId: reportRow.id, countRecordId: o.countRecordId, observationText: o.text,
    matchedCategoryIds: o.matchedCategoryIds, isUnclassified: o.isUnclassified, createdAt: new Date().toISOString(),
  }));

  return { status: 'generated', report: reportFromRow(reportRow), observations };
}
