// KPIs Executivos ("KPIs e Indicadores") — cálculos puros sobre registros de
// contagem já carregados (inventory_count_records). Sem I/O — mesmo espírito
// de rcaAlgorithm.ts/blindAIAgentAlgorithm.ts: a camada de acesso a dados
// (KpisIndicadoresPage.tsx) busca as linhas, estas funções só agregam.
//
// Não existe campo de prazo/data-alvo para o inventário no schema atual
// (inventory_brands não tem deadline) — por isso não há "ritmo necessário"
// nem "atraso" aqui: esses números só existem quando uma data-alvo real for
// introduzida. Ver nota em KpisIndicadoresPage.tsx.

export interface CountRecordForKpis {
  created_at: string;
  skus_contados: number;
  divergencias_encontradas: number;
  divergencias_recontadas: number;
  divergencias_reais: number;
  accuracy_final: number | null;
  created_by: string | null;
}

export interface DailyProductionPoint {
  dateISO: string; // YYYY-MM-DD, fuso local
  label: string;   // "16/mai"
  skus: number;
}

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dateToLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(dateISO: string): string {
  const [, m, d] = dateISO.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${MONTH_ABBR[m - 1]}`;
}

/** Uma barra por dia do intervalo [fromISO, toISO] (inclusive), mesmo sem
 *  contagem naquele dia (0) — para o eixo do gráfico não "pular" dias. Datas
 *  agrupadas no fuso LOCAL do navegador (mesma convenção de bucketByDueDate
 *  em taskDomain.ts), nunca em UTC. */
export function groupDailyProduction(
  records: Pick<CountRecordForKpis, 'created_at' | 'skus_contados'>[],
  fromISO: string,
  toISO: string,
): DailyProductionPoint[] {
  const byDay = new Map<string, number>();
  records.forEach(r => {
    const day = dateToLocalISO(new Date(r.created_at));
    byDay.set(day, (byDay.get(day) ?? 0) + (r.skus_contados ?? 0));
  });

  const points: DailyProductionPoint[] = [];
  const cursor = new Date(`${fromISO}T00:00:00`);
  const end = new Date(`${toISO}T00:00:00`);
  while (cursor.getTime() <= end.getTime()) {
    const dateISO = dateToLocalISO(cursor);
    points.push({ dateISO, label: formatDayLabel(dateISO), skus: byDay.get(dateISO) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

/** Ritmo médio real do período (nunca hardcoded) — total de SKUs contados
 *  dividido pelos dias corridos do intervalo selecionado. */
export function averageDailyProduction(points: DailyProductionPoint[]): number {
  if (points.length === 0) return 0;
  const total = points.reduce((s, p) => s + p.skus, 0);
  return total / points.length;
}

/** Divergências encontradas que ainda não foram recontadas — backlog real, não estimado. */
export function pendingRecount(records: Pick<CountRecordForKpis, 'divergencias_encontradas' | 'divergencias_recontadas'>[]): number {
  return records.reduce((sum, r) => sum + Math.max(0, (r.divergencias_encontradas ?? 0) - (r.divergencias_recontadas ?? 0)), 0);
}

/** Dias úteis estimados até zerar o pendente, no ritmo atual. `null` quando o
 *  ritmo é 0 e ainda há pendência (não dá para prever "nunca" como um número). */
export function forecastBusinessDays(pendingSkus: number, ritmoPerDay: number): number | null {
  if (pendingSkus <= 0) return 0;
  if (ritmoPerDay <= 0) return null;
  return Math.ceil(pendingSkus / ritmoPerDay);
}

export interface OperatorPeriodStat {
  userId: string;
  name: string | null;
  skus: number;
  ritmoPerDay: number;
  accuracy: number | null;
  divergencias: number;
}

/** Agrega os registros do período por operador (created_by) — mesma
 *  metodologia de getProductivityForPeriod (productivityService.ts), só que
 *  para todos os operadores da empresa de uma vez, sem N+1. */
export function groupOperatorPeriodStats(
  records: CountRecordForKpis[],
  nameByUserId: Map<string, string | null>,
  periodDays: number,
): OperatorPeriodStat[] {
  const map = new Map<string, { skus: number; divergencias: number; accSum: number; accCount: number }>();
  records.forEach(r => {
    if (!r.created_by) return;
    const entry = map.get(r.created_by) ?? { skus: 0, divergencias: 0, accSum: 0, accCount: 0 };
    entry.skus += r.skus_contados ?? 0;
    entry.divergencias += r.divergencias_reais ?? 0;
    if (r.accuracy_final !== null) { entry.accSum += r.accuracy_final; entry.accCount += 1; }
    map.set(r.created_by, entry);
  });

  return Array.from(map.entries())
    .map(([userId, e]) => ({
      userId,
      name: nameByUserId.get(userId) ?? null,
      skus: e.skus,
      ritmoPerDay: periodDays > 0 ? e.skus / periodDays : 0,
      accuracy: e.accCount > 0 ? e.accSum / e.accCount : null,
      divergencias: e.divergencias,
    }))
    .sort((a, b) => b.skus - a.skus);
}

export type AlertSeverity = 'critical' | 'warning';

export interface OperationalAlert {
  id: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
}

/**
 * Alertas determinísticos — nada de geração via IA. `ritmoNecessario: null`
 * (sem data-alvo definida) desliga só o alerta de ritmo; os outros dois
 * dependem apenas de dados que sempre existem (acuracidade e pendências).
 */
export function buildOperationalAlerts(input: {
  ritmoAtual: number;
  ritmoNecessario: number | null;
  acuracidade: number;
  metaAcuracidade: number;
  divergenciasPendentes: number;
}): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];

  if (input.ritmoNecessario !== null && input.ritmoNecessario > 0 && input.ritmoAtual < input.ritmoNecessario) {
    const pctBelow = Math.round(((input.ritmoNecessario - input.ritmoAtual) / input.ritmoNecessario) * 100);
    alerts.push({
      id: 'ritmo_abaixo',
      title: `Ritmo ${pctBelow}% abaixo do necessário`,
      detail: `Produção média ${input.ritmoAtual.toFixed(1)} vs meta ${input.ritmoNecessario.toFixed(1)} SKUs/dia.`,
      severity: 'critical',
    });
  }

  if (input.acuracidade < input.metaAcuracidade) {
    alerts.push({
      id: 'acuracidade_critica',
      title: 'Acuracidade abaixo da meta',
      detail: `${input.acuracidade.toFixed(1)}% abaixo da meta de ${input.metaAcuracidade}%.`,
      severity: 'critical',
    });
  }

  if (input.divergenciasPendentes > 0) {
    alerts.push({
      id: 'divergencias_pendentes',
      title: `${input.divergenciasPendentes} divergências aguardando recontagem`,
      detail: 'Impactam diretamente a acuracidade.',
      severity: 'warning',
    });
  }

  return alerts;
}
