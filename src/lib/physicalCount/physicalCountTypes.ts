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
  /** Exclusão lógica (migration 059): preenchido, a sessão sai do histórico
   *  visível e deixa de aceitar qualquer operação. Nada é apagado — itens,
   *  eventos e recontagens continuam gravados. */
  deletedAt: string | null;
  deletedBy: string | null;
  deletionReason: string | null;
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

// ── Recontagem automática por limite de divergência (migration 049) ──────────

/** Uma avaliação automática registrada no fecho de uma contagem.
 *
 *  Guarda a regra aplicada (`thresholdType`/`thresholdValue`) congelada junto do
 *  valor medido, então a linha se explica sozinha mesmo depois de alguém mudar a
 *  configuração. `measuredValue` é o número que o SQL calculou — a UI mostra este,
 *  nunca um recálculo, para não haver dois números para o mesmo fato. */
export interface RecountEvent {
  id: string;
  companyId: string;
  sourceSessionId: string;
  /** null quando foi ignorado ou falhou. */
  recountSessionId: string | null;
  status: 'created' | 'skipped' | 'failed';
  /** Código estável para skipped (below_threshold, max_rounds_reached,
   *  no_divergent_items) ou mensagem do banco para failed. */
  reason: string | null;
  thresholdType: string;
  thresholdValue: number;
  measuredValue: number;
  countedItems: number;
  divergentItems: number;
  absoluteUnitDeviation: number;
  recipientId: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}
