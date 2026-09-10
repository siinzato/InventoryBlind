// Ordens de Compra — camada de I/O. Cadastro/importação, vínculo N:N com NF-e,
// De/Para, alocação e conciliação. Nunca escreve em nfe_invoices/nfe_invoice_items/
// products/inventory_* — só lê essas tabelas por referência (FK) para associar.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import { normalizeAdminReason } from '../admin/recordAdmin';
import { normalizeEan } from '../nfe/nfeEanUtils';
import { getInvoiceItems } from '../nfe/nfeService';
import { matchPoItem, buildDetoParaLookup, type PoMatchableItem, type NfeMatchableItem } from './poProductMatcher';
import { proposeAutoAllocations, sumAllocatedForNfeItem, sumAllocatedForPoItem } from './poAllocationEngine';
import { classifyPoItem, type PoItemReconciliationInput } from './poReconciliation';
import { computePoProgress } from './poProgress';
import type {
  PurchaseOrder, PurchaseOrderItem, PoImportProfile, PoImportBatch, PoNfeLink, PoDetoPara, PoAllocation,
  PurchaseOrderStatus, PoColumnMapping, ClassifiedPoImportRow, PoItemComparison, PoProgressStatus,
} from './poTypes';
import type { NfeInvoiceItem } from '../nfe/nfeTypes';

// ── Mapeamento linha <-> domínio ─────────────────────────────────────────────

interface PurchaseOrderRow {
  id: string; company_id: string; po_number: string; origin: string; supplier_name: string;
  supplier_cnpj: string | null; issue_date: string | null; notes: string | null; status: PurchaseOrderStatus;
  closed_reason: string | null; closed_by: string | null; closed_at: string | null;
  attachment_path: string | null; attachment_name: string | null; import_batch_id: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
interface PurchaseOrderItemRow {
  id: string; purchase_order_id: string; company_id: string; line_number: number; origin_code: string | null;
  product_id: string | null; ean: string | null; ean_normalized: string | null; description: string;
  unit: string | null; quantity: number | string; unit_price: number | string | null; total_value: number | string | null;
  created_at: string; updated_at: string;
}
interface PoImportProfileRow {
  id: string; company_id: string; origin: PoImportProfile['origin']; name: string; column_mapping: PoColumnMapping;
  created_by: string | null; created_at: string; updated_at: string;
}
interface PoImportBatchRow {
  id: string; company_id: string; origin: string; profile_id: string | null; file_name: string; file_hash: string;
  row_count: number; status: PoImportBatch['status']; error_message: string | null; created_by: string | null; created_at: string;
}
interface PoNfeLinkRow {
  id: string; company_id: string; purchase_order_id: string; invoice_id: string; linked_by: string | null;
  linked_at: string; unlinked_at: string | null; unlinked_by: string | null; unlink_reason: string | null;
  reconciliation_status: PoNfeLink['reconciliationStatus']; reconciled_at: string | null; reconciliation_error: string | null;
}
interface PoDetoParaRow {
  id: string; company_id: string; supplier_key: string; origin: string; match_type: PoDetoPara['matchType'];
  match_value: string; product_id: string; active: boolean; created_by: string | null; created_at: string; updated_at: string;
}
interface PoAllocationRow {
  id: string; company_id: string; po_link_id: string; po_item_id: string; nfe_item_id: string;
  allocated_quantity: number | string; match_method: PoAllocation['matchMethod']; source: PoAllocation['source'];
  created_by: string | null; created_at: string; updated_at: string;
}

function poFromRow(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id, companyId: row.company_id, poNumber: row.po_number, origin: row.origin,
    supplierName: row.supplier_name, supplierCnpj: row.supplier_cnpj, issueDate: row.issue_date,
    notes: row.notes, status: row.status, closedReason: row.closed_reason, closedBy: row.closed_by,
    closedAt: row.closed_at, attachmentPath: row.attachment_path, attachmentName: row.attachment_name,
    importBatchId: row.import_batch_id, createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: PurchaseOrderItemRow): PurchaseOrderItem {
  return {
    id: row.id, purchaseOrderId: row.purchase_order_id, companyId: row.company_id,
    lineNumber: row.line_number, originCode: row.origin_code, productId: row.product_id, ean: row.ean,
    eanNormalized: row.ean_normalized, description: row.description, unit: row.unit,
    quantity: Number(row.quantity), unitPrice: row.unit_price !== null ? Number(row.unit_price) : null,
    totalValue: row.total_value !== null ? Number(row.total_value) : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function profileFromRow(row: PoImportProfileRow): PoImportProfile {
  return {
    id: row.id, companyId: row.company_id, origin: row.origin, name: row.name,
    columnMapping: row.column_mapping, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function batchFromRow(row: PoImportBatchRow): PoImportBatch {
  return {
    id: row.id, companyId: row.company_id, origin: row.origin, profileId: row.profile_id,
    fileName: row.file_name, fileHash: row.file_hash, rowCount: row.row_count, status: row.status,
    errorMessage: row.error_message, createdBy: row.created_by, createdAt: row.created_at,
  };
}

function linkFromRow(row: PoNfeLinkRow): PoNfeLink {
  return {
    id: row.id, companyId: row.company_id, purchaseOrderId: row.purchase_order_id, invoiceId: row.invoice_id,
    linkedBy: row.linked_by, linkedAt: row.linked_at, unlinkedAt: row.unlinked_at, unlinkedBy: row.unlinked_by,
    unlinkReason: row.unlink_reason, reconciliationStatus: row.reconciliation_status,
    reconciledAt: row.reconciled_at, reconciliationError: row.reconciliation_error,
  };
}

function detoParaFromRow(row: PoDetoParaRow): PoDetoPara {
  return {
    id: row.id, companyId: row.company_id, supplierKey: row.supplier_key, origin: row.origin,
    matchType: row.match_type, matchValue: row.match_value, productId: row.product_id, active: row.active,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function allocationFromRow(row: PoAllocationRow): PoAllocation {
  return {
    id: row.id, companyId: row.company_id, poLinkId: row.po_link_id, poItemId: row.po_item_id,
    nfeItemId: row.nfe_item_id, allocatedQuantity: Number(row.allocated_quantity),
    matchMethod: row.match_method, source: row.source, createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** Chave de escopo do De/Para — fornecedor normalizado, nunca o texto original (que continua intacto no cabeçalho da OC). */
export function supplierKeyFor(supplierName: string): string {
  return supplierName.trim().toLowerCase();
}

// ── CRUD de OC ───────────────────────────────────────────────────────────────

export async function listPurchaseOrders(companyId: string): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(poFromRow);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? poFromRow(data) : null;
}

export async function getPurchaseOrderItems(purchaseOrderId: string): Promise<PurchaseOrderItem[]> {
  const { data, error } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', purchaseOrderId)
    .order('line_number', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(itemFromRow);
}

export interface PurchaseOrderHeaderInput {
  poNumber: string;
  origin: string;
  supplierName: string;
  supplierCnpj?: string | null;
  issueDate?: string | null;
  notes?: string | null;
}

export interface PurchaseOrderItemInput {
  lineNumber: number;
  originCode?: string | null;
  productId?: string | null;
  ean?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  unitPrice?: number | null;
  totalValue?: number | null;
}

/** Cria a OC (rascunho) com seus itens. Falha em qualquer etapa não deixa uma OC
 *  parcial: os itens só são inseridos depois que o cabeçalho foi criado com sucesso,
 *  e uma falha na inserção dos itens remove o cabeçalho recém-criado (compensação
 *  no cliente — não há transação multi-tabela no PostgREST). */
export async function createPurchaseOrder(
  companyId: string,
  header: PurchaseOrderHeaderInput,
  items: PurchaseOrderItemInput[],
  userId: string,
  userEmail: string,
  importBatchId?: string | null
): Promise<PurchaseOrder> {
  const { data: poRow, error: poError } = await supabase
    .from('purchase_orders')
    .insert({
      company_id: companyId, po_number: header.poNumber, origin: header.origin,
      supplier_name: header.supplierName, supplier_cnpj: header.supplierCnpj ?? null,
      issue_date: header.issueDate ?? null, notes: header.notes ?? null,
      import_batch_id: importBatchId ?? null,
    })
    .select()
    .single();
  if (poError || !poRow) throw poError ?? new Error('Falha ao criar a OC.');

  const po = poFromRow(poRow);

  if (items.length > 0) {
    const { error: itemsError } = await supabase.from('purchase_order_items').insert(
      items.map(item => ({
        purchase_order_id: po.id, company_id: companyId, line_number: item.lineNumber,
        origin_code: item.originCode ?? null, product_id: item.productId ?? null, ean: item.ean ?? null,
        ean_normalized: normalizeEan(item.ean ?? null), description: item.description, unit: item.unit ?? null,
        quantity: item.quantity, unit_price: item.unitPrice ?? null, total_value: item.totalValue ?? null,
      }))
    );
    if (itemsError) {
      await supabase.from('purchase_orders').delete().eq('id', po.id);
      throw itemsError;
    }
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'po.created', resourceType: 'purchase_orders', resourceId: po.id,
    metadata: { poNumber: po.poNumber, supplierName: po.supplierName, itemCount: items.length },
  });

  return po;
}

export async function updatePurchaseOrderHeader(
  companyId: string, id: string, header: Partial<PurchaseOrderHeaderInput>, userId: string, userEmail: string
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (header.poNumber !== undefined) payload.po_number = header.poNumber;
  if (header.origin !== undefined) payload.origin = header.origin;
  if (header.supplierName !== undefined) payload.supplier_name = header.supplierName;
  if (header.supplierCnpj !== undefined) payload.supplier_cnpj = header.supplierCnpj;
  if (header.issueDate !== undefined) payload.issue_date = header.issueDate;
  if (header.notes !== undefined) payload.notes = header.notes;

  const { error } = await supabase.from('purchase_orders').update(payload).eq('id', id).eq('company_id', companyId);
  if (error) throw error;

  await logAuditEvent({ companyId, userId, userEmail, action: 'po.updated', resourceType: 'purchase_orders', resourceId: id });
}

export async function replacePurchaseOrderItems(
  companyId: string, purchaseOrderId: string, items: PurchaseOrderItemInput[], userId: string, userEmail: string
): Promise<void> {
  const { error: deleteError } = await supabase.from('purchase_order_items').delete().eq('purchase_order_id', purchaseOrderId);
  if (deleteError) throw deleteError;

  if (items.length > 0) {
    const { error: insertError } = await supabase.from('purchase_order_items').insert(
      items.map(item => ({
        purchase_order_id: purchaseOrderId, company_id: companyId, line_number: item.lineNumber,
        origin_code: item.originCode ?? null, product_id: item.productId ?? null, ean: item.ean ?? null,
        ean_normalized: normalizeEan(item.ean ?? null), description: item.description, unit: item.unit ?? null,
        quantity: item.quantity, unit_price: item.unitPrice ?? null, total_value: item.totalValue ?? null,
      }))
    );
    if (insertError) throw insertError;
  }

  await logAuditEvent({ companyId, userId, userEmail, action: 'po.updated', resourceType: 'purchase_orders', resourceId: purchaseOrderId, metadata: { itemCount: items.length } });
}

/** Só permitido para rascunho sem nenhum vínculo ativo (canHardDeletePurchaseOrder). */
export async function hardDeletePurchaseOrder(companyId: string, id: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.hard_deleted', resourceType: 'purchase_orders', resourceId: id });
}

export async function countActiveLinksForPurchaseOrder(purchaseOrderId: string): Promise<number> {
  const { count, error } = await supabase
    .from('po_nfe_links')
    .select('id', { count: 'exact', head: true })
    .eq('purchase_order_id', purchaseOrderId)
    .is('unlinked_at', null);
  if (error) throw error;
  return count ?? 0;
}

export function canHardDeletePurchaseOrder(po: Pick<PurchaseOrder, 'status'>, activeLinkCount: number): boolean {
  return po.status === 'draft' && activeLinkCount === 0;
}

// ── Encerramento (sempre decisão do operador) ───────────────────────────────

export async function closePurchaseOrder(
  companyId: string, id: string, status: Extract<PurchaseOrderStatus, 'closed' | 'closed_with_differences' | 'cancelled'>,
  reason: string | null, userId: string, userEmail: string
): Promise<void> {
  if (status === 'closed_with_differences' && !normalizeAdminReason(reason ?? '')) {
    throw new Error('Informe uma observação para encerrar com diferenças.');
  }

  const { error } = await supabase
    .from('purchase_orders')
    .update({
      status, closed_reason: reason ? normalizeAdminReason(reason) : null,
      closed_by: userId, closed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;

  const action = status === 'closed_with_differences' ? 'po.closed_with_differences' : status === 'cancelled' ? 'po.cancelled' : 'po.closed';
  await logAuditEvent({ companyId, userId, userEmail, action, resourceType: 'purchase_orders', resourceId: id, metadata: { reason } });
}

export async function reopenPurchaseOrder(companyId: string, id: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'open', closed_reason: null, closed_by: null, closed_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.updated', resourceType: 'purchase_orders', resourceId: id, metadata: { reopened: true } });
}

// ── Perfis de importação ────────────────────────────────────────────────────

export async function listImportProfiles(companyId: string): Promise<PoImportProfile[]> {
  const { data, error } = await supabase.from('po_import_profiles').select('*').eq('company_id', companyId).order('name');
  if (error) throw error;
  return (data ?? []).map(profileFromRow);
}

export async function upsertImportProfile(
  companyId: string, input: { id?: string; origin: PoImportProfile['origin']; name: string; columnMapping: PoColumnMapping },
  userId: string, userEmail: string
): Promise<PoImportProfile> {
  const { data, error } = await supabase
    .from('po_import_profiles')
    .upsert(
      { id: input.id, company_id: companyId, origin: input.origin, name: input.name, column_mapping: input.columnMapping, updated_at: new Date().toISOString() },
      { onConflict: 'company_id,origin,name' }
    )
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao salvar o perfil de importação.');
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.updated', resourceType: 'po_import_profiles', resourceId: data.id, metadata: { origin: input.origin, name: input.name } });
  return profileFromRow(data);
}

// ── Importação de arquivo ────────────────────────────────────────────────────

export async function hashFileContent(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function findBatchesWithHash(companyId: string, fileHash: string): Promise<PoImportBatch[]> {
  const { data, error } = await supabase
    .from('po_import_batches')
    .select('*')
    .eq('company_id', companyId)
    .eq('file_hash', fileHash)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(batchFromRow);
}

export interface ImportPurchaseOrderInput {
  origin: string;
  profileId?: string | null;
  fileName: string;
  fileHash: string;
  header: PurchaseOrderHeaderInput;
  rows: ClassifiedPoImportRow[];
}

/** Só grava quando TODAS as linhas passarem (sem erro) — nenhuma OC parcial em
 *  caso de linha inválida. O chamador deve ter oferecido a correção antes de chegar
 *  aqui (a prévia mostra os erros; esta função é a confirmação final). */
export async function importPurchaseOrder(
  companyId: string, input: ImportPurchaseOrderInput, userId: string, userEmail: string
): Promise<PurchaseOrder> {
  const invalidRows = input.rows.filter(r => r.errors.length > 0);
  if (invalidRows.length > 0) {
    await supabase.from('po_import_batches').insert({
      company_id: companyId, origin: input.origin, profile_id: input.profileId ?? null,
      file_name: input.fileName, file_hash: input.fileHash, row_count: input.rows.length,
      status: 'failed', error_message: `${invalidRows.length} linha(s) inválida(s) — importação não gravada.`,
    });
    throw new Error(`${invalidRows.length} linha(s) inválida(s) — corrija antes de importar.`);
  }

  const { data: batchRow, error: batchError } = await supabase
    .from('po_import_batches')
    .insert({
      company_id: companyId, origin: input.origin, profile_id: input.profileId ?? null,
      file_name: input.fileName, file_hash: input.fileHash, row_count: input.rows.length, status: 'completed',
    })
    .select()
    .single();
  if (batchError || !batchRow) throw batchError ?? new Error('Falha ao registrar a importação.');

  const items: PurchaseOrderItemInput[] = input.rows.map(row => ({
    lineNumber: row.lineNumber, originCode: row.originCode, ean: row.ean, description: row.description,
    unit: row.unit, quantity: row.quantity, unitPrice: row.unitPrice, totalValue: row.totalValue,
  }));

  const po = await createPurchaseOrder(companyId, input.header, items, userId, userEmail, batchRow.id);

  await logAuditEvent({
    companyId, userId, userEmail, action: 'po.imported', resourceType: 'purchase_orders', resourceId: po.id,
    metadata: { origin: input.origin, fileName: input.fileName, rowCount: input.rows.length },
  });

  return po;
}

// ── Vínculo N:N com NF-e ─────────────────────────────────────────────────────

export async function listActiveLinksForPurchaseOrder(purchaseOrderId: string): Promise<PoNfeLink[]> {
  const { data, error } = await supabase
    .from('po_nfe_links')
    .select('*')
    .eq('purchase_order_id', purchaseOrderId)
    .is('unlinked_at', null);
  if (error) throw error;
  return (data ?? []).map(linkFromRow);
}

export async function listActiveLinksForInvoice(invoiceId: string): Promise<PoNfeLink[]> {
  const { data, error } = await supabase
    .from('po_nfe_links')
    .select('*')
    .eq('invoice_id', invoiceId)
    .is('unlinked_at', null);
  if (error) throw error;
  return (data ?? []).map(linkFromRow);
}

/** Cria um vínculo por par (OC, NF-e) que ainda não tem vínculo ativo. Idempotente:
 *  uma colisão no índice único parcial (par já vinculado) é tratada como sucesso,
 *  nunca como erro — clique duplo ou requisição repetida não duplica o vínculo. */
export async function linkPurchaseOrdersToInvoices(
  companyId: string, purchaseOrderIds: string[], invoiceIds: string[], userId: string, userEmail: string
): Promise<PoNfeLink[]> {
  const created: PoNfeLink[] = [];

  for (const purchaseOrderId of purchaseOrderIds) {
    for (const invoiceId of invoiceIds) {
      const { data, error } = await supabase
        .from('po_nfe_links')
        .insert({ company_id: companyId, purchase_order_id: purchaseOrderId, invoice_id: invoiceId, linked_by: userId })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') continue; // já vinculado — idempotente, não é erro
        throw error;
      }
      if (data) {
        created.push(linkFromRow(data));
        await logAuditEvent({
          companyId, userId, userEmail, action: 'po.linked', resourceType: 'po_nfe_links', resourceId: data.id,
          metadata: { purchaseOrderId, invoiceId },
        });
      }
    }
  }

  return created;
}

export async function unlinkPurchaseOrderFromInvoice(
  companyId: string, linkId: string, reason: string, userId: string, userEmail: string
): Promise<void> {
  const normalizedReason = normalizeAdminReason(reason);
  if (!normalizedReason) throw new Error('Informe o motivo da desvinculação.');

  const { error } = await supabase
    .from('po_nfe_links')
    .update({ unlinked_at: new Date().toISOString(), unlinked_by: userId, unlink_reason: normalizedReason })
    .eq('id', linkId)
    .eq('company_id', companyId)
    .is('unlinked_at', null);
  if (error) throw error;

  await logAuditEvent({ companyId, userId, userEmail, action: 'po.unlinked', resourceType: 'po_nfe_links', resourceId: linkId, metadata: { reason: normalizedReason } });
}

// ── De/Para ──────────────────────────────────────────────────────────────────

export async function listActiveDetoPara(companyId: string, supplierKey: string, origin: string): Promise<PoDetoPara[]> {
  const { data, error } = await supabase
    .from('po_deto_para')
    .select('*')
    .eq('company_id', companyId)
    .eq('supplier_key', supplierKey)
    .eq('origin', origin)
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map(detoParaFromRow);
}

/** Confirma manualmente e, se solicitado, aprende o De/Para: desativa a
 *  correspondência ativa anterior para a mesma chave (se houver) e insere uma nova
 *  — nunca sobrescreve, preserva o histórico completo. */
export async function confirmDetoParaMapping(
  companyId: string,
  input: { supplierKey: string; origin: string; matchType: 'code' | 'ean'; matchValue: string; productId: string },
  userId: string, userEmail: string
): Promise<PoDetoPara> {
  const { data: existing } = await supabase
    .from('po_deto_para')
    .select('id')
    .eq('company_id', companyId)
    .eq('supplier_key', input.supplierKey)
    .eq('origin', input.origin)
    .eq('match_type', input.matchType)
    .eq('match_value', input.matchValue)
    .eq('active', true)
    .maybeSingle();

  if (existing) {
    await supabase.from('po_deto_para').update({ active: false, updated_at: new Date().toISOString() }).eq('id', existing.id);
  }

  const { data, error } = await supabase
    .from('po_deto_para')
    .insert({
      company_id: companyId, supplier_key: input.supplierKey, origin: input.origin,
      match_type: input.matchType, match_value: input.matchValue, product_id: input.productId, created_by: userId,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao salvar o De/Para.');

  await logAuditEvent({
    companyId, userId, userEmail, action: 'po.deto_para_confirmed', resourceType: 'po_deto_para', resourceId: data.id,
    metadata: { supplierKey: input.supplierKey, origin: input.origin, matchType: input.matchType, matchValue: input.matchValue },
  });

  return detoParaFromRow(data);
}

export async function deactivateDetoParaMapping(companyId: string, id: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('po_deto_para').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.deto_para_deactivated', resourceType: 'po_deto_para', resourceId: id });
}

// ── Alocação manual ──────────────────────────────────────────────────────────

export async function listAllocationsForLink(poLinkId: string): Promise<PoAllocation[]> {
  const { data, error } = await supabase.from('po_allocations').select('*').eq('po_link_id', poLinkId);
  if (error) throw error;
  return (data ?? []).map(allocationFromRow);
}

export async function listAllocationsForPurchaseOrder(purchaseOrderId: string): Promise<PoAllocation[]> {
  const { data, error } = await supabase
    .from('po_allocations')
    .select('*, purchase_order_items!inner(purchase_order_id)')
    .eq('purchase_order_items.purchase_order_id', purchaseOrderId);
  if (error) throw error;
  return (data ?? []).map(allocationFromRow);
}

export async function addManualAllocation(
  companyId: string,
  input: { poLinkId: string; poItemId: string; nfeItemId: string; quantity: number },
  userId: string, userEmail: string
): Promise<PoAllocation> {
  const { data, error } = await supabase
    .from('po_allocations')
    .insert({
      company_id: companyId, po_link_id: input.poLinkId, po_item_id: input.poItemId, nfe_item_id: input.nfeItemId,
      allocated_quantity: input.quantity, match_method: 'manual', source: 'manual', created_by: userId,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao salvar a alocação.');
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.allocation_adjusted', resourceType: 'po_allocations', resourceId: data.id, metadata: input });
  return allocationFromRow(data);
}

export async function updateAllocationQuantity(companyId: string, id: string, quantity: number, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('po_allocations').update({ allocated_quantity: quantity, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.allocation_adjusted', resourceType: 'po_allocations', resourceId: id, metadata: { quantity } });
}

export async function removeAllocation(companyId: string, id: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('po_allocations').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'po.allocation_adjusted', resourceType: 'po_allocations', resourceId: id, metadata: { removed: true } });
}

// ── Conciliação ──────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  poItemComparisons: PoItemComparison[];
  nfeItemsNotPredictedCount: number;
  progress: PoProgressStatus;
}

/** Roda a conciliação para os vínculos ativos de uma OC: busca itens da OC e das
 *  NF-es vinculadas, o De/Para do escopo (empresa+fornecedor+origem), as alocações
 *  já existentes (globais por item de NF-e, para não estourar capacidade
 *  compartilhada entre OCs diferentes), propõe novas alocações automáticas quando
 *  inequívoco, grava e classifica. Falha aqui nunca desfaz o vínculo — só marca
 *  `reconciliation_status='failed'` e devolve o erro para a tela oferecer retry. */
export async function runReconciliation(
  companyId: string, purchaseOrder: PurchaseOrder, userId: string, userEmail: string
): Promise<ReconciliationResult> {
  const links = await listActiveLinksForPurchaseOrder(purchaseOrder.id);

  try {
    const poItems = await getPurchaseOrderItems(purchaseOrder.id);

    const nfeItemsByInvoice = new Map<string, NfeInvoiceItem[]>();
    for (const link of links) {
      if (!nfeItemsByInvoice.has(link.invoiceId)) {
        nfeItemsByInvoice.set(link.invoiceId, await getInvoiceItems(link.invoiceId));
      }
    }
    const allNfeItems = Array.from(nfeItemsByInvoice.values()).flat();

    const supplierKey = supplierKeyFor(purchaseOrder.supplierName);
    const detoPara = await listActiveDetoPara(companyId, supplierKey, purchaseOrder.origin);
    const learnedLookup = buildDetoParaLookup(detoPara.map(d => ({ matchType: d.matchType, matchValue: d.matchValue, productId: d.productId })));

    const matchablePoItems: PoMatchableItem[] = poItems.map(i => ({
      id: i.id, originCode: i.originCode, eanNormalized: i.eanNormalized, productId: i.productId, description: i.description,
    }));
    const matchableNfeItems: NfeMatchableItem[] = allNfeItems.map(i => ({
      id: i.id, nfeCode: i.nfe_code, nfeEanNormalized: i.nfe_ean_normalized, productId: i.product_id, description: i.description ?? '',
    }));

    const matches = matchablePoItems.map(item => matchPoItem(item, matchableNfeItems, learnedLookup));

    // Alocações já existentes GLOBAIS (qualquer OC) para os itens de NF-e envolvidos
    // — a capacidade restante de um item de NF-e é compartilhada entre OCs.
    const nfeItemIds = allNfeItems.map(i => i.id);
    const existingAllocations = nfeItemIds.length > 0 ? await fetchAllocationsForNfeItems(nfeItemIds) : [];
    const existingForThesePoItems = await fetchAllocationsForPoItems(poItems.map(i => i.id));

    const demandByPoItem = new Map(poItems.map(i => [i.id, Math.max(0, i.quantity - sumAllocatedForPoItem(existingForThesePoItems, i.id))]));
    const capacityByNfeItem = new Map(allNfeItems.map(i => [i.id, Math.max(0, i.expected_quantity - sumAllocatedForNfeItem(existingAllocations, i.id))]));

    const proposals = proposeAutoAllocations(matches, demandByPoItem, capacityByNfeItem);

    const relevantLinkByInvoice = new Map(links.map(l => [l.invoiceId, l.id]));
    const nfeItemToInvoice = new Map<string, string>();
    for (const [invoiceId, items] of nfeItemsByInvoice) {
      for (const item of items) nfeItemToInvoice.set(item.id, invoiceId);
    }

    if (proposals.length > 0) {
      const { error: allocError } = await supabase.from('po_allocations').insert(
        proposals.map(p => ({
          company_id: companyId,
          po_link_id: relevantLinkByInvoice.get(nfeItemToInvoice.get(p.nfeItemId) ?? '') ?? links[0]?.id,
          po_item_id: p.poItemId, nfe_item_id: p.nfeItemId, allocated_quantity: p.quantity,
          match_method: p.matchMethod, source: 'auto', created_by: userId,
        }))
      );
      if (allocError) throw allocError;
    }

    const finalAllocations = [...existingForThesePoItems, ...proposals.map(p => ({ poItemId: p.poItemId, nfeItemId: p.nfeItemId, allocatedQuantity: p.quantity }))];

    const nfeItemById = new Map(allNfeItems.map(i => [i.id, i]));
    const comparisons: PoItemComparison[] = poItems.map(poItem => {
      const match = matches.find(m => m.poItemId === poItem.id);
      const allocatedQuantity = sumAllocatedForPoItem(finalAllocations, poItem.id);
      const allocatedForItem = finalAllocations.filter(a => a.poItemId === poItem.id);

      let weightedUnitPriceInvoiced: number | null = null;
      let invoicedUnit: string | null = null;
      if (allocatedForItem.length > 0 && allocatedQuantity > 0) {
        let weightedSum = 0;
        for (const a of allocatedForItem) {
          const nfeItem = nfeItemById.get(a.nfeItemId);
          if (nfeItem?.unit_value != null) weightedSum += nfeItem.unit_value * a.allocatedQuantity;
          if (!invoicedUnit && nfeItem?.unit) invoicedUnit = nfeItem.unit;
        }
        weightedUnitPriceInvoiced = weightedSum / allocatedQuantity;
      }

      const input: PoItemReconciliationInput = {
        poItemId: poItem.id, orderedQuantity: poItem.quantity, unitPriceOrdered: poItem.unitPrice, unit: poItem.unit,
        hasNoCandidates: !match || (match.candidates.length === 0 && !match.nameSuggestion),
        hasUnresolvedCandidates: !!match && (match.candidates.length > 0 || !!match.nameSuggestion) && allocatedQuantity === 0,
        allocatedQuantity, weightedUnitPriceInvoiced, invoicedUnit,
      };
      return classifyPoItem(input);
    });

    const allocatedNfeItemIds = new Set(finalAllocations.map(a => a.nfeItemId));
    const notPredictedCount = allNfeItems.filter(i => !allocatedNfeItemIds.has(i.id)).length;

    const progress = computePoProgress({ hasActiveLinks: links.length > 0, itemStatuses: comparisons.map(c => c.status) });

    await supabase.from('po_nfe_links').update({ reconciliation_status: 'ok', reconciled_at: new Date().toISOString(), reconciliation_error: null }).in('id', links.map(l => l.id));

    if (proposals.length > 0) {
      await logAuditEvent({
        companyId, userId, userEmail, action: 'po.allocation_adjusted', resourceType: 'purchase_orders', resourceId: purchaseOrder.id,
        metadata: { autoAllocations: proposals.length },
      });
    }

    return { poItemComparisons: comparisons, nfeItemsNotPredictedCount: notPredictedCount, progress };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido na conciliação.';
    if (links.length > 0) {
      await supabase.from('po_nfe_links').update({ reconciliation_status: 'failed', reconciliation_error: message }).in('id', links.map(l => l.id));
    }
    throw err;
  }
}

async function fetchAllocationsForNfeItems(nfeItemIds: string[]): Promise<{ nfeItemId: string; poItemId: string; allocatedQuantity: number }[]> {
  const { data, error } = await supabase.from('po_allocations').select('nfe_item_id, po_item_id, allocated_quantity').in('nfe_item_id', nfeItemIds);
  if (error) throw error;
  return (data ?? []).map(r => ({ nfeItemId: r.nfe_item_id, poItemId: r.po_item_id, allocatedQuantity: Number(r.allocated_quantity) }));
}

async function fetchAllocationsForPoItems(poItemIds: string[]): Promise<{ poItemId: string; nfeItemId: string; allocatedQuantity: number }[]> {
  if (poItemIds.length === 0) return [];
  const { data, error } = await supabase.from('po_allocations').select('po_item_id, nfe_item_id, allocated_quantity').in('po_item_id', poItemIds);
  if (error) throw error;
  return (data ?? []).map(r => ({ poItemId: r.po_item_id, nfeItemId: r.nfe_item_id, allocatedQuantity: Number(r.allocated_quantity) }));
}

// ── Histórico ────────────────────────────────────────────────────────────────

export interface PoAuditEvent {
  id: string;
  action: string;
  userEmail: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

/** Ações registradas diretamente sobre a OC (criação, edição, importação,
 *  encerramento/cancelamento, ajustes de alocação da conciliação automática).
 *  Vínculo/desvínculo e De/Para têm seu próprio resource_id (o do vínculo/mapeamento,
 *  não o da OC) — aparecem no histórico geral de auditoria da empresa. */
export async function listAuditEventsForPurchaseOrder(companyId: string, purchaseOrderId: string): Promise<PoAuditEvent[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, user_email, created_at, metadata')
    .eq('company_id', companyId)
    .eq('resource_type', 'purchase_orders')
    .eq('resource_id', purchaseOrderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, action: r.action, userEmail: r.user_email, createdAt: r.created_at, metadata: r.metadata ?? {} }));
}
