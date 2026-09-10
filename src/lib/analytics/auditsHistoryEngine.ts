// Analytics > Auditorias — cálculo puro sobre inventory_count_records, no mesmo espírito de
// auditCrossCheckAlgorithm.ts (algoritmo puro) + auditCrossCheckService.ts (I/O). Aqui só
// mora o que dá para calcular sem tocar no banco: o mapeamento de uma sessão, o consolidado
// do histórico e a filtragem local da lista. Nenhuma fórmula nova de acurácia: o consolidado
// reutiliza computeDivergenceRateStat, o mesmo helper que BlindScore e Inventory Health usam.
import type { InventoryCountRecord, InventoryCountImportItem } from '../supabase';
import { computeDivergenceRateStat } from './analyticsMath';

export interface AuditSessionSummary {
  id: string;
  createdAt: string;
  countNumber: 1 | 2 | 3;
  source: 'manual' | 'import';
  totalSku: number;
  skusContados: number;
  divergenciasReais: number;
  accuracy: number | null;
  operator: string | null;
  approved: boolean;
  /** Recontagens apontam para a contagem raiz da cadeia (021_count_management.sql). */
  linkedCountId: string | null;
  operator2: string | null;
  divergenciasEncontradas: number;
  divergenciasRecontadas: number;
  finishedAt: string | null;
  approvedAt: string | null;
  /** Contados / previstos. `null` quando a sessão não tem universo previsto — sem
   *  denominador real não existe cobertura, e um 100% aqui seria inventado. */
  coveragePct: number | null;
  /** Divergências / contados na própria sessão. `null` quando nada foi contado. */
  divergenceRatePct: number | null;
}

/** Consolidado do histórico. A acurácia observada NÃO é a média dos percentuais das sessões
 *  (bases diferentes distorceriam o número): soma de divergências reais sobre soma de SKUs
 *  contados, exatamente o que computeDivergenceRateStat já define como taxa oficial. */
export interface AuditsHistorySummary {
  sessions: number;
  totalCounted: number;
  totalDivergent: number;
  observedAccuracyPct: number | null;
  approvedSessions: number;
}

export function toSessionSummary(r: InventoryCountRecord): AuditSessionSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    countNumber: r.count_number,
    source: r.source,
    totalSku: r.total_sku,
    skusContados: r.skus_contados,
    divergenciasReais: r.divergencias_reais,
    accuracy: r.accuracy_final ?? r.accuracy_initial,
    operator: r.operator_1 ?? null,
    approved: r.approved_by !== null && r.approved_by !== undefined,
    linkedCountId: r.linked_count_id,
    operator2: r.operator_2 ?? null,
    divergenciasEncontradas: r.divergencias_encontradas,
    divergenciasRecontadas: r.divergencias_recontadas,
    finishedAt: r.finished_at,
    approvedAt: r.approved_at,
    coveragePct: r.total_sku > 0 ? (r.skus_contados / r.total_sku) * 100 : null,
    divergenceRatePct: r.skus_contados > 0 ? (r.divergencias_reais / r.skus_contados) * 100 : null,
  };
}

export function computeHistorySummary(records: InventoryCountRecord[]): AuditsHistorySummary {
  const divergenceStat = computeDivergenceRateStat(records);
  return {
    sessions: records.length,
    totalCounted: divergenceStat?.totalCounted ?? 0,
    totalDivergent: divergenceStat?.totalDivergent ?? 0,
    observedAccuracyPct: divergenceStat ? 100 - divergenceStat.ratePct : null,
    approvedSessions: records.filter(r => r.approved_by !== null && r.approved_by !== undefined).length,
  };
}

/** Rótulo da etapa da contagem — mesma nomenclatura que a tabela já usava. */
export function countNumberLabel(countNumber: 1 | 2 | 3): string {
  return countNumber === 1 ? '1ª contagem' : countNumber === 2 ? 'Recontagem' : '3ª contagem';
}

export type SessionPeriod = '30d' | '90d' | 'all';
export type SessionApproval = 'all' | 'approved' | 'pending';

export interface SessionFilters {
  period: SessionPeriod;
  /** Nome do operador ou 'all'. */
  operator: string;
  countNumber: 'all' | '1' | '2' | '3';
  approval: SessionApproval;
  search: string;
}

export const EMPTY_SESSION_FILTERS: SessionFilters = {
  period: 'all', operator: 'all', countNumber: 'all', approval: 'all', search: '',
};

const PERIOD_DAYS: Record<SessionPeriod, number | null> = { '30d': 30, '90d': 90, all: null };

/** Filtragem local: o histórico já está inteiro em memória (uma leitura por workspace), então
 *  nenhum filtro custa ida ao banco. Devolve sempre uma lista nova — a lista original nunca é
 *  reordenada nem mutada, porque é ela que alimenta o resumo executivo. */
export function filterSessions(
  sessions: AuditSessionSummary[],
  filters: SessionFilters,
  now: number = Date.now()
): AuditSessionSummary[] {
  const days = PERIOD_DAYS[filters.period];
  const since = days === null ? null : now - days * 86400000;
  const term = filters.search.trim().toLowerCase();

  return sessions.filter(s => {
    if (since !== null && new Date(s.createdAt).getTime() < since) return false;
    if (filters.operator !== 'all' && s.operator !== filters.operator) return false;
    if (filters.countNumber !== 'all' && String(s.countNumber) !== filters.countNumber) return false;
    if (filters.approval === 'approved' && !s.approved) return false;
    if (filters.approval === 'pending' && s.approved) return false;
    if (term.length > 0) {
      const haystack = [
        s.operator ?? '', s.operator2 ?? '', countNumberLabel(s.countNumber),
        new Date(s.createdAt).toLocaleDateString('pt-BR'),
      ].join(' ').toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

/** Um item conta como divergente pela mesma leitura que o RCA já usa sobre
 *  inventory_count_import_items: status preenchido e diferente de 'correct'. */
export function isDivergentItem(item: Pick<InventoryCountImportItem, 'status'>): boolean {
  return item.status !== null && item.status !== 'correct';
}

// ---- Performance ---------------------------------------------------------------------------
// Nenhuma nota, score ou ranking: só a evidência que as sessões já registram, sempre com a
// base à vista. O consolidado usa computeDivergenceRateStat (soma/soma) — a média simples das
// taxas por sessão daria a uma sessão de 16 SKUs o mesmo peso de uma de 195.

/** Média das coberturas das sessões que TÊM universo previsto, junto do tamanho dessa
 *  amostra. Sessões sem denominador não entram (nem como 0, nem como 100%). */
function coverageAverage(sessions: AuditSessionSummary[]): { pct: number | null; sample: number } {
  const withCoverage = sessions.filter(s => s.coveragePct !== null);
  if (withCoverage.length === 0) return { pct: null, sample: 0 };
  const sum = withCoverage.reduce((acc, s) => acc + (s.coveragePct as number), 0);
  return { pct: sum / withCoverage.length, sample: withCoverage.length };
}

function weighted(sessions: AuditSessionSummary[]) {
  return computeDivergenceRateStat(
    sessions.map(s => ({ skus_contados: s.skusContados, divergencias_reais: s.divergenciasReais }))
  );
}

export interface PerformanceSummary {
  sessions: number;
  totalCounted: number;
  totalDivergent: number;
  observedAccuracyPct: number | null;
  divergenceRatePct: number | null;
  coverageAvgPct: number | null;
  sessionsWithCoverage: number;
  approvedSessions: number;
}

export function computePerformanceSummary(sessions: AuditSessionSummary[]): PerformanceSummary {
  const stat = weighted(sessions);
  const coverage = coverageAverage(sessions);
  return {
    sessions: sessions.length,
    totalCounted: stat?.totalCounted ?? 0,
    totalDivergent: stat?.totalDivergent ?? 0,
    observedAccuracyPct: stat ? 100 - stat.ratePct : null,
    divergenceRatePct: stat ? stat.ratePct : null,
    coverageAvgPct: coverage.pct,
    sessionsWithCoverage: coverage.sample,
    approvedSessions: sessions.filter(s => s.approved).length,
  };
}

/** Eixo temporal = as próprias sessões, em ordem cronológica crescente. Nenhum snapshot novo
 *  é criado: o histórico de auditorias já É a série. */
export function toChronological(sessions: AuditSessionSummary[]): AuditSessionSummary[] {
  return [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface OperatorPerformance {
  operator: string;
  sessions: number;
  skusCounted: number;
  divergences: number;
  /** Sempre acompanhado de `sessionsWithCoverage` — percentual sem base não é exibido. */
  coverageAvgPct: number | null;
  sessionsWithCoverage: number;
  divergenceRatePct: number | null;
  observedAccuracyPct: number | null;
  recountSessions: number;
  approvedSessions: number;
}

/** Evidência operacional por operador — NÃO é ranking nem avaliação de pessoa: a ordenação
 *  padrão é por volume contado (quem participou de mais contagem aparece primeiro), nunca por
 *  divergência. Sessões sem operador registrado ficam de fora, sem virar um "Não informado"
 *  que somaria pessoas diferentes no mesmo balde. */
export function computeOperatorPerformance(sessions: AuditSessionSummary[]): OperatorPerformance[] {
  const byOperator = new Map<string, AuditSessionSummary[]>();
  for (const s of sessions) {
    const name = s.operator?.trim();
    if (!name) continue;
    const list = byOperator.get(name) ?? [];
    list.push(s);
    byOperator.set(name, list);
  }

  return Array.from(byOperator.entries())
    .map(([operator, list]) => {
      const stat = weighted(list);
      const coverage = coverageAverage(list);
      return {
        operator,
        sessions: list.length,
        skusCounted: stat?.totalCounted ?? 0,
        divergences: stat?.totalDivergent ?? 0,
        coverageAvgPct: coverage.pct,
        sessionsWithCoverage: coverage.sample,
        divergenceRatePct: stat ? stat.ratePct : null,
        observedAccuracyPct: stat ? 100 - stat.ratePct : null,
        recountSessions: list.filter(s => s.countNumber > 1).length,
        approvedSessions: list.filter(s => s.approved).length,
      };
    })
    .sort((a, b) =>
      b.skusCounted - a.skusCounted ||
      b.sessions - a.sessions ||
      a.operator.localeCompare(b.operator, 'pt-BR'));
}

// ---- Reincidência --------------------------------------------------------------------------
// Reincidência entre auditorias = a mesma entidade divergindo em SESSÕES DISTINTAS dentro da
// janela oficial de recorrência (rca_settings.recurrence_window_days). Duas linhas divergentes
// da MESMA sessão são uma ocorrência repetida, não uma reincidência entre auditorias.

/** Mínimo de sessões distintas para algo ser "reincidente". Não é um limiar de severidade
 *  novo: é a definição de repetir-se entre auditorias diferentes. O limiar configurável do
 *  RCA (recurrence_threshold_count) continua sendo usado, como sinalização adicional. */
export const MIN_RECURRENCE_SESSIONS = 2;

/** Uma divergência item a item, já reduzida ao que a reincidência precisa. */
export interface DivergentItemRow {
  itemId: string;
  sessionId: string;
  sku: string | null;
  productName: string | null;
  location: string | null;
  saldoSistema: number | null;
  saldoContado: number | null;
  diferenca: number | null;
  occurredAt: string;
}

/** Classificação REAL do RCA para um item divergente (rca_records.source_item_id). */
export interface RcaItemLink {
  sourceItemId: string;
  causeKey: string;
  causeLabel: string;
  occurredAt: string;
}

export interface RecurringSkuRow {
  sku: string;
  productName: string | null;
  sessionsWithDivergence: number;
  occurrences: number;
  lastOccurrenceAt: string;
  /** Última localização REGISTRADA na divergência — não uma consulta ao cadastro atual. */
  lastLocation: string | null;
  rcaClassified: number;
  causeLabels: string[];
  /** Também bateu o limiar de ocorrências configurado em RCA. */
  reachedRcaThreshold: boolean;
}

function lastOf(items: DivergentItemRow[]): DivergentItemRow {
  return [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
}

export function computeRecurringSkus(
  items: DivergentItemRow[],
  rcaLinks: RcaItemLink[],
  thresholdCount: number
): RecurringSkuRow[] {
  const linkByItem = new Map(rcaLinks.map(l => [l.sourceItemId, l]));
  const bySku = new Map<string, DivergentItemRow[]>();
  for (const item of items) {
    if (!item.sku) continue;
    const list = bySku.get(item.sku) ?? [];
    list.push(item);
    bySku.set(item.sku, list);
  }

  return Array.from(bySku.entries())
    .map(([sku, list]) => {
      const sessions = new Set(list.map(i => i.sessionId));
      const last = lastOf(list);
      const links = list.map(i => linkByItem.get(i.itemId)).filter((l): l is RcaItemLink => !!l);
      return {
        sku,
        productName: last.productName,
        sessionsWithDivergence: sessions.size,
        occurrences: list.length,
        lastOccurrenceAt: last.occurredAt,
        lastLocation: last.location,
        rcaClassified: links.length,
        causeLabels: Array.from(new Set(links.map(l => l.causeLabel))),
        reachedRcaThreshold: list.length >= thresholdCount,
      };
    })
    .filter(row => row.sessionsWithDivergence >= MIN_RECURRENCE_SESSIONS)
    .sort((a, b) =>
      b.sessionsWithDivergence - a.sessionsWithDivergence ||
      b.occurrences - a.occurrences ||
      b.lastOccurrenceAt.localeCompare(a.lastOccurrenceAt));
}

/** Histórico de um SKU: as divergências dele, sessão por sessão, mais recentes primeiro. */
export function buildSkuHistory(items: DivergentItemRow[], sku: string): DivergentItemRow[] {
  return items.filter(i => i.sku === sku).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export interface RecurringLocationRow {
  location: string;
  sessionsAffected: number;
  distinctSkus: number;
  occurrences: number;
  lastOccurrenceAt: string;
}

export function computeRecurringLocations(items: DivergentItemRow[]): RecurringLocationRow[] {
  const byLocation = new Map<string, DivergentItemRow[]>();
  for (const item of items) {
    const location = item.location?.trim();
    if (!location) continue;
    const list = byLocation.get(location) ?? [];
    list.push(item);
    byLocation.set(location, list);
  }

  return Array.from(byLocation.entries())
    .map(([location, list]) => ({
      location,
      sessionsAffected: new Set(list.map(i => i.sessionId)).size,
      distinctSkus: new Set(list.map(i => i.sku).filter((s): s is string => !!s)).size,
      occurrences: list.length,
      lastOccurrenceAt: lastOf(list).occurredAt,
    }))
    .filter(row => row.sessionsAffected >= MIN_RECURRENCE_SESSIONS)
    .sort((a, b) =>
      b.sessionsAffected - a.sessionsAffected ||
      b.occurrences - a.occurrences ||
      b.lastOccurrenceAt.localeCompare(a.lastOccurrenceAt));
}

export interface RecurringCauseRow {
  causeKey: string;
  causeLabel: string;
  occurrences: number;
  distinctSkus: number;
  sessionsAffected: number;
  lastOccurrenceAt: string;
}

/** Causas recorrentes a partir da classificação REAL do RCA, ligada por source_item_id.
 *  Nenhuma inferência por texto, nenhuma classificação automática: item sem classificação
 *  simplesmente não entra — ausência de RCA é ausência de evidência, não uma causa. */
export function computeRecurringCauses(
  items: DivergentItemRow[],
  rcaLinks: RcaItemLink[]
): RecurringCauseRow[] {
  const itemById = new Map(items.map(i => [i.itemId, i]));
  const byCause = new Map<string, { label: string; entries: { link: RcaItemLink; item: DivergentItemRow }[] }>();

  for (const link of rcaLinks) {
    const item = itemById.get(link.sourceItemId);
    if (!item) continue;
    const bucket = byCause.get(link.causeKey) ?? { label: link.causeLabel, entries: [] };
    bucket.entries.push({ link, item });
    byCause.set(link.causeKey, bucket);
  }

  return Array.from(byCause.entries())
    .map(([causeKey, bucket]) => ({
      causeKey,
      causeLabel: bucket.label,
      occurrences: bucket.entries.length,
      distinctSkus: new Set(bucket.entries.map(e => e.item.sku).filter((s): s is string => !!s)).size,
      sessionsAffected: new Set(bucket.entries.map(e => e.item.sessionId)).size,
      lastOccurrenceAt: [...bucket.entries]
        .sort((a, b) => b.link.occurredAt.localeCompare(a.link.occurredAt))[0].link.occurredAt,
    }))
    .filter(row => row.sessionsAffected >= MIN_RECURRENCE_SESSIONS)
    .sort((a, b) =>
      b.occurrences - a.occurrences ||
      b.sessionsAffected - a.sessionsAffected ||
      b.lastOccurrenceAt.localeCompare(a.lastOccurrenceAt));
}

export interface RecurrenceOverview {
  recurringSkus: RecurringSkuRow[];
  recurringLocations: RecurringLocationRow[];
  recurringCauses: RecurringCauseRow[];
  /** Sessões que entraram na análise (as da janela, com ou sem divergência). */
  sessionsAnalyzed: number;
  divergencesAnalyzed: number;
  windowDays: number;
  thresholdCount: number;
  /** Nenhuma divergência classificada no RCA na janela — ausência de evidência, não saúde. */
  rcaLinksAvailable: number;
}
