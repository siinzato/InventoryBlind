// Vendas — camada de I/O. Vendas são exclusivamente analíticas: este arquivo nunca lê nem escreve
// products/inventory_*/physical_count_* — só sales_import_profiles/sales_import_batches/sales_records.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type { ValidatedSalesRow } from './salesImportUtils';
import type { SalesRecordInput } from './salesTopTen';

export type SalesOrigin = 'tiny' | 'bling' | 'totvs' | 'sap' | 'custom';

export interface SalesImportProfile {
  id: string;
  companyId: string;
  origin: SalesOrigin;
  name: string;
  columnMapping: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface SalesImportBatch {
  id: string;
  companyId: string;
  origin: SalesOrigin;
  profileId: string | null;
  fileName: string;
  fileHash: string;
  rowCount: number;
  importedCount: number;
  unmatchedCount: number;
  status: 'completed' | 'failed';
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface ProfileRow {
  id: string; company_id: string; origin: SalesOrigin; name: string;
  column_mapping: Record<string, string | null>; created_at: string; updated_at: string;
}
interface BatchRow {
  id: string; company_id: string; origin: SalesOrigin; profile_id: string | null;
  file_name: string; file_hash: string; row_count: number; imported_count: number;
  unmatched_count: number; status: 'completed' | 'failed'; error_message: string | null;
  created_by: string | null; created_at: string;
}

function profileFromRow(row: ProfileRow): SalesImportProfile {
  return {
    id: row.id, companyId: row.company_id, origin: row.origin, name: row.name,
    columnMapping: row.column_mapping ?? {}, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function batchFromRow(row: BatchRow): SalesImportBatch {
  return {
    id: row.id, companyId: row.company_id, origin: row.origin, profileId: row.profile_id,
    fileName: row.file_name, fileHash: row.file_hash, rowCount: row.row_count,
    importedCount: row.imported_count, unmatchedCount: row.unmatched_count,
    status: row.status, errorMessage: row.error_message, createdBy: row.created_by, createdAt: row.created_at,
  };
}

export async function listImportProfiles(companyId: string, origin: SalesOrigin): Promise<SalesImportProfile[]> {
  const { data, error } = await supabase
    .from('sales_import_profiles')
    .select('*')
    .eq('company_id', companyId)
    .eq('origin', origin)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(profileFromRow);
}

export async function upsertImportProfile(
  companyId: string,
  origin: SalesOrigin,
  name: string,
  columnMapping: Record<string, string | null>
): Promise<SalesImportProfile> {
  const { data, error } = await supabase
    .from('sales_import_profiles')
    .upsert({ company_id: companyId, origin, name, column_mapping: columnMapping, updated_at: new Date().toISOString() }, { onConflict: 'company_id,origin,name' })
    .select()
    .single();
  if (error) throw error;
  return profileFromRow(data);
}

export async function listImportBatches(companyId: string, limit = 20): Promise<SalesImportBatch[]> {
  const { data, error } = await supabase
    .from('sales_import_batches')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(batchFromRow);
}

// Detecta reimportação — só informa, nunca bloqueia. A tela pede confirmação explícita.
export async function findBatchesByFileHash(companyId: string, fileHash: string): Promise<SalesImportBatch[]> {
  const { data, error } = await supabase
    .from('sales_import_batches')
    .select('*')
    .eq('company_id', companyId)
    .eq('file_hash', fileHash);
  if (error) throw error;
  return (data ?? []).map(batchFromRow);
}

export interface ImportSalesFileParams {
  companyId: string;
  userId: string;
  userEmail: string;
  origin: SalesOrigin;
  profileId: string | null;
  fileName: string;
  fileHash: string;
  rows: ValidatedSalesRow[];
}

// Resolve product_id por SKU (leitura, nunca escreve em products) e insere o lote + os registros.
export async function importSalesFile(params: ImportSalesFileParams): Promise<SalesImportBatch> {
  const { companyId, userId, userEmail, origin, profileId, fileName, fileHash, rows } = params;

  const skus = Array.from(new Set(rows.map(r => r.sku).filter((s): s is string => !!s)));
  const skuToProductId = new Map<string, string>();
  if (skus.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, sku')
      .eq('company_id', companyId)
      .in('sku', skus);
    for (const p of products ?? []) skuToProductId.set(p.sku, p.id);
  }

  const unmatchedCount = rows.filter(r => !r.sku || !skuToProductId.has(r.sku)).length;

  const { data: batchData, error: batchError } = await supabase
    .from('sales_import_batches')
    .insert({
      company_id: companyId, origin, profile_id: profileId, file_name: fileName, file_hash: fileHash,
      row_count: rows.length, imported_count: rows.length, unmatched_count: unmatchedCount, status: 'completed',
    })
    .select()
    .single();
  if (batchError || !batchData) throw batchError ?? new Error('Falha ao registrar o lote de importação.');

  const batch = batchFromRow(batchData);

  if (rows.length > 0) {
    const records = rows.map(r => ({
      company_id: companyId,
      batch_id: batch.id,
      sale_date: r.saleDate,
      sku: r.sku,
      product_name: r.productName,
      quantity: r.quantity,
      unit_price: r.unitPrice,
      total_value: r.totalValue,
      product_id: r.sku ? skuToProductId.get(r.sku) ?? null : null,
    }));
    const { error: recordsError } = await supabase.from('sales_records').insert(records);
    if (recordsError) {
      await supabase.from('sales_import_batches').update({ status: 'failed', error_message: recordsError.message }).eq('id', batch.id);
      throw recordsError;
    }
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'sales_import.completed',
    resourceType: 'sales_import_batch', resourceId: batch.id,
    description: `Importação de vendas: ${fileName}`,
    metadata: { origin, rowCount: rows.length, unmatchedCount },
  });

  return batch;
}

export async function listSalesRecordsForTopTen(companyId: string): Promise<SalesRecordInput[]> {
  const { data, error } = await supabase
    .from('sales_records')
    .select('sale_date, sku, product_name, quantity, total_value')
    .eq('company_id', companyId);
  if (error) throw error;
  return (data ?? []).map(r => ({
    saleDate: r.sale_date, sku: r.sku, productName: r.product_name,
    quantity: Number(r.quantity), totalValue: Number(r.total_value),
  }));
}

// Reset transacional — chama a RPC SECURITY DEFINER (migration 077). Nunca faz o loop de
// UPDATEs no cliente: se o arquivamento falhar dentro da função, o reset inteiro é desfeito.
// A própria RPC já grava o audit_logs dentro da mesma transação — não duplicar aqui.
export async function resetInventoryTransactional(name: string, notes: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_reset_inventory', { p_name: name, p_notes: notes, p_reason: reason });
  if (error) throw error;
  return data as string;
}
