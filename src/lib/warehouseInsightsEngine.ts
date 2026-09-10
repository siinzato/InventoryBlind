// Warehouse Digital Twin — motor de insights automáticos. Função pura (mesmo espírito de
// slottingEngine.ts/rcaAlgorithm.ts): recebe dados já carregados/calculados pelo chamador
// e produz uma lista ranqueada de cards estruturados "qual problema existe e qual ação
// tomar" — sem I/O, sem recalcular nenhum score (risco/confidence/ABC-XYZ já vêm prontos
// de warehouseTwinService.ts).

import type { WarehouseCell, LocationLiveStatus, WarehouseInsight } from './supabase';

/** Extrai o "corredor" de um endereço pelo primeiro segmento antes do hífen (ex.:
 *  "A-01-03" → corredor "A") — a mesma convenção de endereçamento usada nos exemplos do
 *  próprio módulo; endereços sem hífen viram corredor de si mesmos. */
function corridorOf(locationCode: string): string {
  const [first] = locationCode.split('-');
  return first || locationCode;
}

function sumBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0);
}

/** Endereço exato dentro de um corredor que melhor representa o problema do card — a
 *  câmera do mapa foca nesta posição, não no corredor inteiro (que não é um único ponto
 *  clicável). */
function topLocationInCorridor(
  statuses: LocationLiveStatus[],
  corridor: string,
  rank: (s: LocationLiveStatus) => number
): string | null {
  const inCorridor = statuses.filter(s => corridorOf(s.locationCode) === corridor);
  if (inCorridor.length === 0) return null;
  return inCorridor.slice().sort((a, b) => rank(b) - rank(a))[0].locationCode;
}

/** Ranqueia até 4 cards de inteligência operacional — um por categoria pedida
 *  (divergência crítica, ineficiência operacional, problema de slotting, risco
 *  operacional). Cada card carrega título/impacto/localização/recomendação separados
 *  para a UI renderizar sem parsear texto. */
export function computeInsights(
  cells: WarehouseCell[],
  liveData: Map<string, LocationLiveStatus>,
  traffic: Map<string, number>
): WarehouseInsight[] {
  const insights: WarehouseInsight[] = [];
  const statuses = Array.from(liveData.values());
  if (statuses.length === 0) return insights;

  // 🔥 Divergência crítica — corredor que concentra a maior fatia das divergências (RCA).
  const totalDivergences = sumBy(statuses, s => s.divergenceCount);
  if (totalDivergences > 0) {
    const byCorridor = new Map<string, number>();
    for (const s of statuses) {
      const corridor = corridorOf(s.locationCode);
      byCorridor.set(corridor, (byCorridor.get(corridor) ?? 0) + s.divergenceCount);
    }
    const [topCorridor, count] = Array.from(byCorridor.entries()).sort((a, b) => b[1] - a[1])[0];
    const pct = Math.round((count / totalDivergences) * 100);
    if (pct >= 20) {
      insights.push({
        id: 'top-divergence-corridor',
        icon: '🔥',
        severity: pct >= 40 ? 'critical' : 'warning',
        category: 'divergencia',
        title: 'Divergência crítica',
        impact: `Concentra ${pct}% de todas as divergências registradas`,
        location: `Rua ${topCorridor}`,
        recommendation: `Priorizar recontagem e auditoria na Rua ${topCorridor} antes das demais ruas.`,
        focusLocationCode: topLocationInCorridor(statuses, topCorridor, s => s.divergenceCount),
      });
    }
  }

  // 🚶 Ineficiência operacional — corredor que mais contribui para a caminhada estimada.
  const totalTraffic = Array.from(traffic.values()).reduce((a, b) => a + b, 0);
  if (totalTraffic > 0) {
    const cellByKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
    const trafficByCorridor = new Map<string, number>();
    for (const [key, count] of traffic) {
      const locationCode = cellByKey.get(key)?.location_code;
      if (!locationCode) continue;
      const corridor = corridorOf(locationCode);
      trafficByCorridor.set(corridor, (trafficByCorridor.get(corridor) ?? 0) + count);
    }
    const ranked = Array.from(trafficByCorridor.entries()).sort((a, b) => b[1] - a[1]);
    if (ranked.length > 0) {
      const [topCorridor, count] = ranked[0];
      const pct = Math.round((count / totalTraffic) * 100);
      if (pct >= 20) {
        insights.push({
          id: 'top-traffic-corridor',
          icon: '🚶',
          severity: pct >= 40 ? 'warning' : 'info',
          category: 'ineficiencia',
          title: 'Ineficiência operacional',
          impact: `Representa ${pct}% da distância percorrida estimada no período`,
          location: `Rua ${topCorridor}`,
          recommendation: `Avaliar reslotting dos SKUs de maior giro desta rua para reduzir caminhada.`,
          focusLocationCode: topLocationInCorridor(statuses, topCorridor, s => s.pickCount),
        });
      }
    }
  }

  // 📦 Problema de slotting — sugestão pendente mais relevante (reaproveita o motor de
  // recomendações já existente, não recalcula nada aqui).
  const withRecommendation = statuses.find(s => s.recommendation && s.productName);
  if (withRecommendation?.recommendation) {
    const rec = withRecommendation.recommendation;
    const gains = [
      rec.estimated_meters_saved > 0 ? `~${Math.round(rec.estimated_meters_saved)}m economizados` : null,
      rec.estimated_productivity_gain_pct > 0 ? `+${rec.estimated_productivity_gain_pct}% produtividade` : null,
    ].filter((g): g is string => !!g).join(', ');

    insights.push({
      id: 'pending-recommendation',
      icon: '📦',
      severity: 'info',
      category: 'slotting',
      title: 'Problema de slotting',
      impact: `${withRecommendation.productName} está posicionado longe do ideal`,
      location: withRecommendation.locationCode,
      recommendation: rec.suggested_location
        ? `Mover para ${rec.suggested_location}${gains ? ` — ${gains}` : ''}.`
        : rec.reason,
      focusLocationCode: withRecommendation.locationCode,
    });
  }

  // ⚠️ Risco operacional — pega o pior entre dois sinais já calculados: concentração de
  // posições em faixa de risco alto/crítico (Risk Engine) e ocupação acima do limite.
  const occupancyByCorridor = new Map<string, { occupied: number; total: number }>();
  const riskByCorridor = new Map<string, { highRisk: number; total: number }>();
  for (const s of statuses) {
    const corridor = corridorOf(s.locationCode);
    const occ = occupancyByCorridor.get(corridor) ?? { occupied: 0, total: 0 };
    occ.total += 1;
    if (s.occupied) occ.occupied += 1;
    occupancyByCorridor.set(corridor, occ);

    if (s.occupied) {
      const rb = riskByCorridor.get(corridor) ?? { highRisk: 0, total: 0 };
      rb.total += 1;
      if (s.riskLevel === 'alto' || s.riskLevel === 'critico') rb.highRisk += 1;
      riskByCorridor.set(corridor, rb);
    }
  }

  const crowded = Array.from(occupancyByCorridor.entries())
    .map(([corridor, b]) => ({ corridor, pct: b.total > 0 ? (b.occupied / b.total) * 100 : 0 }))
    .filter(c => c.pct >= 90)
    .sort((a, b) => b.pct - a.pct)[0];

  const risky = Array.from(riskByCorridor.entries())
    .map(([corridor, b]) => ({ corridor, pct: b.total > 0 ? (b.highRisk / b.total) * 100 : 0, total: b.total }))
    .filter(c => c.total >= 2 && c.pct >= 40)
    .sort((a, b) => b.pct - a.pct)[0];

  if (risky && (!crowded || risky.pct >= crowded.pct)) {
    insights.push({
      id: 'high-risk-corridor',
      icon: '⚠️',
      severity: risky.pct >= 70 ? 'critical' : 'warning',
      category: 'risco',
      title: 'Risco operacional',
      impact: `${Math.round(risky.pct)}% das posições ocupadas em faixa de risco alto ou crítico`,
      location: `Rua ${risky.corridor}`,
      recommendation: `Priorizar contagem de confirmação nesta rua e revisar a criticidade dos SKUs afetados.`,
      focusLocationCode: topLocationInCorridor(statuses, risky.corridor, s => s.riskScore ?? 0),
    });
  } else if (crowded) {
    insights.push({
      id: 'high-occupancy-corridor',
      icon: '⚠️',
      severity: crowded.pct >= 97 ? 'critical' : 'warning',
      category: 'risco',
      title: 'Risco operacional',
      impact: `Ocupação de ${Math.round(crowded.pct)}%, acima do limite recomendado`,
      location: `Rua ${crowded.corridor}`,
      recommendation: `Redistribuir SKUs desta rua para corredores com menor ocupação.`,
      focusLocationCode: topLocationInCorridor(statuses, crowded.corridor, s => (s.occupied ? 1 : 0)),
    });
  }

  return insights;
}
