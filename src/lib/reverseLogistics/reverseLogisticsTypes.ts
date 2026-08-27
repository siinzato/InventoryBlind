// Logística Reversa — tipos de domínio (camelCase), espelhando a migration 083.

import type { OriginChannelSource } from './originChannelResolver';

export type ReturnStatus =
  | 'received'
  | 'in_conference'
  | 'in_inspection'
  | 'awaiting_destination'
  | 'finalized'
  | 'cancelled';

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  received: 'Recebida',
  in_conference: 'Em conferência',
  in_inspection: 'Em inspeção',
  awaiting_destination: 'Aguardando destinação',
  finalized: 'Finalizada',
  cancelled: 'Cancelada',
};

export type ReturnSourceType = 'order' | 'nfe' | 'sku' | 'barcode' | 'serial' | 'tracking' | 'external_ref' | 'manual' | 'nfe_xml';

export const RETURN_SOURCE_TYPE_LABEL: Record<ReturnSourceType, string> = {
  order: 'Pedido',
  nfe: 'NF-e',
  sku: 'SKU',
  barcode: 'Código de barras',
  serial: 'Número de série',
  tracking: 'Código de rastreio',
  external_ref: 'Referência externa',
  manual: 'Recebimento avulso',
  nfe_xml: 'Chave de acesso da NF-e de devolução',
};

export type ReturnClassification =
  | 'new_sealed'
  | 'good_condition'
  | 'light_damage'
  | 'heavy_damage'
  | 'functional_defect'
  | 'incomplete'
  | 'unidentified';

export const RETURN_CLASSIFICATION_LABEL: Record<ReturnClassification, string> = {
  new_sealed: 'Novo ou lacrado',
  good_condition: 'Bom estado',
  light_damage: 'Avaria leve',
  heavy_damage: 'Avaria grave',
  functional_defect: 'Defeito funcional',
  incomplete: 'Incompleto',
  unidentified: 'Não identificado',
};

export type ReturnDestination =
  | 'restock'
  | 'quarantine'
  | 'damaged_stock'
  | 'technical_assistance'
  | 'refurbishment'
  | 'return_to_supplier'
  | 'discard';

export const RETURN_DESTINATION_LABEL: Record<ReturnDestination, string> = {
  restock: 'Retornar ao estoque vendável',
  quarantine: 'Quarentena',
  damaged_stock: 'Estoque de avariados',
  technical_assistance: 'Assistência técnica',
  refurbishment: 'Recondicionamento',
  return_to_supplier: 'Devolução ao fornecedor',
  discard: 'Descarte',
};

export type DestinationStatus = 'pending' | 'moved' | 'in_treatment';

/** Como o canal de origem foi determinado — reexportado de
 *  originChannelResolver.ts para não duplicar a definição. */
export type { OriginChannelSource } from './originChannelResolver';

export interface ReturnRecord {
  id: string;
  companyId: string;
  code: string;
  status: ReturnStatus;
  sourceType: ReturnSourceType;
  referenceValue: string | null;
  linkedSaleId: string | null;
  linkedNfeInvoiceId: string | null;
  linkedPurchaseOrderId: string | null;
  unresolved: boolean;
  customerName: string | null;
  origin: string | null;
  /** Conta de canal (integration_connections) que originou a devolução, quando
   *  resolvida — null em devoluções sem canal identificado ou anteriores a este
   *  recurso. */
  originChannelConnectionId: string | null;
  /** Como originChannelConnectionId foi determinado — null quando origin não
   *  passou pelo resolvedor de canal (ex.: devolução avulsa/manual antiga). */
  originSource: OriginChannelSource | null;
  reason: string | null;
  expectedQuantity: number | null;
  receivedAt: string;
  receivedBy: string | null;
  notes: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  cancellationReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnItem {
  id: string;
  returnId: string;
  companyId: string;
  lineNumber: number;
  productId: string | null;
  sku: string | null;
  ean: string | null;
  description: string;
  expectedQuantity: number | null;
  receivedQuantity: number;
  lotNumber: string | null;
  serialNumber: string | null;
  originalPackaging: boolean | null;
  accessoriesReceived: string | null;
  itemNotes: string | null;
  checklistCorrectProduct: boolean | null;
  checklistPackagingIntact: boolean | null;
  checklistNoVisibleDamage: boolean | null;
  checklistApparentlyFunctional: boolean | null;
  checklistAccessoriesComplete: boolean | null;
  checklistSignsOfUse: boolean | null;
  checklistSerialMatches: boolean | null;
  classification: ReturnClassification | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
  destination: ReturnDestination | null;
  destinationReason: string | null;
  destinationStatus: DestinationStatus;
  destinationDecidedBy: string | null;
  destinationDecidedAt: string | null;
  currentLocation: string;
  checklistTemplateId: string | null;
  checklistTemplateVersion: number | null;
  conditionGradeId: string | null;
  suggestedDestination: ReturnDestination | null;
  suggestedDestinationRuleId: string | null;
  erpSyncAdjustmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Fase 2: checklists configuráveis, grades, sugestão de destinação ────────

export type ChecklistResponseType = 'boolean' | 'select' | 'text' | 'number' | 'photo';

export interface ChecklistTemplate {
  id: string;
  companyId: string;
  name: string;
  active: boolean;
  category: string | null;
  productId: string | null;
  reason: string | null;
  minValue: number | null;
  maxValue: number | null;
  inspectionType: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  orderIndex: number;
  label: string;
  responseType: ChecklistResponseType;
  options: string[] | null;
  required: boolean;
}

export interface ChecklistResponse {
  id: string;
  returnItemId: string;
  templateItemId: string;
  valueBoolean: boolean | null;
  valueText: string | null;
  valueNumber: number | null;
  valueSelect: string | null;
  photoPath: string | null;
  createdAt: string;
}

export interface ConditionGrade {
  id: string;
  companyId: string;
  code: string;
  label: string;
  description: string | null;
  criteria: string[] | null;
  sortOrder: number;
  active: boolean;
}

export interface DestinationRule {
  id: string;
  companyId: string;
  priority: number;
  active: boolean;
  conditionGradeId: string | null;
  category: string | null;
  reason: string | null;
  minValue: number | null;
  maxValue: number | null;
  requiresWarranty: boolean | null;
  requiresAccessories: boolean | null;
  defectReported: string | null;
  suggestedDestination: ReturnDestination;
}

// ── Fase 2: aprovações ────────────────────────────────────────────────────────

export type ApprovalType = 'discard' | 'high_value' | 'restock' | 'serial_mismatch' | 'checklist_exception' | 'destination_change';

export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  discard: 'Descarte',
  high_value: 'Produto de alto valor',
  restock: 'Retorno ao estoque vendável',
  serial_mismatch: 'Divergência de serial',
  checklist_exception: 'Exceção ao checklist',
  destination_change: 'Alteração de destinação',
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalSettings {
  companyId: string;
  requireApprovalDiscard: boolean;
  requireApprovalRestock: boolean;
  highValueThreshold: number | null;
  requireApprovalHighValue: boolean;
  requireApprovalSerialMismatch: boolean;
  requireApprovalChecklistException: boolean;
  requireApprovalDestinationChange: boolean;
}

export interface ApprovalRequest {
  id: string;
  companyId: string;
  returnItemId: string;
  approvalType: ApprovalType;
  status: ApprovalStatus;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  notes: string | null;
}

// ── Fase 2: assistência técnica / recondicionamento ──────────────────────────

export type ServiceOrderType = 'technical_assistance' | 'refurbishment';
export type ServiceOrderStatus = 'awaiting_analysis' | 'in_service' | 'awaiting_part' | 'completed' | 'no_repair' | 'cancelled';

export const SERVICE_ORDER_STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  awaiting_analysis: 'Aguardando análise',
  in_service: 'Em tratamento',
  awaiting_part: 'Aguardando peça',
  completed: 'Concluído',
  no_repair: 'Sem reparo',
  cancelled: 'Cancelado',
};

export interface ServiceOrder {
  id: string;
  companyId: string;
  returnItemId: string;
  serviceType: ServiceOrderType;
  responsible: string | null;
  locationInternal: string | null;
  externalProvider: string | null;
  defectIdentified: string | null;
  partsServicesExpected: string | null;
  estimatedCost: number | null;
  deadline: string | null;
  status: ServiceOrderStatus;
  resultNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Fase 2: quarentena ────────────────────────────────────────────────────────

export interface QuarantineHold {
  id: string;
  companyId: string;
  returnItemId: string;
  location: string | null;
  blockReason: string;
  responsible: string | null;
  reviewDeadline: string | null;
  pendingNotes: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedReason: string | null;
  createdAt: string;
}

export interface ReturnAttachment {
  id: string;
  returnId: string;
  returnItemId: string | null;
  companyId: string;
  filePath: string;
  fileName: string;
  uploadedBy: string | null;
  createdAt: string;
}

export interface ReturnAuditEvent {
  id: string;
  action: string;
  userEmail: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}
