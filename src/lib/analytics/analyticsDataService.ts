// Analytics — uma única leva de queries (Promise.all), reaproveitada por BlindScore,
// Inventory Health e Auditorias, para não disparar a mesma consulta 3 vezes (RLS já
// escopa tudo por company_id, como em qualquer outro dashboard do app).
import { listCountRecords } from '../auditCrossCheckService';
import { buildCountChains, computeCrossCheckSummary } from '../auditCrossCheckAlgorithm';
import type { CrossCheckSummary } from '../auditCrossCheckAlgorithm';
import { listRecords as listRcaRecords, getSettings as getRcaSettings } from '../rcaService';
import { getMatrixCounts } from '../abcXyzService';
import type { InventoryCountRecord, RcaSettings } from '../supabase';
import type { RcaRecord, AbcXyzCombo } from '../domainTypes';

/** Janela de leitura do RCA — larga o bastante para dar duas metades de período com volume
 *  (mesmo racional de rcaService.getTrendForDimensionValue), sem trazer o histórico inteiro. */
const RCA_WINDOW_DAYS = 180;

export interface AnalyticsRawData {
  countRecords: InventoryCountRecord[];
  crossCheckSummary: CrossCheckSummary;
  crossCheckChainCount: number;
  rcaRecords: RcaRecord[];
  rcaSettings: RcaSettings;
  abcXyzMatrix: Record<AbcXyzCombo, { count: number; value: number }>;
}

export async function getAnalyticsRawData(companyId: string): Promise<AnalyticsRawData> {
  const since = new Date(Date.now() - RCA_WINDOW_DAYS * 86400000).toISOString();

  const [countRecords, rcaRecords, rcaSettings, abcXyzMatrix] = await Promise.all([
    listCountRecords(companyId),
    listRcaRecords(companyId, { from: since }),
    getRcaSettings(companyId),
    getMatrixCounts(companyId),
  ]);

  const chains = buildCountChains(countRecords);
  const crossCheckSummary = computeCrossCheckSummary(chains);

  return {
    countRecords,
    crossCheckSummary,
    crossCheckChainCount: chains.length,
    rcaRecords,
    rcaSettings,
    abcXyzMatrix,
  };
}
