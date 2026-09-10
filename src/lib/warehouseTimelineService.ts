// Warehouse Digital Twin — timeline histórica.
//
// Antes esta função ignorava a data: chamava getLiveLayerData e devolvia o estado de
// HOJE com isMock: true, qualquer que fosse a marca escolhida no scrubber. O seletor de
// data existia e não fazia nada.
//
// Agora reconstrói de verdade, a partir do histórico que já era gravado e não estava
// sendo lido:
//   • picks  → full_operation_items.picked_at, janela de 90 dias TERMINANDO na data;
//   • risco  → product_risk_history, a linha mais recente com recorded_at <= data;
//   • confiança → product_confidence_history, mesma regra.
//
// ── Limitação declarada, não escondida ──────────────────────────────────────
// O vínculo endereço→produto (products.location) NÃO tem histórico: não há como saber
// qual SKU ocupava um endereço há 20 dias. A reconstrução usa a ocupação ATUAL como
// mapa e coloca sobre ela a atividade e os scores daquela data. Por isso `isMock`
// continua existindo e é ligado quando a data escolhida é anterior ao histórico
// disponível — aí não há o que reconstruir e o painel avisa. Para hoje, e para
// qualquer data coberta pelo histórico, o que aparece é dado real da data.

import { supabase } from './supabase';
import type {
  AbcClass,
  LocationLiveStatus,
  RiskBand,
  RiskLevel,
  WarehouseCell,
  WarehouseSnapshot,
  XyzClass,
} from './supabase';
import { getCompanyProductLocationIndex, getLiveLayerData } from './warehouseTwinService';
import { getClassificationsForProducts } from './abcXyzService';
import { getRecommendations } from './slottingRecommendationService';

export function listSnapshotDates(days = 30): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

/** Janela de picks usada na reconstrução — a mesma de 90 dias que o motor de distância
 *  usa para o estado atual, só que ancorada na data escolhida em vez de em hoje. */
const PICK_WINDOW_DAYS = 90;

function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function windowStartIso(date: string): string {
  return new Date(new Date(`${date}T23:59:59.999Z`).getTime() - PICK_WINDOW_DAYS * 86400000).toISOString();
}

/** Picks por endereço numa janela que termina na data escolhida.
 *
 *  Consulta própria em vez de parametrizar getPickCountsByLocation: aquela função é a
 *  entrada do motor de distância do Slotting, e mudar a assinatura dela para atender a
 *  timeline mexeria num caminho que já funciona. */
async function getPickCountsAsOf(companyId: string, date: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('location')
    .eq('company_id', companyId)
    .eq('status', 'picked')
    .gte('picked_at', windowStartIso(date))
    .lte('picked_at', endOfDayIso(date));

  if (error) {
    console.error('[Twin/timeline] falha ao carregar picks da data:', error.message);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const location = (row as { location: string | null }).location;
    if (!location) continue;
    counts.set(location, (counts.get(location) ?? 0) + 1);
  }
  return counts;
}

interface HistoricalScore {
  score: number;
  level: string;
}

/** Último valor gravado por produto até a data, a partir de uma tabela `*_history`.
 *
 *  Uma leitura só, ordenada desc, e o primeiro que aparece por produto é o vigente
 *  naquela data — o mesmo padrão de "mais recente por chave" usado no heatmapService. */
async function getHistoricalScores(
  table: 'product_risk_history' | 'product_confidence_history',
  scoreColumn: 'risk_score' | 'confidence_score',
  companyId: string,
  date: string
): Promise<Map<string, HistoricalScore>> {
  const { data, error } = await supabase
    .from(table)
    .select(`product_id, ${scoreColumn}, risk_level, recorded_at`)
    .eq('company_id', companyId)
    .lte('recorded_at', endOfDayIso(date))
    .order('recorded_at', { ascending: false });

  const result = new Map<string, HistoricalScore>();
  if (error) {
    console.error(`[Twin/timeline] falha ao carregar ${table}:`, error.message);
    return result;
  }

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const productId = row.product_id as string;
    if (result.has(productId)) continue;
    result.set(productId, {
      score: Number(row[scoreColumn] ?? 0),
      level: String(row.risk_level ?? ''),
    });
  }
  return result;
}

export async function getSnapshotForDate(
  companyId: string,
  layoutId: string,
  cells: WarehouseCell[],
  date: string
): Promise<WarehouseSnapshot> {
  const isToday = date === new Date().toISOString().slice(0, 10);

  // Hoje é exatamente o estado vivo — reconstruir seria refazer, com menos dados
  // (o estado vivo traz também divergências por causa e motivo do risco).
  if (isToday) {
    const liveData = await getLiveLayerData(companyId, layoutId, cells);
    return { date, layoutId, cells, liveData, isMock: false };
  }

  const posicaoCells = cells.filter(c => c.cell_type === 'posicao' && c.location_code);
  const locationCodes = posicaoCells.map(c => c.location_code!);

  const [productIndex, pickCounts, riskHistory, confidenceHistory, recommendations] = await Promise.all([
    getCompanyProductLocationIndex(companyId),
    getPickCountsAsOf(companyId, date),
    getHistoricalScores('product_risk_history', 'risk_score', companyId, date),
    getHistoricalScores('product_confidence_history', 'confidence_score', companyId, date),
    getRecommendations(companyId, layoutId, 'pendente'),
  ]);

  const productIds = locationCodes
    .map(loc => productIndex.byLocation.get(loc)?.id)
    .filter((id): id is string => !!id);

  // ABC/XYZ é classificação de período, não de dia — a classe vigente é a que vale para
  // ler o mapa. product_abc_xyz_history existe, mas guarda a transição de classe, não um
  // valor por dia, então usar a atual é mais honesto do que interpolar.
  const abcXyzMap = await getClassificationsForProducts(productIds, companyId);

  const recommendationByLocation = new Map(
    recommendations.filter(r => r.current_location).map(r => [r.current_location as string, r])
  );

  // Sem nenhuma linha de histórico até a data, não há reconstrução possível: o painel
  // precisa dizer isso em vez de desenhar o mapa de hoje com uma data antiga em cima.
  const hasHistory = riskHistory.size > 0 || confidenceHistory.size > 0 || pickCounts.size > 0;

  const liveData = new Map<string, LocationLiveStatus>();
  for (const locationCode of locationCodes) {
    const product = productIndex.byLocation.get(locationCode) ?? null;
    const risk = product ? riskHistory.get(product.id) : undefined;
    const confidence = product ? confidenceHistory.get(product.id) : undefined;
    const abcXyz = product ? abcXyzMap.get(product.id) : undefined;

    liveData.set(locationCode, {
      locationCode,
      productId: product?.id ?? null,
      sku: product?.sku ?? null,
      productName: product?.name ?? null,
      stockQuantity: product?.stock_quantity ?? null,
      occupied: !!product,
      pickCount: pickCounts.get(locationCode) ?? 0,
      riskScore: risk?.score ?? null,
      riskLevel: (risk?.level as RiskBand) ?? null,
      // O motivo do risco não é historiado — só o score e a faixa.
      riskReason: null,
      confidenceScore: confidence?.score ?? null,
      confidenceLevel: (confidence?.level as RiskLevel) ?? null,
      confidenceTopReasons: [],
      abcClass: (abcXyz?.abc_class as AbcClass) ?? null,
      xyzClass: (abcXyz?.xyz_class as XyzClass) ?? null,
      valueMoved: abcXyz?.value_moved ?? null,
      divergenceCount: 0,
      lastCountAt: null,
      lastDivergenceAt: null,
      recommendation: recommendationByLocation.get(locationCode) ?? null,
    });
  }

  return { date, layoutId, cells, liveData, isMock: !hasHistory };
}
