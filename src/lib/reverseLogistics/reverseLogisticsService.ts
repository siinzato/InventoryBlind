// Logística Reversa — camada de I/O. Recebimento, conferência, inspeção e destinação.
// Nunca escreve em products/sales_records/nfe_invoices/purchase_orders — só lê essas
// tabelas por referência (FK opcional) para localizar o que está sendo devolvido, mesmo
// princípio de src/lib/purchaseOrders/poService.ts em relação a nfe_invoices/products.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type {
  ReturnRecord, ReturnItem, ReturnAttachment, ReturnAuditEvent,
  ReturnStatus, ReturnSourceType, ReturnDestination, ReturnClassification,
  ChecklistTemplate, ChecklistTemplateItem, ChecklistResponseType,
  ConditionGrade, DestinationRule, ApprovalSettings, ApprovalRequest, ApprovalType,
  ServiceOrder, ServiceOrderType, ServiceOrderStatus, QuarantineHold,
} from './reverseLogisticsTypes';
import type { OriginChannelSource } from './originChannelResolver';

const ATTACHMENTS_BUCKET = 'return-attachments';
const ATTACHMENT_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const ATTACHMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

// ── Mapeamento linha <-> domínio ─────────────────────────────────────────────

interface ReturnRow {
  id: string; company_id: string; code: string; status: ReturnStatus; source_type: ReturnSourceType;
  reference_value: string | null; linked_sale_id: string | null; linked_nfe_invoice_id: string | null;
  linked_purchase_order_id: string | null; unresolved: boolean; customer_name: string | null;
  origin: string | null; reason: string | null; expected_quantity: number | string | null;
  /** Migration 090, aditiva — opcionais até a migration ser aplicada, mesmo
   *  padrão de deleted_at em NfeInvoice. */
  origin_channel_connection_id?: string | null;
  origin_source?: OriginChannelSource | null;
  received_at: string; received_by: string | null; notes: string | null;
  status_changed_by: string | null; status_changed_at: string | null; cancellation_reason: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

interface ReturnItemRow {
  id: string; return_id: string; company_id: string; line_number: number; product_id: string | null;
  sku: string | null; ean: string | null; description: string;
  expected_quantity: number | string | null; received_quantity: number | string;
  lot_number: string | null; serial_number: string | null; original_packaging: boolean | null;
  accessories_received: string | null; item_notes: string | null;
  checklist_correct_product: boolean | null; checklist_packaging_intact: boolean | null;
  checklist_no_visible_damage: boolean | null; checklist_apparently_functional: boolean | null;
  checklist_accessories_complete: boolean | null; checklist_signs_of_use: boolean | null;
  checklist_serial_matches: boolean | null; classification: ReturnClassification | null;
  inspected_by: string | null; inspected_at: string | null;
  destination: ReturnDestination | null; destination_reason: string | null;
  destination_status: 'pending' | 'moved' | 'in_treatment'; destination_decided_by: string | null;
  destination_decided_at: string | null; current_location: string;
  checklist_template_id: string | null; checklist_template_version: number | null;
  condition_grade_id: string | null; suggested_destination: ReturnDestination | null;
  suggested_destination_rule_id: string | null; erp_sync_adjustment_id: string | null;
  created_at: string; updated_at: string;
}

function returnFromRow(row: ReturnRow): ReturnRecord {
  return {
    id: row.id, companyId: row.company_id, code: row.code, status: row.status, sourceType: row.source_type,
    referenceValue: row.reference_value, linkedSaleId: row.linked_sale_id, linkedNfeInvoiceId: row.linked_nfe_invoice_id,
    linkedPurchaseOrderId: row.linked_purchase_order_id, unresolved: row.unresolved, customerName: row.customer_name,
    origin: row.origin,
    originChannelConnectionId: row.origin_channel_connection_id ?? null,
    originSource: row.origin_source ?? null,
    reason: row.reason, expectedQuantity: row.expected_quantity !== null ? Number(row.expected_quantity) : null,
    receivedAt: row.received_at, receivedBy: row.received_by, notes: row.notes,
    statusChangedBy: row.status_changed_by, statusChangedAt: row.status_changed_at, cancellationReason: row.cancellation_reason,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ReturnItemRow): ReturnItem {
  return {
    id: row.id, returnId: row.return_id, companyId: row.company_id, lineNumber: row.line_number,
    productId: row.product_id, sku: row.sku, ean: row.ean, description: row.description,
    expectedQuantity: row.expected_quantity !== null ? Number(row.expected_quantity) : null,
    receivedQuantity: Number(row.received_quantity), lotNumber: row.lot_number, serialNumber: row.serial_number,
    originalPackaging: row.original_packaging, accessoriesReceived: row.accessories_received, itemNotes: row.item_notes,
    checklistCorrectProduct: row.checklist_correct_product, checklistPackagingIntact: row.checklist_packaging_intact,
    checklistNoVisibleDamage: row.checklist_no_visible_damage, checklistApparentlyFunctional: row.checklist_apparently_functional,
    checklistAccessoriesComplete: row.checklist_accessories_complete, checklistSignsOfUse: row.checklist_signs_of_use,
    checklistSerialMatches: row.checklist_serial_matches, classification: row.classification,
    inspectedBy: row.inspected_by, inspectedAt: row.inspected_at,
    destination: row.destination, destinationReason: row.destination_reason, destinationStatus: row.destination_status,
    destinationDecidedBy: row.destination_decided_by, destinationDecidedAt: row.destination_decided_at,
    currentLocation: row.current_location,
    checklistTemplateId: row.checklist_template_id, checklistTemplateVersion: row.checklist_template_version,
    conditionGradeId: row.condition_grade_id, suggestedDestination: row.suggested_destination,
    suggestedDestinationRuleId: row.suggested_destination_rule_id, erpSyncAdjustmentId: row.erp_sync_adjustment_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function attachmentFromRow(row: {
  id: string; return_id: string; return_item_id: string | null; company_id: string;
  file_path: string; file_name: string; uploaded_by: string | null; created_at: string;
}): ReturnAttachment {
  return {
    id: row.id, returnId: row.return_id, returnItemId: row.return_item_id, companyId: row.company_id,
    filePath: row.file_path, fileName: row.file_name, uploadedBy: row.uploaded_by, createdAt: row.created_at,
  };
}

// ── Listagem e detalhe ───────────────────────────────────────────────────────

export async function listReturns(companyId: string): Promise<ReturnRecord[]> {
  const { data, error } = await supabase
    .from('returns').select('*').eq('company_id', companyId).order('received_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(returnFromRow);
}

export async function getReturn(id: string): Promise<ReturnRecord | null> {
  const { data, error } = await supabase.from('returns').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? returnFromRow(data) : null;
}

export async function getReturnItems(returnId: string): Promise<ReturnItem[]> {
  const { data, error } = await supabase
    .from('return_items').select('*').eq('return_id', returnId).order('line_number', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(itemFromRow);
}

/** Itens de várias devoluções de uma vez, só os campos usados para o resumo da
 *  listagem (quantidade e destinação) — evita N+1 na tela de listagem. */
export async function listItemsForReturns(returnIds: string[]): Promise<Pick<ReturnItem, 'id' | 'returnId' | 'destination' | 'destinationStatus' | 'receivedQuantity' | 'productId' | 'sku' | 'updatedAt'>[]> {
  if (returnIds.length === 0) return [];
  const { data, error } = await supabase
    .from('return_items').select('id, return_id, destination, destination_status, received_quantity, product_id, sku, updated_at').in('return_id', returnIds);
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id, returnId: row.return_id, destination: row.destination, destinationStatus: row.destination_status,
    receivedQuantity: Number(row.received_quantity), productId: row.product_id, sku: row.sku, updatedAt: row.updated_at,
  }));
}

// ── Busca por identificador (localizar antes de registrar) ──────────────────

export interface SaleMatch { id: string; saleDate: string; sku: string; productName: string; quantity: number; productId: string | null; }
export interface NfeMatch { id: string; invoiceKey: string; invoiceNumber: string | null; supplierName: string | null; issueDate: string | null; }
export interface PoMatch { id: string; poNumber: string; supplierName: string; issueDate: string | null; }
export interface ProductMatch { id: string; sku: string; ean: string | null; name: string; }

export async function searchSalesByReference(companyId: string, query: string): Promise<SaleMatch[]> {
  const term = query.trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('sales_records').select('id, sale_date, sku, product_name, quantity, product_id')
    .eq('company_id', companyId).or(`sku.ilike.%${term}%,product_name.ilike.%${term}%`)
    .order('sale_date', { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, saleDate: r.sale_date, sku: r.sku, productName: r.product_name, quantity: Number(r.quantity), productId: r.product_id }));
}

export async function searchNfeByReference(companyId: string, query: string): Promise<NfeMatch[]> {
  const term = query.trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('nfe_invoices').select('id, invoice_key, invoice_number, supplier_name, issue_date')
    .eq('company_id', companyId).or(`invoice_key.ilike.%${term}%,invoice_number.ilike.%${term}%`)
    .order('issue_date', { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, invoiceKey: r.invoice_key, invoiceNumber: r.invoice_number, supplierName: r.supplier_name, issueDate: r.issue_date }));
}

export async function searchPurchaseOrderByReference(companyId: string, query: string): Promise<PoMatch[]> {
  const term = query.trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('purchase_orders').select('id, po_number, supplier_name, issue_date')
    .eq('company_id', companyId).ilike('po_number', `%${term}%`)
    .order('issue_date', { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, poNumber: r.po_number, supplierName: r.supplier_name, issueDate: r.issue_date }));
}

export async function searchProductByReference(companyId: string, query: string, kind: 'sku' | 'barcode'): Promise<ProductMatch[]> {
  const term = query.trim();
  if (!term) return [];
  const column = kind === 'sku' ? 'sku' : 'ean';
  const { data, error } = await supabase
    .from('products').select('id, sku, ean, name')
    .eq('company_id', companyId).ilike(column, `%${term}%`).limit(10);
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, sku: r.sku, ean: r.ean, name: r.name }));
}

// ── Registro da devolução ─────────────────────────────────────────────────────

export interface NewReturnInput {
  companyId: string;
  sourceType: ReturnSourceType;
  referenceValue: string | null;
  linkedSaleId?: string | null;
  linkedNfeInvoiceId?: string | null;
  linkedPurchaseOrderId?: string | null;
  unresolved: boolean;
  customerName: string | null;
  origin: string | null;
  originChannelConnectionId?: string | null;
  originSource?: OriginChannelSource | null;
  reason: string | null;
  expectedQuantity: number | null;
  receivedAt?: string;
  notes: string | null;
}

export async function createReturn(input: NewReturnInput, userId: string, userEmail: string): Promise<ReturnRecord> {
  const { data, error } = await supabase
    .from('returns')
    .insert({
      company_id: input.companyId, source_type: input.sourceType, reference_value: input.referenceValue,
      linked_sale_id: input.linkedSaleId ?? null, linked_nfe_invoice_id: input.linkedNfeInvoiceId ?? null,
      linked_purchase_order_id: input.linkedPurchaseOrderId ?? null, unresolved: input.unresolved,
      customer_name: input.customerName, origin: input.origin,
      // Só inclui as colunas se houver valor real: undefined não vira chave no
      // JSON enviado, então uma devolução sem canal resolvido segue funcionando
      // mesmo antes da migration 090 (aditiva) ser aplicada — ver CLAUDE.md.
      origin_channel_connection_id: input.originChannelConnectionId ?? undefined,
      origin_source: input.originSource ?? undefined,
      reason: input.reason,
      expected_quantity: input.expectedQuantity, received_at: input.receivedAt ?? new Date().toISOString(),
      received_by: userId, notes: input.notes, created_by: userId,
    })
    .select().single();
  if (error || !data) throw error ?? new Error('Falha ao registrar a devolução.');
  const record = returnFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.received',
    resourceType: 'returns', resourceId: record.id, metadata: { code: record.code, sourceType: record.sourceType, unresolved: record.unresolved },
  });
  return record;
}

export interface NewReturnItemInput {
  returnId: string; companyId: string; lineNumber: number; productId: string | null;
  sku: string | null; ean: string | null; description: string;
  expectedQuantity: number | null; receivedQuantity: number;
  lotNumber: string | null; serialNumber: string | null;
  originalPackaging: boolean | null; accessoriesReceived: string | null; itemNotes: string | null;
}

export async function addReturnItem(input: NewReturnItemInput, userId: string, userEmail: string): Promise<ReturnItem> {
  const { data, error } = await supabase
    .from('return_items')
    .insert({
      return_id: input.returnId, company_id: input.companyId, line_number: input.lineNumber, product_id: input.productId,
      sku: input.sku, ean: input.ean, description: input.description, expected_quantity: input.expectedQuantity,
      received_quantity: input.receivedQuantity, lot_number: input.lotNumber, serial_number: input.serialNumber,
      original_packaging: input.originalPackaging, accessories_received: input.accessoriesReceived, item_notes: input.itemNotes,
    })
    .select().single();
  if (error || !data) throw error ?? new Error('Falha ao adicionar o item da devolução.');
  const item = itemFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.item_registered',
    resourceType: 'returns', resourceId: input.returnId, metadata: { itemId: item.id, sku: item.sku, receivedQuantity: item.receivedQuantity },
  });
  return item;
}

export interface NfeXmlReturnItemInput {
  productId: string | null; sku: string | null; ean: string | null; description: string;
  declaredQuantity: number | null; receivedQuantity: number; lotNumber: string | null; serialNumber: string | null;
}

export interface NfeXmlReturnInput {
  invoiceKey: string; xmlHash: string; rawXml: string; originalNfeInvoiceId: string | null;
  customerName: string | null; origin: string | null;
  originChannelConnectionId?: string | null;
  originSource?: OriginChannelSource | null;
  reason: string | null;
  items: NfeXmlReturnItemInput[];
}

/** Cria a devolução + itens a partir de um XML de NF-e já lido e resolvido no
 *  cliente (parseNfeXml + resolveAssociation, só para prefill/UX) — a RPC é a
 *  autoridade: revalida chave, duplicidade e quantidades antes de gravar. */
export async function createReturnFromNfeXml(input: NfeXmlReturnInput): Promise<ReturnRecord> {
  const { data, error } = await supabase.rpc('returns_create_from_nfe_xml', {
    p_invoice_key: input.invoiceKey, p_xml_hash: input.xmlHash, p_raw_xml: input.rawXml,
    p_original_nfe_invoice_id: input.originalNfeInvoiceId, p_customer_name: input.customerName,
    p_origin: input.origin, p_reason: input.reason,
    // Só inclui os parâmetros novos quando há valor real: undefined não vira
    // chave no corpo enviado, então a RPC atual (sem os parâmetros da migration
    // 090) continua respondendo normalmente para devoluções sem canal resolvido.
    p_origin_channel_connection_id: input.originChannelConnectionId ?? undefined,
    p_origin_source: input.originSource ?? undefined,
    p_items: input.items.map(i => ({
      productId: i.productId, sku: i.sku, ean: i.ean, description: i.description,
      declaredQuantity: i.declaredQuantity, receivedQuantity: i.receivedQuantity,
      lotNumber: i.lotNumber, serialNumber: i.serialNumber,
    })),
  });
  if (error) throw error;
  return returnFromRow(data as ReturnRow);
}

export interface ReturnItemConferenceInput {
  receivedQuantity?: number; lotNumber?: string | null; serialNumber?: string | null;
  originalPackaging?: boolean | null; accessoriesReceived?: string | null; itemNotes?: string | null;
}

export async function updateReturnItemConference(itemId: string, patch: ReturnItemConferenceInput): Promise<ReturnItem> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.receivedQuantity !== undefined) payload.received_quantity = patch.receivedQuantity;
  if (patch.lotNumber !== undefined) payload.lot_number = patch.lotNumber;
  if (patch.serialNumber !== undefined) payload.serial_number = patch.serialNumber;
  if (patch.originalPackaging !== undefined) payload.original_packaging = patch.originalPackaging;
  if (patch.accessoriesReceived !== undefined) payload.accessories_received = patch.accessoriesReceived;
  if (patch.itemNotes !== undefined) payload.item_notes = patch.itemNotes;

  const { data, error } = await supabase.from('return_items').update(payload).eq('id', itemId).select().single();
  if (error || !data) throw error ?? new Error('Falha ao atualizar a conferência do item.');
  return itemFromRow(data);
}

// ── Transições de estado e decisões (RPC) ─────────────────────────────────────

export async function transitionReturnStatus(returnId: string, toStatus: ReturnStatus, reason: string | null): Promise<ReturnRecord> {
  const { data, error } = await supabase.rpc('returns_transition_status', {
    p_return_id: returnId, p_to_status: toStatus, p_reason: reason,
  });
  if (error) throw error;
  return returnFromRow(data as ReturnRow);
}

export interface InspectionChecklistInput {
  correctProduct: boolean; packagingIntact: boolean; noVisibleDamage: boolean; apparentlyFunctional: boolean;
  accessoriesComplete: boolean; signsOfUse: boolean; serialMatches: boolean;
}

export async function setItemInspection(
  itemId: string, checklist: InspectionChecklistInput, classification: ReturnClassification, reason: string | null,
  conditionGradeId: string | null = null
): Promise<ReturnItem> {
  const { data, error } = await supabase.rpc('return_items_set_inspection', {
    p_item_id: itemId,
    p_checklist_correct_product: checklist.correctProduct,
    p_checklist_packaging_intact: checklist.packagingIntact,
    p_checklist_no_visible_damage: checklist.noVisibleDamage,
    p_checklist_apparently_functional: checklist.apparentlyFunctional,
    p_checklist_accessories_complete: checklist.accessoriesComplete,
    p_checklist_signs_of_use: checklist.signsOfUse,
    p_checklist_serial_matches: checklist.serialMatches,
    p_classification: classification,
    p_reason: reason,
    p_condition_grade_id: conditionGradeId,
  });
  if (error) throw error;
  return itemFromRow(data as ReturnItemRow);
}

export async function decideItemDestination(
  itemId: string, destination: ReturnDestination, reason: string | null,
  erpSync?: { connectionId: string } | null
): Promise<ReturnItem> {
  const { data, error } = await supabase.rpc('return_items_decide_destination', {
    p_item_id: itemId, p_destination: destination, p_reason: reason,
    p_sync_to_erp: !!erpSync, p_connection_id: erpSync?.connectionId ?? null,
  });
  if (error) throw error;
  const item = itemFromRow(data as ReturnItemRow);

  // A destinação interna já está concluída neste ponto — o disparo abaixo só
  // "acorda agora" o processamento assíncrono (a Edge Function já faz isso hoje
  // pelo botão manual da fila). Uma falha aqui não deve derrubar a confirmação
  // da destinação: o lançamento já existe como 'pending' e será pego na próxima
  // tentativa manual ou execução da fila.
  if (erpSync && item.erpSyncAdjustmentId) {
    try {
      const { runStockWrite } = await import('../integrations/integrationOperations');
      await runStockWrite(erpSync.connectionId, { adjustmentIds: [item.erpSyncAdjustmentId] });
    } catch (err) {
      console.error('[ReverseLogistics] runStockWrite (fire-and-forget)', err);
    }
  }

  return item;
}

/** Contexto de vínculo com o Tiny para um produto, exibido antes de confirmar a
 *  destinação "Retornar ao estoque vendável" — reaproveita integration_entity_links
 *  (já existente) em vez de uma tabela de mapeamento nova. */
export interface ReturnErpContext {
  connectionId: string;
  connectionDisplayName: string;
  productLinked: boolean;
  externalProductName: string | null;
  externalSku: string | null;
  warehouseLinked: boolean;
  externalWarehouseName: string | null;
}

export async function getReturnErpContext(companyId: string, productId: string | null): Promise<ReturnErpContext | null> {
  const { data: connection, error: connError } = await supabase
    .from('integration_connections').select('id, display_name')
    .eq('company_id', companyId).eq('provider_key', 'tiny').eq('status', 'active')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (connError) { console.error('[ReverseLogistics] getReturnErpContext', connError.message); return null; }
  if (!connection) return null;

  const [{ data: productLink }, { data: warehouseLink }] = await Promise.all([
    productId
      ? supabase.from('integration_entity_links').select('external_name, external_sku')
          .eq('connection_id', connection.id).eq('entity_type', 'product').eq('internal_id', productId).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('integration_entity_links').select('external_name')
      .eq('connection_id', connection.id).eq('entity_type', 'warehouse').order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);

  return {
    connectionId: connection.id, connectionDisplayName: connection.display_name,
    productLinked: !!productLink, externalProductName: productLink?.external_name ?? null, externalSku: productLink?.external_sku ?? null,
    warehouseLinked: !!warehouseLink, externalWarehouseName: warehouseLink?.external_name ?? null,
  };
}

export interface ErpSyncStatus {
  connectionId: string;
  syncStatus: 'pending' | 'sent' | 'confirmed' | 'failed' | 'skipped';
  attempts: number;
  errorMessage: string | null;
}

/** Estado atual de um lançamento de sincronização já criado — lido direto de
 *  integration_stock_adjustments (mesma tabela que alimenta a fila em
 *  IntegrationsPage.tsx), sem duplicar status em return_items. */
export async function getErpSyncStatus(adjustmentId: string): Promise<ErpSyncStatus | null> {
  const { data, error } = await supabase
    .from('integration_stock_adjustments').select('connection_id, sync_status, attempts, error_message')
    .eq('id', adjustmentId).maybeSingle();
  if (error) { console.error('[ReverseLogistics] getErpSyncStatus', error.message); return null; }
  if (!data) return null;
  return { connectionId: data.connection_id, syncStatus: data.sync_status, attempts: data.attempts, errorMessage: data.error_message };
}

// ── Histórico auditável ────────────────────────────────────────────────────────

export async function listAuditEventsForReturn(companyId: string, returnId: string): Promise<ReturnAuditEvent[]> {
  const { data, error } = await supabase
    .from('audit_logs').select('id, action, user_email, created_at, metadata')
    .eq('company_id', companyId).eq('resource_type', 'returns').eq('resource_id', returnId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, action: r.action, userEmail: r.user_email, createdAt: r.created_at, metadata: r.metadata ?? {} }));
}

// ── Anexos (Storage privado, mesmo padrão de rcaService.uploadEvidence) ──────

export async function uploadReturnAttachments(
  returnId: string, returnItemId: string | null, companyId: string, files: File[], userId: string
): Promise<ReturnAttachment[]> {
  const uploaded: ReturnAttachment[] = [];
  for (const file of files) {
    if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) { console.error('[ReverseLogistics] Rejected attachment: invalid type', file.type); continue; }
    if (file.size > ATTACHMENT_MAX_SIZE_BYTES) { console.error('[ReverseLogistics] Rejected attachment: too large', file.size); continue; }

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${companyId}/${returnId}-${Date.now()}-${uploaded.length}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file);
    if (uploadError) { console.error('[ReverseLogistics] Error uploading attachment:', uploadError); continue; }

    const { data, error } = await supabase
      .from('return_attachments')
      .insert({ return_id: returnId, return_item_id: returnItemId, company_id: companyId, file_path: path, file_name: file.name, uploaded_by: userId })
      .select().maybeSingle();
    if (error || !data) { console.error('[ReverseLogistics] Error saving attachment row:', error); continue; }
    uploaded.push(attachmentFromRow(data));
  }
  return uploaded;
}

export async function listReturnAttachments(returnId: string): Promise<ReturnAttachment[]> {
  const { data, error } = await supabase.from('return_attachments').select('*').eq('return_id', returnId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(attachmentFromRow);
}

export async function getReturnAttachmentSignedUrl(filePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(filePath, 3600);
  if (error) { console.error('[ReverseLogistics] Error creating attachment signed URL:', error); return null; }
  return data.signedUrl;
}

// ── Nomes de responsáveis (mirror de fetchProfileNames em lib/tasks/taskService.ts) ──

export async function fetchReturnUserNames(userIds: (string | null)[]): Promise<Map<string, { name: string | null; email: string | null }>> {
  const unique = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, name, email').in('id', unique);
  if (error) { console.error('[ReverseLogistics] fetchReturnUserNames', error.message); return new Map(); }
  return new Map((data ?? []).map(p => [p.id, { name: p.name, email: p.email }]));
}

/** Preço unitário dos produtos citados, para calcular o valor de um item (`price ×
 *  quantidade`) antes de decidir a destinação — é o dado que falta para o gate de
 *  aprovação de "alto valor" (Fase 2) avaliar corretamente no cliente. */
export async function fetchProductPrices(productIds: (string | null)[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(productIds.filter((id): id is string => !!id)));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('products').select('id, price').in('id', unique);
  if (error) { console.error('[ReverseLogistics] fetchProductPrices', error.message); return new Map(); }
  return new Map((data ?? []).filter(p => p.price != null).map(p => [p.id, Number(p.price)]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Fase 2 — checklists configuráveis, grades, sugestão de destinação, aprovações,
// assistência técnica/recondicionamento, quarentena, operação em lote.
// ═══════════════════════════════════════════════════════════════════════════

function templateFromRow(row: {
  id: string; company_id: string; name: string; active: boolean; category: string | null;
  product_id: string | null; reason: string | null; min_value: number | string | null; max_value: number | string | null;
  inspection_type: string | null; version: number; created_at: string; updated_at: string;
}): ChecklistTemplate {
  return {
    id: row.id, companyId: row.company_id, name: row.name, active: row.active, category: row.category,
    productId: row.product_id, reason: row.reason,
    minValue: row.min_value !== null ? Number(row.min_value) : null, maxValue: row.max_value !== null ? Number(row.max_value) : null,
    inspectionType: row.inspection_type, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listChecklistTemplates(companyId: string): Promise<ChecklistTemplate[]> {
  const { data, error } = await supabase.from('return_checklist_templates').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(templateFromRow);
}

export interface NewChecklistTemplateInput {
  companyId: string; name: string; category: string | null; productId: string | null; reason: string | null;
  minValue: number | null; maxValue: number | null; inspectionType: string | null;
  items: { orderIndex: number; label: string; responseType: ChecklistResponseType; options: string[] | null; required: boolean }[];
}

/** Cria um template novo. Editar um template já usado por alguma inspeção deve criar uma nova
 *  linha com version+1 (nunca UPDATE nos campos de pergunta de um template referenciado) — a
 *  chamada aqui sempre insere; o "versionamento" é o caller decidir criar uma nova linha com o
 *  mesmo name e version = anterior + 1. */
export async function createChecklistTemplate(input: NewChecklistTemplateInput, userId: string, userEmail: string, version = 1): Promise<ChecklistTemplate> {
  const { data, error } = await supabase.from('return_checklist_templates').insert({
    company_id: input.companyId, name: input.name, category: input.category, product_id: input.productId,
    reason: input.reason, min_value: input.minValue, max_value: input.maxValue, inspection_type: input.inspectionType,
    version, created_by: userId,
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao criar o template de checklist.');
  const template = templateFromRow(data);

  if (input.items.length > 0) {
    const { error: itemsError } = await supabase.from('return_checklist_template_items').insert(
      input.items.map(item => ({
        template_id: template.id, company_id: input.companyId, order_index: item.orderIndex,
        label: item.label, response_type: item.responseType, options: item.options, required: item.required,
      }))
    );
    if (itemsError) throw itemsError;
  }

  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.checklist_template_created',
    resourceType: 'return_checklist_templates', resourceId: template.id, metadata: { name: template.name, version },
  });
  return template;
}

export async function listChecklistTemplateItems(templateId: string): Promise<ChecklistTemplateItem[]> {
  const { data, error } = await supabase.from('return_checklist_template_items').select('*').eq('template_id', templateId).order('order_index', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id, templateId: row.template_id, orderIndex: row.order_index, label: row.label,
    responseType: row.response_type, options: row.options, required: row.required,
  }));
}

function conditionGradeFromRow(row: {
  id: string; company_id: string; code: string; label: string; description: string | null;
  criteria: string[] | null; sort_order: number; active: boolean;
}): ConditionGrade {
  return {
    id: row.id, companyId: row.company_id, code: row.code, label: row.label, description: row.description,
    criteria: row.criteria, sortOrder: row.sort_order, active: row.active,
  };
}

export async function listConditionGrades(companyId: string): Promise<ConditionGrade[]> {
  const { data, error } = await supabase.from('return_condition_grades').select('*').eq('company_id', companyId).order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(conditionGradeFromRow);
}

export async function createConditionGrade(
  input: { companyId: string; code: string; label: string; description: string | null; criteria: string[]; sortOrder: number },
  userId: string, userEmail: string
): Promise<ConditionGrade> {
  const { data, error } = await supabase.from('return_condition_grades').insert({
    company_id: input.companyId, code: input.code, label: input.label, description: input.description,
    criteria: input.criteria, sort_order: input.sortOrder, created_by: userId,
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao criar a grade de condição.');
  const grade = conditionGradeFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.condition_grade_created',
    resourceType: 'return_condition_grades', resourceId: grade.id, metadata: { code: grade.code },
  });
  return grade;
}

function destinationRuleFromRow(row: {
  id: string; company_id: string; priority: number; active: boolean; condition_grade_id: string | null;
  category: string | null; reason: string | null; min_value: number | string | null; max_value: number | string | null;
  requires_warranty: boolean | null; requires_accessories: boolean | null; defect_reported: string | null;
  suggested_destination: ReturnDestination;
}): DestinationRule {
  return {
    id: row.id, companyId: row.company_id, priority: row.priority, active: row.active,
    conditionGradeId: row.condition_grade_id, category: row.category, reason: row.reason,
    minValue: row.min_value !== null ? Number(row.min_value) : null, maxValue: row.max_value !== null ? Number(row.max_value) : null,
    requiresWarranty: row.requires_warranty, requiresAccessories: row.requires_accessories,
    defectReported: row.defect_reported, suggestedDestination: row.suggested_destination,
  };
}

export async function listDestinationRules(companyId: string): Promise<DestinationRule[]> {
  const { data, error } = await supabase.from('return_destination_rules').select('*').eq('company_id', companyId).order('priority', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(destinationRuleFromRow);
}

export async function createDestinationRule(
  input: Omit<DestinationRule, 'id' | 'companyId'> & { companyId: string }, userId: string, userEmail: string
): Promise<DestinationRule> {
  const { data, error } = await supabase.from('return_destination_rules').insert({
    company_id: input.companyId, priority: input.priority, active: input.active,
    condition_grade_id: input.conditionGradeId, category: input.category, reason: input.reason,
    min_value: input.minValue, max_value: input.maxValue, requires_warranty: input.requiresWarranty,
    requires_accessories: input.requiresAccessories, defect_reported: input.defectReported,
    suggested_destination: input.suggestedDestination, created_by: userId,
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao criar a regra de sugestão de destinação.');
  const rule = destinationRuleFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.destination_rule_created',
    resourceType: 'return_destination_rules', resourceId: rule.id, metadata: { suggestedDestination: rule.suggestedDestination },
  });
  return rule;
}

/** Grava a sugestão calculada no cliente — não é uma decisão, só rastro para exibir "sugestão
 *  vs decisão final" na UI. Update comum sob a policy já existente de return_items. */
export async function recordSuggestedDestination(itemId: string, destination: ReturnDestination | null, ruleId: string | null): Promise<void> {
  const { error } = await supabase.from('return_items').update({
    suggested_destination: destination, suggested_destination_rule_id: ruleId, updated_at: new Date().toISOString(),
  }).eq('id', itemId);
  if (error) throw error;
}

function approvalSettingsFromRow(row: {
  company_id: string; require_approval_discard: boolean; require_approval_restock: boolean;
  high_value_threshold: number | string | null; require_approval_high_value: boolean;
  require_approval_serial_mismatch: boolean; require_approval_checklist_exception: boolean;
  require_approval_destination_change: boolean;
}): ApprovalSettings {
  return {
    companyId: row.company_id, requireApprovalDiscard: row.require_approval_discard,
    requireApprovalRestock: row.require_approval_restock,
    highValueThreshold: row.high_value_threshold !== null ? Number(row.high_value_threshold) : null,
    requireApprovalHighValue: row.require_approval_high_value,
    requireApprovalSerialMismatch: row.require_approval_serial_mismatch,
    requireApprovalChecklistException: row.require_approval_checklist_exception,
    requireApprovalDestinationChange: row.require_approval_destination_change,
  };
}

export async function getApprovalSettings(companyId: string): Promise<ApprovalSettings | null> {
  const { data, error } = await supabase.from('return_approval_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data ? approvalSettingsFromRow(data) : null;
}

export async function upsertApprovalSettings(settings: ApprovalSettings, userId: string): Promise<ApprovalSettings> {
  const { data, error } = await supabase.from('return_approval_settings').upsert({
    company_id: settings.companyId, require_approval_discard: settings.requireApprovalDiscard,
    require_approval_restock: settings.requireApprovalRestock, high_value_threshold: settings.highValueThreshold,
    require_approval_high_value: settings.requireApprovalHighValue,
    require_approval_serial_mismatch: settings.requireApprovalSerialMismatch,
    require_approval_checklist_exception: settings.requireApprovalChecklistException,
    require_approval_destination_change: settings.requireApprovalDestinationChange,
    updated_by: userId, updated_at: new Date().toISOString(),
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao salvar as configurações de aprovação.');
  return approvalSettingsFromRow(data);
}

function approvalRequestFromRow(row: {
  id: string; company_id: string; return_item_id: string; approval_type: ApprovalType;
  status: 'pending' | 'approved' | 'rejected'; requested_by: string | null; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_reason: string | null; notes: string | null;
}): ApprovalRequest {
  return {
    id: row.id, companyId: row.company_id, returnItemId: row.return_item_id, approvalType: row.approval_type,
    status: row.status, requestedBy: row.requested_by, requestedAt: row.requested_at,
    decidedBy: row.decided_by, decidedAt: row.decided_at, decisionReason: row.decision_reason, notes: row.notes,
  };
}

export async function listApprovalRequestsForCompany(companyId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase.from('return_approval_requests').select('*').eq('company_id', companyId).order('requested_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(approvalRequestFromRow);
}

export async function listApprovalRequestsForItem(itemId: string): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase.from('return_approval_requests').select('*').eq('return_item_id', itemId).order('requested_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(approvalRequestFromRow);
}

export async function requestItemApproval(itemId: string, approvalType: ApprovalType, notes: string | null): Promise<ApprovalRequest> {
  const { data, error } = await supabase.rpc('return_items_request_approval', { p_item_id: itemId, p_approval_type: approvalType, p_notes: notes });
  if (error) throw error;
  return approvalRequestFromRow(data);
}

export async function decideItemApproval(requestId: string, approved: boolean, reason: string | null): Promise<ApprovalRequest> {
  const { data, error } = await supabase.rpc('return_items_decide_approval', { p_request_id: requestId, p_approved: approved, p_reason: reason });
  if (error) throw error;
  return approvalRequestFromRow(data);
}

function serviceOrderFromRow(row: {
  id: string; company_id: string; return_item_id: string; service_type: ServiceOrderType;
  responsible: string | null; location_internal: string | null; external_provider: string | null;
  defect_identified: string | null; parts_services_expected: string | null; estimated_cost: number | string | null;
  deadline: string | null; status: ServiceOrderStatus; result_notes: string | null;
  created_at: string; updated_at: string;
}): ServiceOrder {
  return {
    id: row.id, companyId: row.company_id, returnItemId: row.return_item_id, serviceType: row.service_type,
    responsible: row.responsible, locationInternal: row.location_internal, externalProvider: row.external_provider,
    defectIdentified: row.defect_identified, partsServicesExpected: row.parts_services_expected,
    estimatedCost: row.estimated_cost !== null ? Number(row.estimated_cost) : null, deadline: row.deadline,
    status: row.status, resultNotes: row.result_notes, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listServiceOrdersForCompany(companyId: string): Promise<ServiceOrder[]> {
  const { data, error } = await supabase.from('return_service_orders').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(serviceOrderFromRow);
}

export async function listServiceOrdersForItem(itemId: string): Promise<ServiceOrder[]> {
  const { data, error } = await supabase.from('return_service_orders').select('*').eq('return_item_id', itemId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(serviceOrderFromRow);
}

export interface NewServiceOrderInput {
  companyId: string; returnItemId: string; serviceType: ServiceOrderType; responsible: string | null;
  locationInternal: string | null; externalProvider: string | null; defectIdentified: string | null;
  partsServicesExpected: string | null; estimatedCost: number | null; deadline: string | null;
}

export async function createServiceOrder(input: NewServiceOrderInput, userId: string, userEmail: string): Promise<ServiceOrder> {
  const { data, error } = await supabase.from('return_service_orders').insert({
    company_id: input.companyId, return_item_id: input.returnItemId, service_type: input.serviceType,
    responsible: input.responsible, location_internal: input.locationInternal, external_provider: input.externalProvider,
    defect_identified: input.defectIdentified, parts_services_expected: input.partsServicesExpected,
    estimated_cost: input.estimatedCost, deadline: input.deadline, created_by: userId,
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao criar a ordem de assistência/recondicionamento.');
  const order = serviceOrderFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.service_order_created',
    resourceType: 'return_items', resourceId: input.returnItemId, metadata: { orderId: order.id, serviceType: order.serviceType },
  });
  return order;
}

export async function transitionServiceOrderStatus(orderId: string, toStatus: ServiceOrderStatus, reason: string | null): Promise<ServiceOrder> {
  const { data, error } = await supabase.rpc('return_service_orders_transition_status', { p_order_id: orderId, p_to_status: toStatus, p_reason: reason });
  if (error) throw error;
  return serviceOrderFromRow(data);
}

function quarantineHoldFromRow(row: {
  id: string; company_id: string; return_item_id: string; location: string | null; block_reason: string;
  responsible: string | null; review_deadline: string | null; pending_notes: string | null;
  released_at: string | null; released_by: string | null; released_reason: string | null; created_at: string;
}): QuarantineHold {
  return {
    id: row.id, companyId: row.company_id, returnItemId: row.return_item_id, location: row.location,
    blockReason: row.block_reason, responsible: row.responsible, reviewDeadline: row.review_deadline,
    pendingNotes: row.pending_notes, releasedAt: row.released_at, releasedBy: row.released_by,
    releasedReason: row.released_reason, createdAt: row.created_at,
  };
}

export async function listQuarantineHoldsForCompany(companyId: string): Promise<QuarantineHold[]> {
  const { data, error } = await supabase.from('return_quarantine_holds').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(quarantineHoldFromRow);
}

export async function listQuarantineHoldsForItem(itemId: string): Promise<QuarantineHold[]> {
  const { data, error } = await supabase.from('return_quarantine_holds').select('*').eq('return_item_id', itemId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(quarantineHoldFromRow);
}

export interface NewQuarantineHoldInput {
  companyId: string; returnItemId: string; location: string | null; blockReason: string;
  responsible: string | null; reviewDeadline: string | null; pendingNotes: string | null;
}

export async function createQuarantineHold(input: NewQuarantineHoldInput, userId: string, userEmail: string): Promise<QuarantineHold> {
  const { data, error } = await supabase.from('return_quarantine_holds').insert({
    company_id: input.companyId, return_item_id: input.returnItemId, location: input.location,
    block_reason: input.blockReason, responsible: input.responsible, review_deadline: input.reviewDeadline,
    pending_notes: input.pendingNotes, created_by: userId,
  }).select().single();
  if (error || !data) throw error ?? new Error('Falha ao registrar o bloqueio de quarentena.');
  const hold = quarantineHoldFromRow(data);
  await logAuditEvent({
    companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.quarantine_hold_created',
    resourceType: 'return_items', resourceId: input.returnItemId, metadata: { holdId: hold.id },
  });
  return hold;
}

export async function releaseQuarantineHold(holdId: string, reason: string): Promise<QuarantineHold> {
  const { data, error } = await supabase.rpc('return_items_release_quarantine', { p_hold_id: holdId, p_reason: reason });
  if (error) throw error;
  return quarantineHoldFromRow(data);
}

export type BatchAction = 'assign_responsible' | 'move_to_conference' | 'apply_checklist' | 'send_to_quarantine';

export async function batchApplyToItems(itemIds: string[], action: BatchAction, params: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase.rpc('return_items_batch_apply', { p_item_ids: itemIds, p_action: action, p_params: params });
  if (error) throw error;
  return data as number;
}
