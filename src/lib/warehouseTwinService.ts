// Warehouse Digital Twin — camada de junção somente leitura. Não introduz tabelas novas:
// combina dados que já existem em slottingLayoutService/slottingRecommendationService/
// riskService/cbcService/abcXyzService/rcaService, indexados pelo endereço físico
// (warehouse_cells.location_code ↔ products.location, o mesmo campo-ponte já usado pelo
// resto do módulo de Slotting) para alimentar o mapa vivo e o painel de posição.

import { supabase } from './supabase';
import type { LocationLiveStatus, WarehouseCell, WarehouseSlottingRecommendation } from './supabase';
import { getPickCountsByLocation } from './slottingLayoutService';
import { getRecommendations } from './slottingRecommendationService';
import { getRiskForProducts } from './riskService';
import { getConfidenceForProducts } from './cbcService';
import { getClassificationsForProducts } from './abcXyzService';
import { getCauseCountsForProducts, listRecords } from './rcaService';

export interface CompanyProductLite {
  id: string;
  sku: string;
  name: string;
  location: string | null;
  stock_quantity: number | null;
}

export interface ProductLocationIndex {
  byLocation: Map<string, CompanyProductLite>;
  byProductId: Map<string, CompanyProductLite>;
}

/** Única consulta genuinamente nova desta feature — nenhum outro módulo expõe um índice
 *  endereço→produto pronto (cada um resolve só o join que precisa para si). */
export async function getCompanyProductLocationIndex(companyId: string): Promise<ProductLocationIndex> {
  const byLocation = new Map<string, CompanyProductLite>();
  const byProductId = new Map<string, CompanyProductLite>();

  // Paginado com .range() — um único .select() sem paginação é cortado
  // silenciosamente pelo limite padrão do PostgREST/Supabase (~1000 linhas),
  // deixando a cauda do catálogo de fora do mapa e/em empresas com muitos SKUs.
  const PAGE_SIZE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, location, stock_quantity')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('[WarehouseTwin] Error loading product location index:', error);
      break;
    }

    const batch = (data ?? []) as CompanyProductLite[];
    for (const row of batch) {
      byProductId.set(row.id, row);
      if (row.location) byLocation.set(row.location, row);
    }
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { byLocation, byProductId };
}

export interface PositionActivity {
  lastCountAt: string | null;
  lastDivergenceAt: string | null;
}

/** Última contagem (Import de Contagem OU Full) e última divergência (RCA) de um SKU —
 *  usado só no painel de detalhe da posição (clique individual), então buscado sob
 *  demanda em vez de em massa para o grid inteiro. */
export async function getPositionActivity(companyId: string, sku: string): Promise<PositionActivity> {
  const [{ data: importItems }, { data: fullItems }, rcaRecords] = await Promise.all([
    supabase
      .from('inventory_count_import_items')
      .select('created_at')
      .eq('company_id', companyId)
      .eq('sku', sku)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('full_operation_items')
      .select('picked_at')
      .eq('company_id', companyId)
      .eq('sku', sku)
      .eq('status', 'picked')
      .order('picked_at', { ascending: false })
      .limit(1),
    listRecords(companyId, { sku }),
  ]);

  const countDates = [importItems?.[0]?.created_at, fullItems?.[0]?.picked_at].filter(Boolean) as string[];
  const lastCountAt = countDates.length > 0 ? countDates.sort().reverse()[0] : null;
  const lastDivergenceAt = rcaRecords.length > 0 ? rcaRecords[0].occurred_at : null; // listRecords já ordena desc por occorred_at

  return { lastCountAt, lastDivergenceAt };
}

/** Orquestra todos os overlays do mapa vivo num único Map por endereço — cada campo só
 *  soma dados de um serviço já existente; nenhuma fórmula de score é recalculada aqui. */
export async function getLiveLayerData(
  companyId: string,
  layoutId: string,
  cells: WarehouseCell[]
): Promise<Map<string, LocationLiveStatus>> {
  const posicaoCells = cells.filter(c => c.cell_type === 'posicao' && c.location_code);
  const locationCodes = posicaoCells.map(c => c.location_code!);

  const [productIndex, pickCounts, recommendations] = await Promise.all([
    getCompanyProductLocationIndex(companyId),
    getPickCountsByLocation(companyId),
    getRecommendations(companyId, layoutId, 'pendente'),
  ]);

  const productIds = locationCodes
    .map(loc => productIndex.byLocation.get(loc)?.id)
    .filter((id): id is string => !!id);

  const [riskMap, confidenceMap, abcXyzMap, divergenceMap] = await Promise.all([
    getRiskForProducts(productIds, companyId),
    getConfidenceForProducts(productIds, companyId),
    getClassificationsForProducts(productIds, companyId),
    getCauseCountsForProducts(productIds, companyId),
  ]);

  const recommendationByLocation = new Map<string, WarehouseSlottingRecommendation>(
    recommendations.filter(r => r.current_location).map(r => [r.current_location as string, r])
  );

  const result = new Map<string, LocationLiveStatus>();
  for (const locationCode of locationCodes) {
    const product = productIndex.byLocation.get(locationCode) ?? null;
    const risk = product ? riskMap.get(product.id) : undefined;
    const confidence = product ? confidenceMap.get(product.id) : undefined;
    const abcXyz = product ? abcXyzMap.get(product.id) : undefined;

    result.set(locationCode, {
      locationCode,
      productId: product?.id ?? null,
      sku: product?.sku ?? null,
      productName: product?.name ?? null,
      stockQuantity: product?.stock_quantity ?? null,
      occupied: !!product,
      pickCount: pickCounts.get(locationCode) ?? 0,
      riskScore: risk?.risk_score ?? null,
      riskLevel: risk?.risk_level ?? null,
      riskReason: risk?.risk_reason ?? null,
      confidenceScore: confidence?.confidence_score ?? null,
      confidenceLevel: confidence?.risk_level ?? null,
      confidenceTopReasons: confidence?.top_reasons ?? [],
      abcClass: abcXyz?.abc_class ?? null,
      xyzClass: abcXyz?.xyz_class ?? null,
      valueMoved: abcXyz?.value_moved ?? null,
      divergenceCount: product ? divergenceMap.get(product.id) ?? 0 : 0,
      lastCountAt: null,
      lastDivergenceAt: null,
      recommendation: recommendationByLocation.get(locationCode) ?? null,
    });
  }
  return result;
}
