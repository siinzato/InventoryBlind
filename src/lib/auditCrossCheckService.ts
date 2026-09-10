// Auditoria Cruzada — camada de I/O. Lê inventory_count_records (sem alterar nada do fluxo
// de contagem existente) e expõe a única escrita nova deste módulo: aprovar uma contagem
// (seta approved_by/approved_at, adicionados em 034_inventory_audit.sql).

import { supabase } from './supabase';
import type { InventoryCountRecord } from './supabase';
import { logAuditEvent } from './auditLogService';
import { buildCountChains, computeCrossCheckSummary, type CountChain, type CrossCheckSummary } from './auditCrossCheckAlgorithm';

export async function listCountRecords(companyId: string): Promise<InventoryCountRecord[]> {
  const { data, error } = await supabase
    .from('inventory_count_records')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) { console.error('[Audit] Error loading count records:', error); return []; }
  return data as InventoryCountRecord[];
}

export async function getCrossCheckData(companyId: string): Promise<{ chains: CountChain[]; summary: CrossCheckSummary }> {
  const records = await listCountRecords(companyId);
  const chains = buildCountChains(records);
  return { chains, summary: computeCrossCheckSummary(chains) };
}

export async function approveCount(
  rootId: string,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<boolean> {
  const { error } = await supabase
    .from('inventory_count_records')
    .update({ approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', rootId)
    .eq('company_id', companyId);
  if (error) { console.error('[Audit] Error approving count:', error); return false; }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'audit.count_approved',
    resourceType: 'inventory_count_record', resourceId: rootId,
  });
  return true;
}
