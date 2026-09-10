// Ordens de Compra — tipos de domínio. camelCase no domínio, snake_case na linha
// do banco, mesmo padrão de physicalCountTypes.ts/nfeTypes.ts.

export type PurchaseOrderStatus = 'draft' | 'open' | 'closed' | 'closed_with_differences' | 'cancelled';
export type PoImportOrigin = 'tiny' | 'bling' | 'totvs' | 'sap' | 'custom';
export type PoMatchType = 'code' | 'ean';
export type PoAllocationMatchMethod = 'product_id' | 'code' | 'ean' | 'learned' | 'manual';
export type PoAllocationSource = 'auto' | 'manual';

export interface PurchaseOrder {
  id: string;
  companyId: string;
  poNumber: string;
  origin: string;
  supplierName: string;
  supplierCnpj: string | null;
  issueDate: string | null;
  notes: string | null;
  status: PurchaseOrderStatus;
  closedReason: string | null;
  closedBy: string | null;
  closedAt: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  importBatchId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  companyId: string;
  lineNumber: number;
  originCode: string | null;
  productId: string | null;
  ean: string | null;
  eanNormalized: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoImportProfile {
  id: string;
  companyId: string;
  origin: PoImportOrigin;
  name: string;
  columnMapping: PoColumnMapping;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoImportBatch {
  id: string;
  companyId: string;
  origin: string;
  profileId: string | null;
  fileName: string;
  fileHash: string;
  rowCount: number;
  status: 'completed' | 'failed';
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PoNfeLink {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  invoiceId: string;
  linkedBy: string | null;
  linkedAt: string;
  unlinkedAt: string | null;
  unlinkedBy: string | null;
  unlinkReason: string | null;
  reconciliationStatus: 'pending' | 'ok' | 'failed';
  reconciledAt: string | null;
  reconciliationError: string | null;
}

export interface PoDetoPara {
  id: string;
  companyId: string;
  supplierKey: string;
  origin: string;
  matchType: PoMatchType;
  matchValue: string;
  productId: string;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PoAllocation {
  id: string;
  companyId: string;
  poLinkId: string;
  poItemId: string;
  nfeItemId: string;
  allocatedQuantity: number;
  matchMethod: PoAllocationMatchMethod;
  source: PoAllocationSource;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Importação (mapeamento de colunas) ──────────────────────────────────────

export interface PoColumnMapping {
  poNumber: string | null;
  supplierName: string | null;
  code: string | null;
  ean: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  total: string | null;
}

export interface PoImportRow {
  [key: string]: string | number | undefined;
}

export interface ClassifiedPoImportRow {
  lineNumber: number;
  poNumber: string;
  originCode: string | null;
  ean: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
  errors: string[];
}

export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Rascunho',
  open: 'Aberta',
  closed: 'Encerrada',
  closed_with_differences: 'Encerrada com diferenças',
  cancelled: 'Cancelada',
};

export type PoProgressStatus = 'no_invoice' | 'partial' | 'apparently_complete' | 'divergent';

export const PO_PROGRESS_LABEL: Record<PoProgressStatus, string> = {
  no_invoice: 'Sem NF-e vinculada',
  partial: 'Parcialmente faturada',
  apparently_complete: 'Aparentemente completa',
  divergent: 'Com itens ou quantidades divergentes',
};

export type PoItemComparisonStatus =
  | 'ok'
  | 'quantity_less'
  | 'quantity_greater'
  | 'price_divergent'
  | 'unit_divergent'
  | 'po_item_not_found'
  | 'awaiting_manual_link';

export const PO_ITEM_COMPARISON_LABEL: Record<PoItemComparisonStatus, string> = {
  ok: 'Confere com a OC',
  quantity_less: 'Quantidade menor que a OC',
  quantity_greater: 'Quantidade maior que a OC',
  price_divergent: 'Preço unitário divergente',
  unit_divergent: 'Unidade divergente',
  po_item_not_found: 'Item da OC não encontrado nas NF-es',
  awaiting_manual_link: 'Produto aguardando vínculo manual',
};

export interface PoItemComparison {
  poItemId: string;
  status: PoItemComparisonStatus;
  orderedQuantity: number;
  allocatedQuantity: number;
  unitPriceOrdered: number | null;
  unitPriceInvoiced: number | null;
}

export interface NfeItemComparison {
  nfeItemId: string;
  /** Item de NF-e sem nenhuma alocação vinda das OCs vinculadas — não previsto em nenhuma OC. */
  notPredictedInPos: boolean;
}
