// Retiradas Full — tipos de domínio (camelCase), espelhando a migration 096.
//
// Não existe hoje conector real da API do Mercado Livre neste projeto (ver nota
// na migration) — por isso vários campos aqui só existem depois que um humano
// confirma no painel do Mercado Livre e informa o dado de volta (fullWithdrawalLinkMl),
// nunca preenchidos automaticamente.

export type FullWithdrawalStatus =
  | 'draft'
  | 'awaiting_confirmation'
  | 'reserved'
  | 'preparing'
  | 'shipped'
  | 'received'
  | 'conferred'
  | 'cancelled'
  | 'with_divergence';

export const FULL_WITHDRAWAL_STATUS_LABEL: Record<FullWithdrawalStatus, string> = {
  draft: 'Rascunho',
  awaiting_confirmation: 'Aguardando confirmação no ML',
  reserved: 'Reserva registrada',
  preparing: 'Em preparação',
  shipped: 'Despachada',
  received: 'Recebida',
  conferred: 'Conferida',
  cancelled: 'Cancelada',
  with_divergence: 'Com divergência',
};

export type FullWithdrawalReason =
  | 'low_turnover'
  | 'excess_stock'
  | 'discontinued'
  | 'operational_correction'
  | 'quality_damage'
  | 'other';

export const FULL_WITHDRAWAL_REASON_LABEL: Record<FullWithdrawalReason, string> = {
  low_turnover: 'Estoque sem giro',
  excess_stock: 'Excesso de estoque',
  discontinued: 'Produto descontinuado',
  operational_correction: 'Correção operacional',
  quality_damage: 'Qualidade ou avaria',
  other: 'Outro',
};

export type FullWithdrawalMethod = 'withdraw_and_receive' | 'discard';

export const FULL_WITHDRAWAL_METHOD_LABEL: Record<FullWithdrawalMethod, string> = {
  withdraw_and_receive: 'Retirar e receber',
  discard: 'Descartar no Full',
};

export type FullWithdrawalItemSituation = 'pending' | 'awaiting_receipt' | 'ok' | 'divergent';

export const FULL_WITHDRAWAL_ITEM_SITUATION_LABEL: Record<FullWithdrawalItemSituation, string> = {
  pending: 'Aguardando confirmação no ML',
  awaiting_receipt: 'Aguardando recebimento',
  ok: 'Conferido',
  divergent: 'Divergência',
};

export type FullWithdrawalEventType =
  | 'plan_created'
  | 'reservation_registered'
  | 'preparation_started'
  | 'dispatched'
  | 'delivered'
  | 'conference_completed'
  | 'cancelled'
  | 'discarded'
  | 'divergence_registered'
  | 'divergence_justified';

/** Nome compreensível ao operador — o código original do evento é sempre
 *  preservado em `eventType`, isto é só a tradução para exibição. */
export const FULL_WITHDRAWAL_EVENT_LABEL: Record<FullWithdrawalEventType, string> = {
  plan_created: 'Plano criado',
  reservation_registered: 'Reserva registrada',
  preparation_started: 'Preparação iniciada',
  dispatched: 'Retirada processada',
  delivered: 'Entrega recebida',
  conference_completed: 'Conferência concluída',
  cancelled: 'Cancelamento',
  discarded: 'Descarte processado',
  divergence_registered: 'Divergência identificada',
  divergence_justified: 'Divergência justificada',
};

export interface FullWithdrawalPlan {
  id: string;
  companyId: string;
  code: string;
  status: FullWithdrawalStatus;
  reason: FullWithdrawalReason | null;
  method: FullWithdrawalMethod;
  destinationLabel: string | null;
  destinationAddress: string | null;
  /** Identificador real da retirada no Mercado Livre — null até um humano
   *  vincular via "Vincular retirada do ML" (não há correlação automática). */
  mlReference: string | null;
  /** Custo informado pelo Mercado Livre — null até ser informado manualmente. */
  cost: number | null;
  costNote: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  mlConfirmedAt: string | null;
  reservedAt: string | null;
  preparingAt: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  conferredAt: string | null;
  cancellationReason: string | null;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FullWithdrawalItem {
  id: string;
  planId: string;
  companyId: string;
  productId: string | null;
  sku: string | null;
  description: string;
  plannedQuantity: number;
  /** Quantidade confirmada pelo Full — vem do Mercado Livre, null enquanto não informada. */
  confirmedQuantity: number | null;
  /** Quantidade fisicamente recebida na conferência — nunca pré-preenchida. */
  receivedQuantity: number | null;
  situation: FullWithdrawalItemSituation;
  divergenceNote: string | null;
  divergenceNotedBy: string | null;
  divergenceNotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FullWithdrawalEvent {
  id: string;
  planId: string;
  companyId: string;
  eventType: FullWithdrawalEventType;
  occurredAt: string;
  createdBy: string | null;
  note: string | null;
}

/** Produto do catálogo já existente, para a etapa "Selecionar estoque" — nunca
 *  inclui saldo/antiguidade do Full (não existe fonte real para isso hoje). */
export interface WithdrawalCandidateProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
  /** Estoque no sistema InventoryBlind (products.stock_quantity) — não é o
   *  saldo no depósito Full do Mercado Livre, só uma referência local. */
  systemStock: number;
}
