// Types for the Physical Count Engine — mirrors the row shape of
// physical_count_sessions/physical_count_items (see the 039 migration),
// same camelCase-domain-type-over-snake_case-row convention as nfeTypes.ts.

export type PhysicalCountSessionStatus = 'draft' | 'in_progress' | 'completed' | 'with_divergences';
export type CountNumber = 1 | 2 | 3;
export type CountMode = 'increment' | 'set';
export type CountSource = 'scanner' | 'manual';
export type ItemResultStatus = 'ok' | 'missing' | 'surplus';

export interface PhysicalCountSession {
  id: string;
  companyId: string;
  rootSessionId: string;
  linkedSessionId: string | null;
  countNumber: CountNumber;
  warehouse: string | null;
  area: string | null;
  streetFrom: string;
  streetTo: string;
  responsibleId: string | null;
  observation: string | null;
  status: PhysicalCountSessionStatus;
  totalItems: number;
  approvedBy: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  startedBy: string | null;
  finishedAt: string | null;
  finishedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalCountItem {
  id: string;
  sessionId: string;
  companyId: string;
  productId: string;
  sku: string | null;
  ean: string | null;
  location: string | null;
  erpQuantitySnapshot: number | null;
  erpSource: string;
  erpSyncRef: string | null;
  /** Quantidade encontrada no local esperado (`location`) — nunca inclui o excedente de foundLocation. */
  physicalQuantity: number | null;
  /** Encontrado fisicamente num local diferente do esperado (ver locationAddressing.ts) — nunca sobrescreve `location`. */
  foundLocation: string | null;
  /** Quantidade encontrada em foundLocation. Reconciliação contra o ERP usa physicalQuantity + este valor. */
  foundElsewhereQuantity: number;
  resultStatus: ItemResultStatus | null;
  snapshotProductName: string | null;
  snapshotSku: string | null;
  snapshotEan: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalCountCandidateProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
  stockQuantity: number;
  /**
   * Best-effort — vem do rastro histórico de inventory_count_import_items
   * (produto→marca só existe onde o SKU já apareceu numa importação de
   * contagem manual marcada com uma marca). null = sem marca conhecida,
   * nunca um chute. Ver physicalCountService.ts::getBrandByProductId.
   */
  brand: string | null;
}

export interface PhysicalCountFinalResultRow {
  rootSessionId: string;
  companyId: string;
  productId: string;
  sku: string | null;
  ean: string | null;
  location: string | null;
  erpQuantitySnapshot: number | null;
  count1: number | null;
  count2: number | null;
  count3: number | null;
  anyRoundApproved: boolean;
}

export interface ErpSyncItemResult {
  itemId: string;
  productId: string;
  sku: string | null;
  success: boolean;
  pending: boolean;
  errorMessage: string | null;
}

export interface ErpSyncReport {
  attempted: number;
  succeeded: number;
  pending: number;
  failed: number;
  results: ErpSyncItemResult[];
}
