// Rankings — cálculos puros sobre registros de contagem já carregados
// (inventory_count_records). Mesmo espírito de executiveKpis.ts/rcaAlgorithm.ts:
// sem I/O — a página busca as linhas, estas funções só agregam/derivam.
//
// MIN_RANKING_SAMPLE centraliza a regra de elegibilidade: nenhuma entidade
// (linha ou operador) pode aparecer como destaque, ranking positivo/negativo ou
// classificação de risco antes de contabilizar essa quantidade de SKUs — uma
// amostra pequena nunca é premiada nem punida.

export const MIN_RANKING_SAMPLE = 50;

export interface RankingCountRecord {
  brand_id: string;
  created_by: string | null;
  created_at: string;
  skus_contados: number;
  divergencias_reais: number;
  duration_seconds: number | null;
}

export interface EntityPeriodStat {
  id: string;
  name: string;
  skus: number;
  /** SKUs/h real, a partir de duration_seconds — null quando nenhum registro da
   *  entidade tem duração cronometrada (ex.: contagens importadas). Nunca
   *  estimado a partir de outra unidade. */
  ritmoPerHour: number | null;
  accuracy: number | null;
  divergencias: number;
  divergenciasPor100: number | null;
}

function dateToLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildStat(id: string, name: string, skus: number, divergencias: number, durationSeconds: number): EntityPeriodStat {
  // Mesma fórmula oficial de computeGlobalStats (blindAIAgentAlgorithm.ts):
  // (contados - divergências) / contados — aplicada à amostra agregada aqui.
  const accuracy = skus > 0 ? Math.max(0, ((skus - divergencias) / skus) * 100) : null;
  const divergenciasPor100 = skus > 0 ? (divergencias / skus) * 100 : null;
  const ritmoPerHour = durationSeconds > 0 ? skus / (durationSeconds / 3600) : null;
  return { id, name, skus, ritmoPerHour, accuracy, divergencias, divergenciasPor100 };
}

/** Agrega registros por entidade (linha ou operador, conforme `keyOf`) — uma
 *  única implementação para os dois casos. `durationOf` deixa a chamada
 *  decidir se soma duration_seconds (só faz sentido quando o registro tem
 *  cronometragem real). */
export function groupEntityPeriodStats(
  records: RankingCountRecord[],
  keyOf: (r: RankingCountRecord) => string | null,
  nameById: Map<string, string | null>,
): EntityPeriodStat[] {
  const map = new Map<string, { skus: number; divergencias: number; duration: number }>();
  records.forEach(r => {
    const key = keyOf(r);
    if (!key) return;
    const entry = map.get(key) ?? { skus: 0, divergencias: 0, duration: 0 };
    entry.skus += r.skus_contados ?? 0;
    entry.divergencias += r.divergencias_reais ?? 0;
    entry.duration += r.duration_seconds ?? 0;
    map.set(key, entry);
  });
  return Array.from(map.entries()).map(([id, e]) =>
    buildStat(id, nameById.get(id) ?? '—', e.skus, e.divergencias, e.duration));
}

export type Situacao = 'sem_amostra' | 'risco' | 'acompanhar' | 'referencia';

export const SITUACAO_LABEL: Record<Situacao, string> = {
  sem_amostra: 'Sem amostra',
  risco: 'Risco',
  acompanhar: 'Acompanhar',
  referencia: 'Referência',
};

/** Sem amostra < 50 SKUs; abaixo da meta com amostra suficiente é risco;
 *  dentro (ou acima) da meta com amostra suficiente é referência. "Acompanhar"
 *  cobre o caso defensivo de amostra suficiente sem acuracidade calculável. */
export function computeSituacao(skus: number, accuracy: number | null, meta: number): Situacao {
  if (skus < MIN_RANKING_SAMPLE) return 'sem_amostra';
  if (accuracy === null) return 'acompanhar';
  if (accuracy < meta) return 'risco';
  return 'referencia';
}

/** Até `limit` entidades elegíveis (amostra mínima + dentro da meta),
 *  ordenadas por acuracidade e depois ritmo — nunca premia amostra pequena. */
export function pickDestaquesConsistentes(stats: EntityPeriodStat[], meta: number, limit = 3): EntityPeriodStat[] {
  return stats
    .filter(s => s.skus >= MIN_RANKING_SAMPLE && s.accuracy !== null && s.accuracy >= meta)
    .sort((a, b) => {
      if ((b.accuracy ?? 0) !== (a.accuracy ?? 0)) return (b.accuracy ?? 0) - (a.accuracy ?? 0);
      return (b.ritmoPerHour ?? 0) - (a.ritmoPerHour ?? 0);
    })
    .slice(0, limit);
}

/** Ordenação do Ranking de Operadores: elegíveis que atingiram a meta primeiro,
 *  depois maior acuracidade, depois menor divergência/100, ritmo só como
 *  desempate final. Velocidade nunca posiciona acima quem está abaixo da meta. */
export function compareByQualityFirst(a: EntityPeriodStat, b: EntityPeriodStat, meta: number): number {
  const aOk = a.skus >= MIN_RANKING_SAMPLE && a.accuracy !== null && a.accuracy >= meta;
  const bOk = b.skus >= MIN_RANKING_SAMPLE && b.accuracy !== null && b.accuracy >= meta;
  if (aOk !== bOk) return aOk ? -1 : 1;

  const accA = a.accuracy ?? -Infinity;
  const accB = b.accuracy ?? -Infinity;
  if (accB !== accA) return accB - accA;

  const dpA = a.divergenciasPor100 ?? Infinity;
  const dpB = b.divergenciasPor100 ?? Infinity;
  if (dpA !== dpB) return dpA - dpB;

  return (b.ritmoPerHour ?? 0) - (a.ritmoPerHour ?? 0);
}

// ── Tendência de 7 dias (linhas e operadores) ───────────────────────────────

interface DayBucket { skus: number; divergencias: number; }

/** Um mapa entidade → (dia local → soma do dia), para ler a tendência de
 *  qualquer entidade sem refazer a varredura dos registros por linha. */
export function dailyStatsByEntity(
  records: RankingCountRecord[],
  keyOf: (r: RankingCountRecord) => string | null,
): Map<string, Map<string, DayBucket>> {
  const result = new Map<string, Map<string, DayBucket>>();
  records.forEach(r => {
    const key = keyOf(r);
    if (!key) return;
    const day = dateToLocalISO(new Date(r.created_at));
    let byDay = result.get(key);
    if (!byDay) { byDay = new Map(); result.set(key, byDay); }
    const entry = byDay.get(day) ?? { skus: 0, divergencias: 0 };
    entry.skus += r.skus_contados ?? 0;
    entry.divergencias += r.divergencias_reais ?? 0;
    byDay.set(day, entry);
  });
  return result;
}

export interface TrendSummary {
  points: { dateISO: string; accuracy: number }[]; // só dias com SKUs > 0 (histórico real)
  totalSkus: number;
  varianceP: number | null; // último ponto - primeiro ponto, em pontos percentuais
  avgAccuracy: number | null;
}

const EMPTY_TREND: TrendSummary = { points: [], totalSkus: 0, varianceP: null, avgAccuracy: null };

export function summarizeTrend(byDay: Map<string, DayBucket> | undefined): TrendSummary {
  if (!byDay) return EMPTY_TREND;
  const days = Array.from(byDay.keys()).sort();
  const points = days
    .map(d => {
      const e = byDay.get(d)!;
      if (e.skus <= 0) return null;
      return { dateISO: d, accuracy: Math.max(0, ((e.skus - e.divergencias) / e.skus) * 100) };
    })
    .filter((p): p is { dateISO: string; accuracy: number } => p !== null);
  const totalSkus = days.reduce((s, d) => s + (byDay.get(d)?.skus ?? 0), 0);
  const varianceP = points.length >= 2 ? points[points.length - 1].accuracy - points[0].accuracy : null;
  const avgAccuracy = points.length > 0 ? points.reduce((s, p) => s + p.accuracy, 0) / points.length : null;
  return { points, totalSkus, varianceP, avgAccuracy };
}

export interface AttentionRow {
  id: string;
  title: string;
  detail: string;
}

/** Maior queda de acuracidade nos últimos 7 dias — só considerada quando há
 *  pelo menos 2 dias com contagem real (nunca extrapola de 1 ponto). */
function pickBiggestDrop(
  entities: { id: string; name: string; trend: TrendSummary }[],
  thresholdPts = 10,
): { id: string; name: string; deltaPts: number } | null {
  const candidates = entities.filter(e => e.trend.points.length >= 2 && (e.trend.varianceP ?? 0) <= -thresholdPts);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.trend.varianceP ?? 0) - (b.trend.varianceP ?? 0));
  const c = candidates[0];
  return { id: c.id, name: c.name, deltaPts: c.trend.varianceP ?? 0 };
}

/** Painel "Atenção Necessária": riscos objetivos derivados dos mesmos dados do
 *  painel de comparação — nunca uma lista separada ou hardcoded. */
export function buildAttentionRows(
  stats: EntityPeriodStat[],
  trendById: Map<string, TrendSummary>,
  meta: number,
): AttentionRow[] {
  const rows: AttentionRow[] = [];

  const withSample = stats.filter(s => s.skus > 0 && s.divergenciasPor100 !== null);
  if (withSample.length > 0) {
    const top = [...withSample].sort((a, b) => (b.divergenciasPor100 ?? 0) - (a.divergenciasPor100 ?? 0))[0];
    rows.push({
      id: `div_${top.id}`,
      title: top.name,
      detail: `${top.divergencias} divergências · ${(top.divergenciasPor100 ?? 0).toFixed(1)} por 100 SKUs`,
    });
  }

  const risky = stats.filter(s => computeSituacao(s.skus, s.accuracy, meta) === 'risco');
  if (risky.length > 0) {
    rows.push({ id: `acc_${risky[0].id}`, title: risky[0].name, detail: 'Acuracidade abaixo da meta' });
  }

  const noSample = stats.filter(s => s.skus > 0 && s.skus < MIN_RANKING_SAMPLE);
  if (noSample.length > 0) {
    rows.push({
      id: 'no_sample',
      title: noSample.length === 1 ? noSample[0].name : `${noSample.length} linhas`,
      detail: 'Sem amostra mínima',
    });
  }

  const drop = pickBiggestDrop(stats.map(s => ({ id: s.id, name: s.name, trend: trendById.get(s.id) ?? EMPTY_TREND })));
  if (drop) {
    rows.push({ id: `drop_${drop.id}`, title: drop.name, detail: `Queda de ${Math.abs(drop.deltaPts).toFixed(1)} p.p. nos últimos 7 dias` });
  }

  return rows;
}
