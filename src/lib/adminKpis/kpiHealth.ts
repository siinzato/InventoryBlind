// Regras puras, determinísticas e centralizadas para o resumo operacional e os alertas
// prioritários do bloco "KPIs e Indicadores" (Painel Administrativo). Nenhuma IA, nenhum motor
// de recomendação — só limiares fixos e documentados sobre dados já existentes:
//
//   - acuracidade de inventários FECHADOS (InventorySnapshot.accuracy, já usada em
//     OverviewTab/DangerZoneSection) é o único indicador com meta REAL hoje: o dashboard
//     principal (App.tsx, bloco "Meta de Acuracidade") já usa 95% como alvo e 80% como piso de
//     atenção. Reaproveitamos exatamente esses números aqui — não é um corte novo, é o mesmo já
//     mostrado ao usuário em outro lugar do produto.
//   - custom_kpis (Produtividade Média, Taxa de Erro, etc.) não têm coluna de meta nem série
//     histórica hoje — por isso nunca recebem status "dentro da meta/atenção/crítico": teriam
//     que assumir se "subir" é bom ou ruim para cada indicador, o que não está nos dados.
//
// Mesmo padrão de limiar documentado e ajustável já usado em
// physicalCount/recountPolicy.ts (DEFAULT_RECOUNT_SETTINGS.thresholdValue).

export type HealthStatus = 'saudavel' | 'atencao' | 'critico' | 'insuficiente';

export interface AccuracyPoint {
  date: string; // end_date do inventário fechado (YYYY-MM-DD)
  accuracy: number;
}

/** Mesma meta já exibida em App.tsx ("Meta de Acuracidade": {valor}% / 95%). */
export const ACCURACY_TARGET_PCT = 95;
/** Mesmo piso de atenção já usado no gradiente de cor daquele mesmo bloco. */
export const ACCURACY_WARNING_FLOOR_PCT = 80;

/** Classifica a acuracidade ATUAL contra a meta já existente no dashboard principal —
 *  >=95% dentro da meta, 80–94.9% atenção, <80% crítico. `null` (nenhum inventário fechado
 *  ainda) é "insuficiente", nunca tratado como dentro da meta por omissão. */
export function classifyAccuracyByTarget(accuracy: number | null): HealthStatus {
  if (accuracy === null) return 'insuficiente';
  if (accuracy >= ACCURACY_TARGET_PCT) return 'saudavel';
  if (accuracy >= ACCURACY_WARNING_FLOOR_PCT) return 'atencao';
  return 'critico';
}

/** Queda de acuracidade (pontos percentuais) entre os dois últimos inventários fechados a
 *  partir da qual tratamos como "piora relevante" na tendência (independente da meta — um
 *  indicador pode estar dentro da meta e ainda assim ter piorado). Qualquer queda menor que
 *  isso, mas ainda negativa, já entra como sinal de tendência negativa (sem gerar alerta próprio). */
export const CRITICAL_ACCURACY_DROP_POINTS = 5;

/** Dias sem atualização a partir dos quais um indicador manual é considerado parado. */
export const STALE_KPI_DAYS = 30;

/** Quantos pontos do histórico de acuracidade o gráfico de evolução mostra. */
export const ACCURACY_HISTORY_LIMIT = 8;

export type TrendSignal = 'melhora' | 'piora_relevante' | 'piora_leve' | 'estavel' | 'insuficiente';

export interface AccuracyTrend {
  /** Sinal de TENDÊNCIA (delta vs. inventário anterior) — independente da meta. Um indicador
   *  pode estar "dentro da meta" (classifyAccuracyByTarget) e ainda ter piorado, ou vice-versa. */
  trend: TrendSignal;
  latest: AccuracyPoint | null;
  previous: AccuracyPoint | null;
  /** latest.accuracy - previous.accuracy. null quando não há os dois pontos. */
  deltaPoints: number | null;
}

/** Ordena por data e compara os dois últimos pontos. Menos de dois pontos = tendência não
 *  pode ser calculada ("insuficiente"), nunca tratada como estável por omissão. */
export function computeAccuracyTrend(points: readonly AccuracyPoint[]): AccuracyTrend {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1] ?? null;
  const previous = sorted[sorted.length - 2] ?? null;

  if (!latest || !previous) {
    return { trend: 'insuficiente', latest, previous: null, deltaPoints: null };
  }

  const deltaPoints = latest.accuracy - previous.accuracy;
  const trend: TrendSignal =
    deltaPoints <= -CRITICAL_ACCURACY_DROP_POINTS ? 'piora_relevante'
    : deltaPoints < 0 ? 'piora_leve'
    : deltaPoints > 0 ? 'melhora'
    : 'estavel';
  return { trend, latest, previous, deltaPoints };
}

/** `updatedAt` inválido nunca é tratado como "parado" — dado ruim não vira alarme falso. */
export function isKpiStale(updatedAt: string, referenceDate: Date, staleDays = STALE_KPI_DAYS): boolean {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return false;
  const diffDays = (referenceDate.getTime() - updated) / (1000 * 60 * 60 * 24);
  return diffDays >= staleDays;
}

export interface OperationalSummary {
  status: HealthStatus;
  /** Indicadores mostrados no total (custom KPIs + Acuracidade). */
  totalIndicators: number;
  /** Custom KPIs não têm meta configurada hoje — todos entram aqui. */
  semMeta: number;
  emAtencao: number;
  criticos: number;
  /** Nome do indicador que mais merece olhar primeiro, ou null se nada chama atenção. */
  destaque: string | null;
}

export function computeOperationalSummary(input: {
  customKpiCount: number;
  /** Status da acuracidade contra a meta (classifyAccuracyByTarget) — decide a situação geral. */
  accuracyStatus: HealthStatus;
  staleKpiNames: readonly string[];
}): OperationalSummary {
  const { customKpiCount, accuracyStatus, staleKpiNames } = input;
  const criticos = accuracyStatus === 'critico' ? 1 : 0;
  const emAtencao = accuracyStatus === 'atencao' ? 1 : 0;

  const status: HealthStatus = accuracyStatus;

  const destaque =
    criticos > 0 || emAtencao > 0 ? 'Acuracidade do inventário'
    : staleKpiNames[0] ?? null;

  return { status, totalIndicators: customKpiCount + 1, semMeta: customKpiCount, emAtencao, criticos, destaque };
}

export type AlertSeverity = 'critico' | 'atencao' | 'info';

export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  description: string;
  evidence: string;
  actionKey?: 'open-inventories' | 'manage-kpis';
  actionLabel?: string;
}

/** Máximo 3 alertas, priorizados: abaixo da meta > piora relevante de tendência > histórico
 *  insuficiente > indicadores parados > indicadores sem meta. Um mesmo evento (ex.: acuracidade
 *  crítica que também piorou) gera só o alerta de maior prioridade, nunca dois sobre a mesma
 *  causa. Slots vazios não são preenchidos com algo inventado — se nada se aplica, a lista fica
 *  menor que 3. */
export function buildPriorityAlerts(input: {
  accuracyStatus: HealthStatus;
  accuracyTrend: AccuracyTrend;
  staleKpiNames: readonly string[];
  semMetaCount: number;
}): OperationalAlert[] {
  const { accuracyStatus, accuracyTrend, staleKpiNames, semMetaCount } = input;
  const alerts: OperationalAlert[] = [];

  if (accuracyStatus === 'critico' || accuracyStatus === 'atencao') {
    alerts.push({
      id: 'accuracy-below-target',
      severity: accuracyStatus === 'critico' ? 'critico' : 'atencao',
      description: accuracyStatus === 'critico'
        ? `Acuracidade abaixo do piso de ${ACCURACY_WARNING_FLOOR_PCT}%.`
        : `Acuracidade abaixo da meta de ${ACCURACY_TARGET_PCT}%.`,
      evidence: accuracyTrend.latest ? `${accuracyTrend.latest.accuracy.toFixed(1)}% (meta: ${ACCURACY_TARGET_PCT}%)` : `Meta: ${ACCURACY_TARGET_PCT}%`,
      actionKey: 'open-inventories',
      actionLabel: 'Ver inventários',
    });
  } else if (accuracyTrend.trend === 'piora_relevante' || accuracyTrend.trend === 'piora_leve') {
    // Dentro da meta mas piorando — sinal diferente do anterior, vale o próprio alerta.
    alerts.push({
      id: 'accuracy-worsening',
      severity: accuracyTrend.trend === 'piora_relevante' ? 'atencao' : 'info',
      description: 'Acuracidade piorou em relação ao inventário anterior, mesmo dentro da meta.',
      evidence: accuracyTrend.latest && accuracyTrend.previous && accuracyTrend.deltaPoints !== null
        ? `${accuracyTrend.previous.accuracy.toFixed(1)}% → ${accuracyTrend.latest.accuracy.toFixed(1)}% (${accuracyTrend.deltaPoints.toFixed(1)} p.p.)`
        : '—',
      actionKey: 'open-inventories',
      actionLabel: 'Ver inventários',
    });
  } else if (accuracyTrend.trend === 'insuficiente') {
    alerts.push({
      id: 'accuracy-insufficient',
      severity: 'info',
      description: 'Histórico insuficiente para avaliar a tendência de acuracidade.',
      evidence: accuracyTrend.latest ? '1 inventário fechado registrado' : 'Nenhum inventário fechado registrado ainda',
    });
  }

  if (alerts.length < 3 && staleKpiNames.length > 0) {
    alerts.push({
      id: 'stale-kpis',
      severity: 'atencao',
      description: staleKpiNames.length === 1
        ? `"${staleKpiNames[0]}" está sem atualização há mais de ${STALE_KPI_DAYS} dias.`
        : `${staleKpiNames.length} indicadores sem atualização há mais de ${STALE_KPI_DAYS} dias.`,
      evidence: staleKpiNames.slice(0, 3).join(', '),
      actionKey: 'manage-kpis',
      actionLabel: 'Gerenciar indicadores',
    });
  }

  if (alerts.length < 3 && semMetaCount > 0) {
    alerts.push({
      id: 'missing-targets',
      severity: 'info',
      description: `${semMetaCount} ${semMetaCount === 1 ? 'indicador não tem' : 'indicadores não têm'} meta configurada.`,
      evidence: 'Sem meta, não é possível avaliar se o indicador está dentro do esperado.',
      actionKey: 'manage-kpis',
      actionLabel: 'Gerenciar indicadores',
    });
  }

  return alerts.slice(0, 3);
}
