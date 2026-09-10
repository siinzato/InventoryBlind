// Auditoria Estatística — camada de I/O. Usa contagens já importadas (inventory_count_records
// com source='import' + inventory_count_import_items, de 021_count_management.sql) como
// população auditável — nenhuma tabela nova, nenhuma alteração no fluxo de importação.

import { supabase } from './supabase';
import type { InventoryCountRecord, InventoryCountImportItem } from './supabase';
import { logAuditEvent } from './auditLogService';
import { pickSystematicSampleIndexes, type SamplingPlan } from './statisticalAuditAlgorithm';

export async function listImportedCountRecords(companyId: string): Promise<InventoryCountRecord[]> {
  const { data, error } = await supabase
    .from('inventory_count_records')
    .select('*')
    .eq('company_id', companyId)
    .eq('source', 'import')
    .order('created_at', { ascending: false });
  if (error) { console.error('[Audit] Error loading imported count records:', error); return []; }
  return data as InventoryCountRecord[];
}

export async function getImportItems(countRecordId: string, companyId: string): Promise<InventoryCountImportItem[]> {
  const { data, error } = await supabase
    .from('inventory_count_import_items')
    .select('*')
    .eq('count_record_id', countRecordId)
    .eq('company_id', companyId)
    .order('created_at');
  if (error) { console.error('[Audit] Error loading import items:', error); return []; }
  return data as InventoryCountImportItem[];
}

export function drawSample(items: InventoryCountImportItem[], sampleSize: number): InventoryCountImportItem[] {
  const indexes = pickSystematicSampleIndexes(items.length, sampleSize);
  return indexes.map(i => items[i]);
}

export async function logStatisticalAuditRun(
  companyId: string,
  userId: string,
  userEmail: string,
  countRecordId: string,
  plan: SamplingPlan,
  defectsFound: number,
  accepted: boolean
): Promise<void> {
  await logAuditEvent({
    companyId, userId, userEmail, action: 'audit.statistical_run',
    resourceType: 'inventory_count_record', resourceId: countRecordId,
    metadata: { ...plan, defectsFound, accepted },
  });
}
