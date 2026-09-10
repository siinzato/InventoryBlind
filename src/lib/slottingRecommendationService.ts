// Slotting Intelligence — motor de regras (não é IA/LLM, mesmo espírito de
// academyRecommendationService.ts/rewardSuggestionService.ts) que gera as 4 categorias de
// recomendação pedidas a partir dos números REAIS do motor de grade (slottingEngine.ts),
// e o fluxo de decisão aprovar/rejeitar/adiar.

import { supabase, WarehouseSlottingRecommendation, SlottingRecommendationStatus } from './supabase';
import {
  findExpeditionCell, findShortestPath, computeSkuDistances, computeCorridorTraffic,
  estimatePickingTimeSeconds, findEmptyWalkablePositions, SkuDistanceResult,
} from './slottingEngine';
import { getCells, getPickCountsByLocation, getCoOccurringSkuPairs } from './slottingLayoutService';
import { logAuditEvent } from './auditLogService';

interface DraftRecommendation {
  recommendation_type: 'mover_mais_perto' | 'aproximar_expedicao' | 'agrupar_frequentes' | 'redistribuir_fluxo';
  current_location: string | null;
  suggested_location: string | null;
  estimated_meters_saved: number;
  estimated_time_saved_seconds: number;
  estimated_productivity_gain_pct: number;
  reason: string;
}

async function buildMoveCloserRecommendations(
  skuDistances: SkuDistanceResult[],
  cells: Awaited<ReturnType<typeof getCells>>,
  expedition: { x: number; y: number },
  cellSizeMeters: number
): Promise<DraftRecommendation[]> {
  if (skuDistances.length === 0) return [];

  const emptyPositions = findEmptyWalkablePositions(cells);
  const emptyDistances = emptyPositions
    .map(pos => {
      const result = findShortestPath(cells, { x: pos.x, y: pos.y }, expedition);
      return { cell: pos, distanceMeters: result ? result.lengthCells * cellSizeMeters : Infinity };
    })
    .filter(e => e.distanceMeters !== Infinity)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const avgDistance = skuDistances.reduce((s, d) => s + d.distanceMeters, 0) / skuDistances.length;
  const sortedByPicks = [...skuDistances].sort((a, b) => b.pickCount - a.pickCount);
  const topQuartileCount = Math.max(1, Math.ceil(sortedByPicks.length * 0.25));
  const topQuartileLocations = new Set(sortedByPicks.slice(0, topQuartileCount).map(s => s.locationCode));

  const drafts: DraftRecommendation[] = [];
  for (const sku of skuDistances) {
    if (sku.distanceMeters <= avgDistance) continue;
    const closerIdx = emptyDistances.findIndex(e => e.distanceMeters < sku.distanceMeters);
    if (closerIdx === -1) continue;
    const closer = emptyDistances[closerIdx];
    emptyDistances.splice(closerIdx, 1);

    const metersSaved = (sku.distanceMeters - closer.distanceMeters) * sku.pickCount * 2;
    const isTopQuartile = topQuartileLocations.has(sku.locationCode);

    drafts.push({
      recommendation_type: isTopQuartile ? 'aproximar_expedicao' : 'mover_mais_perto',
      current_location: sku.locationCode,
      suggested_location: `(${closer.cell.x},${closer.cell.y})`,
      estimated_meters_saved: metersSaved,
      estimated_time_saved_seconds: estimatePickingTimeSeconds(sku.distanceMeters - closer.distanceMeters, sku.pickCount),
      estimated_productivity_gain_pct: avgDistance > 0 ? Math.min(50, Math.round((metersSaved / (avgDistance * sku.pickCount * 2)) * 100)) : 0,
      reason: isTopQuartile
        ? `SKU de alto giro (${sku.pickCount} picks no período) a ${Math.round(sku.distanceMeters)}m da expedição — aproximar economizaria ${Math.round(sku.distanceMeters - closer.distanceMeters)}m por viagem.`
        : `Posição atual a ${Math.round(sku.distanceMeters)}m da expedição; existe posição livre ${Math.round(closer.distanceMeters)}m mais próxima.`,
    });
  }
  return drafts;
}

async function buildGroupFrequentRecommendations(
  companyId: string,
  cells: Awaited<ReturnType<typeof getCells>>,
  avgDistance: number,
  cellSizeMeters: number
): Promise<DraftRecommendation[]> {
  const coOccurrence = await getCoOccurringSkuPairs(companyId);
  const cellByLocation = new Map(cells.filter(c => c.location_code).map(c => [c.location_code!, c]));
  const drafts: DraftRecommendation[] = [];

  for (const [pairKey, count] of coOccurrence) {
    if (count < 3) continue;
    const [locA, locB] = pairKey.split('|');
    const cellA = cellByLocation.get(locA);
    const cellB = cellByLocation.get(locB);
    if (!cellA || !cellB) continue;

    const path = findShortestPath(cells, { x: cellA.x, y: cellA.y }, { x: cellB.x, y: cellB.y });
    if (!path) continue;
    const distanceMeters = path.lengthCells * cellSizeMeters;
    if (distanceMeters <= avgDistance) continue;

    drafts.push({
      recommendation_type: 'agrupar_frequentes',
      current_location: locA,
      suggested_location: `perto de ${locB}`,
      estimated_meters_saved: distanceMeters * count,
      estimated_time_saved_seconds: estimatePickingTimeSeconds(distanceMeters, count),
      estimated_productivity_gain_pct: 0,
      reason: `SKUs ${locA} e ${locB} aparecem juntos em ${count} operação(ões) mas estão a ${Math.round(distanceMeters)}m de distância um do outro.`,
    });
  }
  return drafts.slice(0, 10);
}

function buildRedistributeFlowRecommendations(skuDistances: SkuDistanceResult[]): DraftRecommendation[] {
  const traffic = computeCorridorTraffic(skuDistances);
  const values = Array.from(traffic.values());
  if (values.length === 0) return [];
  const avgTraffic = values.reduce((a, b) => a + b, 0) / values.length;

  const congested = Array.from(traffic.entries())
    .filter(([, v]) => v > avgTraffic * 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const drafts: DraftRecommendation[] = [];
  for (const [key, trafficCount] of congested) {
    const [xStr, yStr] = key.split(',');
    const contributor = skuDistances.find(s => s.path.some(p => p.x === Number(xStr) && p.y === Number(yStr)));
    if (!contributor) continue;

    drafts.push({
      recommendation_type: 'redistribuir_fluxo',
      current_location: contributor.locationCode,
      suggested_location: null,
      estimated_meters_saved: 0,
      estimated_time_saved_seconds: 0,
      estimated_productivity_gain_pct: Math.min(30, Math.round(((trafficCount - avgTraffic) / trafficCount) * 100)),
      reason: `Corredor (${xStr},${yStr}) com tráfego ${trafficCount}x acima da média (${avgTraffic.toFixed(1)}) — redistribuir SKUs deste corredor reduziria o congestionamento.`,
    });
  }
  return drafts;
}

/** Gera a fila de recomendações — limpa as pendentes anteriores deste layout e insere as
 *  novas (evita acumular sugestões obsoletas a cada clique em "Gerar Recomendações"). */
export async function generateRecommendations(companyId: string, layoutId: string, userId: string, userEmail: string): Promise<number> {
  const cells = await getCells(layoutId, companyId);
  const expeditionCell = findExpeditionCell(cells);
  if (!expeditionCell) return 0;

  const { data: layout } = await supabase.from('warehouse_layouts').select('cell_size_meters').eq('id', layoutId).maybeSingle();
  const cellSizeMeters = layout?.cell_size_meters ?? 1.5;

  const pickCounts = await getPickCountsByLocation(companyId);
  const skuDistances = computeSkuDistances(cells, { x: expeditionCell.x, y: expeditionCell.y }, pickCounts, cellSizeMeters);
  const avgDistance = skuDistances.length > 0 ? skuDistances.reduce((s, d) => s + d.distanceMeters, 0) / skuDistances.length : 0;

  const drafts: DraftRecommendation[] = [
    ...(await buildMoveCloserRecommendations(skuDistances, cells, { x: expeditionCell.x, y: expeditionCell.y }, cellSizeMeters)),
    ...(await buildGroupFrequentRecommendations(companyId, cells, avgDistance, cellSizeMeters)),
    ...buildRedistributeFlowRecommendations(skuDistances),
  ];

  await supabase.from('warehouse_slotting_recommendations').delete().eq('layout_id', layoutId).eq('status', 'pendente');
  if (drafts.length === 0) return 0;

  const { data: products } = await supabase.from('products').select('id, location').eq('company_id', companyId);
  const productIdByLocation = new Map((products ?? []).filter(p => p.location).map(p => [p.location as string, p.id as string]));

  const rows = drafts.map(d => ({
    company_id: companyId,
    layout_id: layoutId,
    product_id: d.current_location ? productIdByLocation.get(d.current_location) ?? null : null,
    recommendation_type: d.recommendation_type,
    current_location: d.current_location,
    suggested_location: d.suggested_location,
    estimated_meters_saved: d.estimated_meters_saved,
    estimated_time_saved_seconds: d.estimated_time_saved_seconds,
    estimated_productivity_gain_pct: d.estimated_productivity_gain_pct,
    reason: d.reason,
  }));

  const { error } = await supabase.from('warehouse_slotting_recommendations').insert(rows);
  if (error) { console.error('[Slotting] Error inserting recommendations:', error); return 0; }

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'recommendations_generated', count: rows.length } });
  return rows.length;
}

export async function getRecommendations(companyId: string, layoutId: string, status?: SlottingRecommendationStatus): Promise<WarehouseSlottingRecommendation[]> {
  let query = supabase.from('warehouse_slotting_recommendations').select('*').eq('company_id', companyId).eq('layout_id', layoutId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('estimated_meters_saved', { ascending: false });
  if (error) { console.error('[Slotting] Error loading recommendations:', error); return []; }
  return data as WarehouseSlottingRecommendation[];
}

export async function decideRecommendation(
  id: string,
  status: 'aprovada' | 'rejeitada' | 'adiada',
  companyId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { data: rec, error: fetchError } = await supabase
    .from('warehouse_slotting_recommendations').select('*').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (fetchError || !rec) { if (fetchError) console.error('[Slotting] Error loading recommendation:', fetchError); return; }

  const { error: updateError } = await supabase
    .from('warehouse_slotting_recommendations')
    .update({ status, decided_at: new Date().toISOString(), decided_by: userId })
    .eq('id', id);
  if (updateError) { console.error('[Slotting] Error updating recommendation:', updateError); return; }

  if (status === 'aprovada') {
    const { error: historyError } = await supabase.from('warehouse_optimization_history').insert({
      company_id: companyId,
      layout_id: rec.layout_id,
      recommendation_id: id,
      event: `${rec.recommendation_type} aprovada — ${rec.reason}`,
      meters_saved: rec.estimated_meters_saved,
    });
    if (historyError) console.error('[Slotting] Error inserting optimization history:', historyError);
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'slotting.recommendation_decided',
    resourceType: 'warehouse_slotting_recommendation', resourceId: id, metadata: { status },
  });
}

export async function getOptimizationHistory(companyId: string, layoutId: string) {
  const { data, error } = await supabase
    .from('warehouse_optimization_history').select('*').eq('company_id', companyId).eq('layout_id', layoutId).order('recorded_at', { ascending: false }).limit(50);
  if (error) { console.error('[Slotting] Error loading optimization history:', error); return []; }
  return data;
}
