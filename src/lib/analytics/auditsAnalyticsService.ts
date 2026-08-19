// Analytics > Auditorias — histórico, performance e reincidência das auditorias JÁ
// realizadas. Diferente de Operações > Auditoria de Estoque (que EXECUTA a auditoria
// cruzada, em src/components/audit/): aqui só se lê o que já foi feito, reaproveitando os
// mesmos dados (inventory_count_records, rca_records) sem duplicar nenhuma tela de execução.
import { listCountRecords } from '../auditCrossCheckService';
import { listRecords as listRcaRecords, getSettings as getRcaSettings } from '../rcaService';
import { groupByDimension } from '../rcaAlgorithm';
import type { InventoryCountRecord, RcaSettings } from '../supabase';

const RCA_WINDOW_DAYS = 180;

export interface AuditSessionSummary {
  id: string;
  createdAt: string;
  countNumber: 1 | 2 | 3;
  source: 'manual' | 'import';
  totalSku: number;
  skusContados: number;
  divergenciasReais: number;
  accuracy: number | null;
  operator: string | null;
  approved: boolean;
}

export interface RecurringSku {
  sku: string;
  occurrenceCount: number;
  thresholdCount: number;
  windowDays: number;
}

export interface AuditsAnalyticsData {
  sessions: AuditSessionSummary[];
  /** Maior taxa de divergência entre as sessões contadas, mais recentes primeiro em empate. */
  worstSessions: AuditSessionSummary[];
  problemLocations: { location: string; count: number }[];
  recurringSkus: RecurringSku[];
  rcaSettings: RcaSettings;
}

function toSummary(r: InventoryCountRecord): AuditSessionSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    countNumber: r.count_number,
    source: r.source,
    totalSku: r.total_sku,
    skusContados: r.skus_contados,
    divergenciasReais: r.divergencias_reais,
    accuracy: r.accuracy_final ?? r.accuracy_initial,
    operator: r.operator_1 ?? null,
    approved: r.approved_by !== null && r.approved_by !== undefined,
  };
}

export async function getAuditsAnalyticsData(companyId: string): Promise<AuditsAnalyticsData> {
  const since = new Date(Date.now() - RCA_WINDOW_DAYS * 86400000).toISOString();

  const [countRecords, rcaRecords, rcaSettings] = await Promise.all([
    listCountRecords(companyId),
    listRcaRecords(companyId, { from: since }),
    getRcaSettings(companyId),
  ]);

  const sessions = countRecords.map(toSummary);

  const worstSessions = [...sessions]
    .filter(s => s.skusContados > 0)
    .sort((a, b) => b.divergenciasReais / b.skusContados - a.divergenciasReais / a.skusContados)
    .slice(0, 5);

  const problemLocations = groupByDimension(rcaRecords.filter(r => r.location), 'location')
    .slice(0, 8)
    .map(b => ({ location: b.label, count: b.count }));

  const skuCounts = new Map<string, number>();
  for (const r of rcaRecords) if (r.sku) skuCounts.set(r.sku, (skuCounts.get(r.sku) ?? 0) + 1);
  const recurringSkus: RecurringSku[] = Array.from(skuCounts.entries())
    .filter(([, count]) => count >= rcaSettings.recurrence_threshold_count)
    .sort((a, b) => b[1] - a[1])
    .map(([sku, occurrenceCount]) => ({
      sku,
      occurrenceCount,
      thresholdCount: rcaSettings.recurrence_threshold_count,
      windowDays: rcaSettings.recurrence_window_days,
    }));

  return { sessions, worstSessions, problemLocations, recurringSkus, rcaSettings };
}
