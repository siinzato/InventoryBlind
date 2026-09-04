// Analytics — uma única leva de queries (Promise.all), reaproveitada por BlindScore,
// Inventory Health e Auditorias, para não disparar a mesma consulta 3 vezes (RLS já
// escopa tudo por company_id, como em qualquer outro dashboard do app).
import { supabase } from '../supabase';
import { listCountRecords } from '../auditCrossCheckService';
import { buildCountChains, computeCrossCheckSummary } from '../auditCrossCheckAlgorithm';
import type { CrossCheckSummary, CountChain } from '../auditCrossCheckAlgorithm';
import { listRecords as listRcaRecords, getSettings as getRcaSettings } from '../rcaService';
import { getMatrixCounts } from '../abcXyzService';
import { getCompanySummary, getLastRecalculatedAt, type CBCCompanySummaryRow } from '../cbcService';
import { getCompanyRiskSummary, type RiskCompanySummaryRow } from '../riskService';
import { listBrands, listLines } from '../productBrands/productBrandService';
import type { PillarFactorRow } from './analyticsMath';
import type { InventoryCountRecord, RcaSettings, AbcXyzPeriod, AbcXyzUnclassifiedReason, RiskBand } from '../supabase';
import type { RcaRecord, AbcXyzCombo } from '../domainTypes';

/** Janela de leitura do RCA — larga o bastante para dar duas metades de período com volume
 *  (mesmo racional de rcaService.getTrendForDimensionValue), sem trazer o histórico inteiro. */
const RCA_WINDOW_DAYS = 180;

/** Teto de linhas lidas de product_confidence_scores.factors para agregar os pilares do
 *  BlindScore (§10/§19) — só a coluna `factors`, nunca o payload inteiro, e limitado à mesma
 *  ordem de grandeza que cbcService.getBandMigrations já usa (2000) para não virar um select
 *  sem limite num catálogo grande. */
const PILLAR_SAMPLE_LIMIT = 5000;

export interface AnalyticsRawData {
  countRecords: InventoryCountRecord[];
  crossCheckSummary: CrossCheckSummary;
  crossCheckChainCount: number;
  /** Cadeias individuais já computadas por buildCountChains — reaproveitadas para o drill-down
   *  de "contagens aguardando validação" do BlindScore, sem recalcular nada. */
  crossCheckChains: CountChain[];
  rcaRecords: RcaRecord[];
  rcaSettings: RcaSettings;
  abcXyzMatrix: Record<AbcXyzCombo, { count: number; value: number }>;
  /** Agregado real do CBC (cbc_company_summary_v) — fonte principal do BlindScore. null quando
   *  nenhum produto ainda tem linha em product_confidence_scores. */
  cbcSummary: CBCCompanySummaryRow | null;
  cbcLastRecalculatedAt: string | null;
  /** Agregado real do Inventário por Risco (risk_company_summary_v) — lido, nunca
   *  recalculado aqui. null quando nenhum produto tem risco calculado ainda. */
  riskSummary: RiskCompanySummaryRow | null;
  /** Total real de products do workspace — nunca inferido a partir de product_confidence_scores. */
  catalogTotal: number;
  /** `factors` de cada produto com has_sufficient_data = true, para os pilares do BlindScore. */
  pillarFactorRows: PillarFactorRow[];
  /** Contagens vencidas ENTRE os produtos que têm evidência suficiente. cbc_company_summary_v.
   *  overdue_count inclui os produtos sem evidência (que recebem next_count_date = hoje ao serem
   *  criados e vencem no dia seguinte), então os dois números descrevem o mesmo conjunto quando
   *  ninguém com evidência está atrasado — este recorte separa o que é de fato acionável. */
  overdueWithSufficientData: number;
}

export async function getAnalyticsRawData(companyId: string): Promise<AnalyticsRawData> {
  const since = new Date(Date.now() - RCA_WINDOW_DAYS * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [
    countRecords, rcaRecords, rcaSettings, abcXyzMatrix,
    cbcSummary, cbcLastRecalculatedAt, riskSummary, catalogCountResult, factorRowsResult, overdueWithDataResult,
  ] = await Promise.all([
    listCountRecords(companyId),
    listRcaRecords(companyId, { from: since }),
    getRcaSettings(companyId),
    getMatrixCounts(companyId),
    getCompanySummary(companyId),
    getLastRecalculatedAt(companyId),
    getCompanyRiskSummary(companyId),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase
      .from('product_confidence_scores')
      .select('factors')
      .eq('company_id', companyId)
      .eq('has_sufficient_data', true)
      .limit(PILLAR_SAMPLE_LIMIT),
    supabase
      .from('product_confidence_scores')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('has_sufficient_data', true)
      .lt('next_count_date', today),
  ]);

  const chains = buildCountChains(countRecords);
  const crossCheckSummary = computeCrossCheckSummary(chains);

  return {
    countRecords,
    crossCheckSummary,
    crossCheckChainCount: chains.length,
    crossCheckChains: chains,
    rcaRecords,
    rcaSettings,
    abcXyzMatrix,
    cbcSummary,
    cbcLastRecalculatedAt,
    riskSummary,
    catalogTotal: catalogCountResult.count ?? 0,
    pillarFactorRows: (factorRowsResult.data ?? []).map(r => (r as { factors: PillarFactorRow }).factors),
    overdueWithSufficientData: overdueWithDataResult.count ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Inventory Health — Fase 2. Movimento/disponibilidade, risco por produto e associação de
// marca/linha ficam em uma leva SEPARADA, chamada só pela página de Inventory Health: BlindScore
// e Auditorias compartilham getAnalyticsRawData e não devem pagar por leituras que não usam.
//
// Nenhuma consulta por produto (o custo é O(1) em queries, não O(n)): a movimentação já vem
// agregada por produto pelo próprio ABC/XYZ (product_abc_xyz_classifications), que é a fonte de
// movimento deste app — nada de recalcular vendas nem varrer sales_records inteiro.

/** Teto de linhas por leitura em massa — mesma ordem de grandeza de PILLAR_SAMPLE_LIMIT. Quando
 *  o catálogo passa disso, a cobertura reportada mostra a diferença em vez de fingir total. */
const MOVEMENT_SAMPLE_LIMIT = 5000;

/** Movimentação já calculada por produto pelo ABC/XYZ — lida, nunca recalculada. */
export interface MovementProductRow {
  productId: string;
  quantityMoved: number;
  weeksWithData: number;
  weeksWithoutSale: number;
  unclassifiedReason: AbcXyzUnclassifiedReason | null;
  period: AbcXyzPeriod;
  classificationDate: string;
}

export interface CatalogProductRow {
  id: string;
  sku: string;
  name: string;
  location: string | null;
  stockQuantity: number;
  price: number | null;
}

export interface BrandAssociationRow {
  productId: string;
  brandId: string | null;
  lineId: string | null;
}

export interface InventoryHealthExtraData {
  /** Existe ALGUM registro de venda para a empresa. Separa "fonte inexistente"
   *  (indisponível) de "fonte existe mas sem base suficiente" (não avaliado). */
  movementSourceExists: boolean;
  movementRows: MovementProductRow[];
  movementRowsTotal: number;
  catalogProducts: CatalogProductRow[];
  catalogProductsTotal: number;
  /** Só produtos em risco crítico/alto, já persistidos pelo módulo de Risco — nunca recalculado
   *  e nunca buscado produto a produto. */
  riskLevelByProduct: [string, RiskBand][];
  brandAssociations: BrandAssociationRow[];
  brands: { id: string; name: string }[];
  lines: { id: string; name: string; brandId: string }[];
}

export async function getInventoryHealthExtraData(companyId: string): Promise<InventoryHealthExtraData> {
  const [
    salesProbe, movementResult, movementCount, productsResult, productsCount,
    riskRowsResult, associationsResult, brands, lines,
  ] = await Promise.all([
    supabase.from('sales_records').select('id').eq('company_id', companyId).limit(1),
    supabase
      .from('product_abc_xyz_classifications')
      .select('product_id, quantity_moved, weeks_with_data, weeks_without_sale, unclassified_reason, period, classification_date')
      .eq('company_id', companyId)
      .limit(MOVEMENT_SAMPLE_LIMIT),
    supabase.from('product_abc_xyz_classifications').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase
      .from('products')
      .select('id, sku, name, location, stock_quantity, price')
      .eq('company_id', companyId)
      .limit(MOVEMENT_SAMPLE_LIMIT),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase
      .from('product_risk_scores')
      .select('product_id, risk_level')
      .eq('company_id', companyId)
      .in('risk_level', ['critico', 'alto'])
      .limit(MOVEMENT_SAMPLE_LIMIT),
    supabase
      .from('product_brand_associations')
      .select('product_id, brand_id, line_id')
      .eq('company_id', companyId)
      .limit(MOVEMENT_SAMPLE_LIMIT),
    listBrands(companyId),
    listLines(companyId),
  ]);

  type MovementRowRaw = {
    product_id: string; quantity_moved: number | null; weeks_with_data: number | null;
    weeks_without_sale: number | null; unclassified_reason: AbcXyzUnclassifiedReason | null;
    period: AbcXyzPeriod; classification_date: string;
  };
  type ProductRowRaw = {
    id: string; sku: string | null; name: string | null; location: string | null;
    stock_quantity: number | null; price: number | null;
  };

  return {
    movementSourceExists: (salesProbe.data?.length ?? 0) > 0,
    movementRows: ((movementResult.data ?? []) as MovementRowRaw[]).map(r => ({
      productId: r.product_id,
      quantityMoved: r.quantity_moved ?? 0,
      weeksWithData: r.weeks_with_data ?? 0,
      weeksWithoutSale: r.weeks_without_sale ?? 0,
      unclassifiedReason: r.unclassified_reason,
      period: r.period,
      classificationDate: r.classification_date,
    })),
    movementRowsTotal: movementCount.count ?? 0,
    catalogProducts: ((productsResult.data ?? []) as ProductRowRaw[]).map(r => ({
      id: r.id,
      sku: r.sku ?? '—',
      name: r.name ?? '—',
      location: r.location,
      stockQuantity: r.stock_quantity ?? 0,
      price: r.price,
    })),
    catalogProductsTotal: productsCount.count ?? 0,
    riskLevelByProduct: ((riskRowsResult.data ?? []) as { product_id: string; risk_level: RiskBand }[])
      .map(r => [r.product_id, r.risk_level] as [string, RiskBand]),
    brandAssociations: ((associationsResult.data ?? []) as { product_id: string; brand_id: string | null; line_id: string | null }[])
      .map(r => ({ productId: r.product_id, brandId: r.brand_id, lineId: r.line_id })),
    brands: brands.filter(b => b.active).map(b => ({ id: b.id, name: b.name })),
    lines: lines.filter(l => l.active).map(l => ({ id: l.id, name: l.name, brandId: l.brandId })),
  };
}
