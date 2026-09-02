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
import type { PillarFactorRow } from './analyticsMath';
import type { InventoryCountRecord, RcaSettings } from '../supabase';
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
    cbcSummary, cbcLastRecalculatedAt, catalogCountResult, factorRowsResult, overdueWithDataResult,
  ] = await Promise.all([
    listCountRecords(companyId),
    listRcaRecords(companyId, { from: since }),
    getRcaSettings(companyId),
    getMatrixCounts(companyId),
    getCompanySummary(companyId),
    getLastRecalculatedAt(companyId),
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
    catalogTotal: catalogCountResult.count ?? 0,
    pillarFactorRows: (factorRowsResult.data ?? []).map(r => (r as { factors: PillarFactorRow }).factors),
    overdueWithSufficientData: overdueWithDataResult.count ?? 0,
  };
}
