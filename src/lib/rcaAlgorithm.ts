// Root Cause Analysis — catálogo de causas e funções puras de agregação.
//
// Sem I/O: recebe listas de RcaRecord/RcaCase já carregadas (pelo serviço) e calcula
// Pareto, recorrência, escalonamento, confiança e agrupamentos. Mantém o mesmo espírito
// de riskAlgorithm.ts/cbcAlgorithm.ts — pontuação/estatística isolada da camada de acesso
// a dados.
//
// AVISO PARA QUEM CONSOME DAQUI (fora do módulo RCA): computeParetoBuckets,
// groupByDimension, computeTrend, topConcentration, checkRecurrence e CAUSE_LABEL
// continuam com a mesma assinatura/formato de antes da reformulação — usados por
// InventoryHealthPage/TrendAnalysisPanel/auditsAnalyticsService/blindAIInsightsEngine/
// WarehouseAnalyticsPanel/edge function blindai-agent. Não renomeie nem mude o formato
// sem checar esses consumidores.

import type {
  RcaCauseCategory, RcaRecord, RcaProcessArea, RcaSeverity, RcaCaseStatus, RcaRootCauseStatus,
  RcaActionType, RcaVerificationResult,
} from './domainTypes';

// ── Processo afetado — fixo, não configurável por workspace ─────────────────────────────
export const PROCESS_AREAS: { value: RcaProcessArea; label: string }[] = [
  { value: 'recebimento', label: 'Recebimento' },
  { value: 'armazenagem', label: 'Armazenagem' },
  { value: 'picking', label: 'Picking' },
  { value: 'separacao', label: 'Separação' },
  { value: 'expedicao', label: 'Expedição' },
  { value: 'inventario', label: 'Inventário' },
  { value: 'logistica_reversa', label: 'Logística Reversa' },
  { value: 'cadastro', label: 'Cadastro' },
  { value: 'integracao_sincronizacao', label: 'Integração/Sincronização' },
  { value: 'outro', label: 'Outro' },
];
export const PROCESS_AREA_LABEL: Record<RcaProcessArea, string> = PROCESS_AREAS.reduce(
  (acc, p) => ({ ...acc, [p.value]: p.label }),
  {} as Record<RcaProcessArea, string>
);

// ── Categoria de causa — padrões fornecidos a toda empresa; configurável por workspace
//    via rca_cause_categories/rca_cause_subcauses (ativa/desativa padrão, adiciona custom).
//    Nomes de operador nunca entram aqui — são sempre contexto, nunca causa.
export const DEFAULT_CAUSE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'metodo_procedimento', label: 'Método/Procedimento' },
  { value: 'sistema', label: 'Sistema' },
  { value: 'dados_cadastro', label: 'Dados/Cadastro' },
  { value: 'equipamento_infraestrutura', label: 'Equipamento/Infraestrutura' },
  { value: 'produto_embalagem', label: 'Produto/Embalagem' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'treinamento_comunicacao', label: 'Treinamento/Comunicação' },
  { value: 'planejamento', label: 'Planejamento' },
  { value: 'controle_governanca', label: 'Controle/Governança' },
  { value: 'causa_externa', label: 'Causa Externa' },
  { value: 'nao_determinada', label: 'Não Determinada' },
];

/** Mantido com este nome por compatibilidade — consumido fora do módulo RCA
 *  (KpisIndicadoresPage, blindAIInsightsEngine, edge function blindai-agent). */
export const CAUSE_LABEL: Record<RcaCauseCategory, string> = DEFAULT_CAUSE_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<RcaCauseCategory, string>
);

export const DEFAULT_SUBCAUSES: Record<string, { value: string; label: string }[]> = {
  metodo_procedimento: [
    { value: 'procedimento_nao_seguido', label: 'Procedimento não seguido' },
    { value: 'excecao_operacional_sem_controle', label: 'Exceção operacional sem controle' },
    { value: 'checklist_incompleto', label: 'Checklist incompleto' },
  ],
  sistema: [
    { value: 'falha_integracao', label: 'Falha de integração' },
    { value: 'erro_sincronizacao', label: 'Erro de sincronização' },
    { value: 'bug_sistema', label: 'Bug de sistema' },
  ],
  dados_cadastro: [
    { value: 'cadastro_incompleto', label: 'Cadastro incompleto' },
    { value: 'ean_incorreto', label: 'EAN incorreto' },
    { value: 'endereco_incorreto', label: 'Endereço incorreto' },
  ],
  equipamento_infraestrutura: [
    { value: 'equipamento_com_defeito', label: 'Equipamento com defeito' },
    { value: 'infraestrutura_inadequada', label: 'Infraestrutura inadequada' },
  ],
  produto_embalagem: [
    { value: 'embalagem_inadequada', label: 'Embalagem inadequada' },
    { value: 'produto_avariado', label: 'Produto avariado' },
    { value: 'similaridade_produto', label: 'Similaridade entre produtos' },
  ],
  fornecedor: [
    { value: 'divergencia_fornecedor', label: 'Divergência do fornecedor' },
    { value: 'atraso_fornecedor', label: 'Atraso do fornecedor' },
  ],
  treinamento_comunicacao: [
    { value: 'falta_treinamento', label: 'Falta de treinamento' },
    { value: 'comunicacao_falha', label: 'Falha de comunicação' },
  ],
  planejamento: [
    { value: 'planejamento_inadequado', label: 'Planejamento inadequado' },
    { value: 'dimensionamento_incorreto', label: 'Dimensionamento incorreto' },
  ],
  controle_governanca: [
    { value: 'governanca_insuficiente', label: 'Governança insuficiente' },
    { value: 'permissao_indevida', label: 'Permissão indevida' },
    { value: 'ausencia_dupla_checagem', label: 'Ausência de dupla checagem' },
  ],
  causa_externa: [
    { value: 'fator_externo', label: 'Fator externo' },
    { value: 'furto_terceiros', label: 'Furto por terceiros' },
  ],
  nao_determinada: [
    { value: 'em_apuracao', label: 'Em apuração' },
  ],
};

export const SEVERITY_OPTIONS: { value: RcaSeverity; label: string }[] = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'media', label: 'Média' },
  { value: 'alta', label: 'Alta' },
  { value: 'critica', label: 'Crítica' },
];
export const SEVERITY_LABEL: Record<RcaSeverity, string> = SEVERITY_OPTIONS.reduce(
  (acc, s) => ({ ...acc, [s.value]: s.label }),
  {} as Record<RcaSeverity, string>
);
const SEVERITY_RANK: Record<RcaSeverity, number> = { critica: 4, alta: 3, media: 2, baixa: 1 };

export const CASE_STATUS_LABEL: Record<RcaCaseStatus, string> = {
  rascunho: 'Rascunho',
  em_investigacao: 'Em investigação',
  causa_proposta: 'Causa proposta',
  plano_em_execucao: 'Plano em execução',
  aguardando_verificacao: 'Aguardando verificação',
  eficaz: 'Eficaz',
  ineficaz_reaberto: 'Ineficaz/Reaberto',
  encerrado: 'Encerrado',
};

export interface ParetoBucket {
  category: RcaCauseCategory;
  count: number;
  pctOfTotal: number;
  cumulativePct: number;
}

/** Pareto 80/20: causas ordenadas por frequência desc, com % acumulado. */
export function computeParetoBuckets(records: RcaRecord[]): ParetoBucket[] {
  const total = records.length;
  if (total === 0) return [];

  const counts = new Map<RcaCauseCategory, number>();
  for (const r of records) if (r.cause_category) counts.set(r.cause_category, (counts.get(r.cause_category) ?? 0) + 1);

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  let cumulative = 0;
  return sorted.map(([category, count]) => {
    const pctOfTotal = (count / total) * 100;
    cumulative += pctOfTotal;
    return { category, count, pctOfTotal, cumulativePct: cumulative };
  });
}

export interface RecurrenceResult {
  skuRecurrence: boolean;
  skuOccurrenceCount: number;
  causeRecurrence: boolean;
  causeOccurrenceCount: number;
}

/**
 * Legado (pré-reformulação): conta quantas vezes o mesmo SKU (ou a mesma causa) já
 * apareceu em `recentRecords`. Mantida por compatibilidade — a nova lógica de
 * recorrência de caso usa `groupByRecurrenceSignature`/`countRecurrenceForRecord`
 * abaixo, que respeita categoria+subcausa+contexto em vez de só SKU ou só categoria.
 */
export function checkRecurrence(
  recentRecords: RcaRecord[],
  newRecord: Pick<RcaRecord, 'sku' | 'cause_category'>,
  thresholdCount: number
): RecurrenceResult {
  const skuOccurrenceCount = newRecord.sku
    ? recentRecords.filter(r => r.sku === newRecord.sku).length
    : 0;
  const causeOccurrenceCount = recentRecords.filter(r => r.cause_category === newRecord.cause_category).length;

  return {
    skuRecurrence: !!newRecord.sku && skuOccurrenceCount >= thresholdCount,
    skuOccurrenceCount,
    causeRecurrence: causeOccurrenceCount >= thresholdCount,
    causeOccurrenceCount,
  };
}

// ── Recorrência (pós-reformulação) ───────────────────────────────────────────────────────
// Assinatura = categoria + subcausa (+ causa raiz confirmada, quando existir) + contexto
// (SKU, senão endereço, senão fornecedor, senão o processo) — nunca "mesmo processo" sozinho.

export type RecurrenceRecordShape = Pick<
  RcaRecord, 'cause_category' | 'subcause_code' | 'sku' | 'location' | 'supplier_name' | 'process_area' | 'occurred_at' | 'classification_status'
>;

export function buildRecurrenceSignature(record: RecurrenceRecordShape, confirmedRootCause?: string | null): string {
  const context = record.sku || record.location || record.supplier_name || record.process_area || 'sem-contexto';
  return [record.cause_category ?? 'sem-causa', record.subcause_code ?? 'sem-subcausa', confirmedRootCause ?? '', context].join('|');
}

/** Agrupa classificações completas por assinatura de recorrência dentro da janela
 *  (em dias). Só considera `classification_status === 'classified'` — pendentes não
 *  contam para recorrência ainda. */
export function groupByRecurrenceSignature(
  records: RecurrenceRecordShape[],
  windowDays: number,
  now: number = Date.now()
): Map<string, RecurrenceRecordShape[]> {
  const since = now - windowDays * 86400000;
  const groups = new Map<string, RecurrenceRecordShape[]>();
  for (const r of records) {
    if (r.classification_status !== 'classified') continue;
    if (new Date(r.occurred_at).getTime() < since) continue;
    const sig = buildRecurrenceSignature(r);
    const list = groups.get(sig) ?? [];
    list.push(r);
    groups.set(sig, list);
  }
  return groups;
}

/** Quantas ocorrências (incluindo a própria) compartilham a assinatura de `record`
 *  dentro da janela — usado tanto para decidir escalonamento quanto para exibir
 *  "N recorrências" no caso/tabela. */
export function countRecurrenceForRecord(
  record: RecurrenceRecordShape,
  recentClassifiedRecords: RecurrenceRecordShape[],
  windowDays: number,
  now: number = Date.now()
): number {
  const groups = groupByRecurrenceSignature(recentClassifiedRecords, windowDays, now);
  const sig = buildRecurrenceSignature(record);
  return groups.get(sig)?.length ?? 0;
}

// ── Escalonamento para RCA completo ──────────────────────────────────────────────────────
export interface RcaEscalationSettings {
  recurrenceThresholdCount: number;
  financialImpactThreshold: number | null;
}

export interface EscalationInput {
  severity: RcaSeverity;
  financialImpact: number | null;
  /** Verdadeiro quando a categoria de causa escolhida é "Controle/Governança" — a
   *  própria classificação já sinaliza falha de controle, sem precisar de um campo à parte. */
  controlFailure: boolean;
  manualEscalation: boolean;
  recurrenceCount: number;
}

export type EscalationReason =
  | 'severidade_alta_critica' | 'recorrencia' | 'impacto_financeiro' | 'falha_controle' | 'escalonamento_manual';

export interface EscalationResult {
  shouldEscalate: boolean;
  reasons: EscalationReason[];
}

/** Os 5 critérios do pedido — qualquer um já basta para exigir RCA completo. */
export function evaluateEscalation(input: EscalationInput, settings: RcaEscalationSettings): EscalationResult {
  const reasons: EscalationReason[] = [];
  if (input.severity === 'alta' || input.severity === 'critica') reasons.push('severidade_alta_critica');
  if (input.recurrenceCount >= settings.recurrenceThresholdCount) reasons.push('recorrencia');
  if (settings.financialImpactThreshold != null && input.financialImpact != null && input.financialImpact >= settings.financialImpactThreshold) {
    reasons.push('impacto_financeiro');
  }
  if (input.controlFailure) reasons.push('falha_controle');
  if (input.manualEscalation) reasons.push('escalonamento_manual');
  return { shouldEscalate: reasons.length > 0, reasons };
}

// ── Confiança da análise — cobertura determinística, nunca opinião de IA ────────────────
export interface CaseConfidenceInput {
  hasProblemDefined: boolean;
  evidenceCount: number;
  hasSustainedCause: boolean;
  hasActionPlan: boolean;
  hasEffectivenessCriteria: boolean;
}

/** % de 5 critérios de completude atendidos. Nunca persistida — sempre recalculada na
 *  leitura (mesma lição do bug de acuracidade cacheada em closingReportService.ts). */
export function computeCaseConfidence(input: CaseConfidenceInput): number {
  const checks = [
    input.hasProblemDefined,
    input.evidenceCount > 0,
    input.hasSustainedCause,
    input.hasActionPlan,
    input.hasEffectivenessCriteria,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// ── Priorização e proteção contra culpa automática ───────────────────────────────────────
export interface PriorityCaseInput {
  severity: RcaSeverity;
  recurrenceCount: number;
  financialImpact: number | null;
  dueAt: string | null;
}

/** Severidade → recorrência → impacto financeiro → prazo (mais próximo primeiro). */
export function sortPriorityCases<T extends PriorityCaseInput>(cases: T[]): T[] {
  return [...cases].sort((a, b) => {
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (b.recurrenceCount !== a.recurrenceCount) return b.recurrenceCount - a.recurrenceCount;
    const impactDelta = (b.financialImpact ?? 0) - (a.financialImpact ?? 0);
    if (impactDelta !== 0) return impactDelta;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return aDue - bDue;
  });
}

/** Um grupo recorrente com mais de um operador distinto sugere padrão sistêmico, não
 *  erro individual — usado para o badge "Padrão pode ser sistêmico", nunca para culpar. */
export function hasMultipleOperators(records: Pick<RcaRecord, 'operator_user_id'>[]): boolean {
  const ids = new Set(records.map(r => r.operator_user_id).filter((id): id is string => !!id));
  return ids.size > 1;
}

// ── Cadeia dos Porquês e causa raiz ───────────────────────────────────────────────────────
export function canConfirmRootCause(rootCauseText: string, evidenceCount: number): boolean {
  return rootCauseText.trim().length > 0 && evidenceCount > 0;
}

// ── Encerramento do caso ─────────────────────────────────────────────────────────────────
export interface ActionCloseCheck {
  actionType: RcaActionType;
  taskDone: boolean;
  taskBlocked: boolean;
  verificationResult: RcaVerificationResult | null;
}

export type CloseCaseBlocker =
  | 'causa_raiz_nao_confirmada' | 'sem_acao_corretiva' | 'acoes_pendentes' | 'eficacia_nao_verificada' | 'bloqueio_ativo';

export interface CanCloseCaseResult {
  canClose: boolean;
  blockers: CloseCaseBlocker[];
}

/** Causa confirmada + ≥1 ação corretiva + ações não-contenção concluídas + eficácia das
 *  corretivas verificada + nenhum bloqueio ativo. Contenção nunca conta como "a" ação que
 *  encerra o caso — ela só reduz impacto imediato. */
export function canCloseCase(rootCauseStatus: RcaRootCauseStatus | null, actions: ActionCloseCheck[]): CanCloseCaseResult {
  const blockers: CloseCaseBlocker[] = [];
  if (rootCauseStatus !== 'confirmada') blockers.push('causa_raiz_nao_confirmada');

  const corretivas = actions.filter(a => a.actionType === 'corretiva');
  if (corretivas.length === 0) blockers.push('sem_acao_corretiva');

  const pendentes = actions.filter(a => a.actionType !== 'contencao' && !a.taskDone);
  if (pendentes.length > 0) blockers.push('acoes_pendentes');

  if (corretivas.length > 0 && corretivas.some(a => a.verificationResult === null)) blockers.push('eficacia_nao_verificada');

  if (actions.some(a => a.taskBlocked)) blockers.push('bloqueio_ativo');

  return { canClose: blockers.length === 0, blockers };
}

export type RcaDimension = 'operator' | 'location' | 'sku' | 'supplier' | 'period' | 'cause_category';

export interface DimensionBucket {
  key: string;
  label: string;
  count: number;
}

/** Agrupamento genérico usado pelas visões "causas por operador/endereço/SKU/fornecedor/período"
 *  e, para Análise de Tendência (Auditoria de Estoque), também por categoria de causa. */
export function groupByDimension(records: RcaRecord[], dimension: RcaDimension): DimensionBucket[] {
  const keyOf = (r: RcaRecord): { key: string; label: string } => {
    switch (dimension) {
      case 'operator':
        return { key: r.operator_user_id ?? 'sem-operador', label: r.operator_name ?? 'Não informado' };
      case 'location':
        return { key: r.location ?? 'sem-local', label: r.location ?? 'Não informado' };
      case 'sku':
        return { key: r.sku ?? 'sem-sku', label: r.sku ?? 'Não informado' };
      case 'supplier':
        return { key: r.supplier_name ?? 'sem-fornecedor', label: r.supplier_name ?? 'Não informado' };
      case 'period':
        return { key: r.occurred_at.slice(0, 10), label: r.occurred_at.slice(0, 10) };
      case 'cause_category':
        return { key: r.cause_category ?? 'sem-causa', label: (r.cause_category && CAUSE_LABEL[r.cause_category]) ?? r.cause_category ?? 'Não classificado' };
    }
  };

  const buckets = new Map<string, DimensionBucket>();
  for (const r of records) {
    const { key, label } = keyOf(r);
    const existing = buckets.get(key);
    if (existing) existing.count += 1;
    else buckets.set(key, { key, label, count: 1 });
  }

  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

/** Filtro pelo valor de uma dimensão — usado pela Análise de Tendência para isolar os
 *  registros de um bucket específico (ex.: só location === "Rua B") antes de gerar a série
 *  temporal. Mesma lógica de chave de groupByDimension, só que como predicado. */
function matchesDimensionKey(r: RcaRecord, dimension: RcaDimension, key: string): boolean {
  switch (dimension) {
    case 'operator': return (r.operator_user_id ?? 'sem-operador') === key;
    case 'location': return (r.location ?? 'sem-local') === key;
    case 'sku': return (r.sku ?? 'sem-sku') === key;
    case 'supplier': return (r.supplier_name ?? 'sem-fornecedor') === key;
    case 'period': return r.occurred_at.slice(0, 10) === key;
    case 'cause_category': return (r.cause_category ?? 'sem-causa') === key;
  }
}

export interface TrendSeriesPoint {
  period: string;
  count: number;
}

export type TrendDirection = 'crescimento' | 'estabilidade' | 'reducao' | 'alerta_critico';

export interface TrendResult {
  series: TrendSeriesPoint[];
  direction: TrendDirection;
  pctChange: number | null;
  firstHalfCount: number;
  secondHalfCount: number;
  summary: string;
}

const TREND_DIRECTION_LABEL: Record<TrendDirection, string> = {
  crescimento: 'Crescimento',
  estabilidade: 'Estabilidade',
  reducao: 'Redução',
  alerta_critico: 'Alerta crítico',
};

/**
 * Série mensal de ocorrências para um valor de dimensão (ex.: location="Rua B"), mais a
 * classificação de tendência: compara a primeira metade da janela contra a segunda metade
 * (não mês-a-mês, para não depender de meses cheios) e classifica por variação percentual.
 * >=50% de aumento com volume relevante (>=5 no período recente) vira "alerta_critico" —
 * o mesmo padrão de frase do exemplo do pedido ("Rua B teve aumento de 32%...").
 */
export function computeTrend(records: RcaRecord[], dimension: RcaDimension, key: string, label: string): TrendResult {
  const filtered = records
    .filter(r => matchesDimensionKey(r, dimension, key))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const byMonth = new Map<string, number>();
  for (const r of filtered) {
    const month = r.occurred_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const series = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, count]) => ({ period, count }));

  if (filtered.length === 0) {
    return { series, direction: 'estabilidade', pctChange: null, firstHalfCount: 0, secondHalfCount: 0, summary: `Sem registros de divergência para ${label} no período.` };
  }

  const mid = Math.floor(filtered.length / 2);
  const firstHalfCount = mid;
  const secondHalfCount = filtered.length - mid;
  const pctChange = firstHalfCount > 0 ? ((secondHalfCount - firstHalfCount) / firstHalfCount) * 100 : null;

  let direction: TrendDirection = 'estabilidade';
  if (pctChange !== null) {
    if (pctChange >= 50 && secondHalfCount >= 5) direction = 'alerta_critico';
    else if (pctChange >= 15) direction = 'crescimento';
    else if (pctChange <= -15) direction = 'reducao';
  }

  const pctLabel = pctChange !== null ? `${pctChange >= 0 ? 'aumento' : 'redução'} de ${Math.abs(pctChange).toFixed(0)}%` : 'volume estável';
  const summary = pctChange !== null
    ? `${label} apresentou ${pctLabel} nas divergências (${firstHalfCount} → ${secondHalfCount} ocorrências) — ${TREND_DIRECTION_LABEL[direction].toLowerCase()}.`
    : `${label} tem ${filtered.length} divergência(s) registrada(s), volume insuficiente para comparar tendência.`;

  return { series, direction, pctChange, firstHalfCount, secondHalfCount, summary };
}

/** "Setor Full concentra 42% das divergências" — maior bucket de uma dimensão como % do total. */
export function topConcentration(records: RcaRecord[], dimension: RcaDimension): { label: string; pct: number } | null {
  if (records.length === 0) return null;
  const buckets = groupByDimension(records, dimension);
  if (buckets.length === 0) return null;
  const top = buckets[0];
  return { label: top.label, pct: (top.count / records.length) * 100 };
}
