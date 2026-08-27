// Logística Reversa — alertas de SLA. Função pura, computada sobre dados já carregados no
// cliente — mesmo padrão de src/lib/intelligence/alertEngine.ts e
// src/lib/adminKpis/kpiHealth.ts::buildPriorityAlerts. Sem tabela de notificação nova: nenhum
// alerta é persistido, então nunca há duplicação (é recalculado a cada carregamento).

import type {
  ApprovalRequest, QuarantineHold, ReturnItem, ReturnRecord, ServiceOrder,
} from './reverseLogisticsTypes';

export interface ReturnSlaThresholds {
  conferenceDays: number;
  inspectionDays: number;
  quarantineDays: number;
  serviceOrderGraceDays: number;
  approvalDays: number;
  destinationExecutionDays: number;
}

export const DEFAULT_RETURN_SLA_THRESHOLDS: ReturnSlaThresholds = {
  conferenceDays: 2,
  inspectionDays: 3,
  quarantineDays: 7,
  serviceOrderGraceDays: 0,
  approvalDays: 2,
  destinationExecutionDays: 2,
};

export type ReturnSlaAlertType =
  | 'awaiting_conference' | 'inspection_overdue' | 'quarantine_stalled'
  | 'service_order_overdue' | 'approval_pending' | 'destination_not_executed';

export interface ReturnSlaAlert {
  type: ReturnSlaAlertType;
  title: string;
  count: number;
  itemIds: string[];
}

function daysSince(dateIso: string, now: Date): number {
  return (now.getTime() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
}

/** Cada alerta só existe se houver pelo menos 1 ocorrência real — "sem contagem, sem alerta",
 *  mesma disciplina de alertEngine.ts. */
export function buildReturnSlaAlerts(
  returns: ReturnRecord[],
  items: ReturnItem[],
  serviceOrders: ServiceOrder[],
  approvalRequests: ApprovalRequest[],
  quarantineHolds: QuarantineHold[],
  thresholds: ReturnSlaThresholds = DEFAULT_RETURN_SLA_THRESHOLDS,
  now: Date = new Date()
): ReturnSlaAlert[] {
  const alerts: ReturnSlaAlert[] = [];
  const returnById = new Map(returns.map(r => [r.id, r]));

  const awaitingConference = returns.filter(r => r.status === 'received' && daysSince(r.receivedAt, now) > thresholds.conferenceDays);
  if (awaitingConference.length > 0) {
    alerts.push({ type: 'awaiting_conference', title: `${awaitingConference.length} devolução(ões) aguardando conferência além do prazo`, count: awaitingConference.length, itemIds: awaitingConference.map(r => r.id) });
  }

  const inspectionOverdue = returns.filter(r => r.status === 'in_inspection' && r.statusChangedAt && daysSince(r.statusChangedAt, now) > thresholds.inspectionDays);
  if (inspectionOverdue.length > 0) {
    alerts.push({ type: 'inspection_overdue', title: `${inspectionOverdue.length} devolução(ões) com inspeção atrasada`, count: inspectionOverdue.length, itemIds: inspectionOverdue.map(r => r.id) });
  }

  const openHolds = quarantineHolds.filter(h => !h.releasedAt && daysSince(h.createdAt, now) > thresholds.quarantineDays);
  if (openHolds.length > 0) {
    alerts.push({ type: 'quarantine_stalled', title: `${openHolds.length} item(ns) parado(s) em quarentena além do prazo`, count: openHolds.length, itemIds: openHolds.map(h => h.returnItemId) });
  }

  const overdueOrders = serviceOrders.filter(o =>
    !['completed', 'no_repair', 'cancelled'].includes(o.status) && o.deadline && daysSince(o.deadline, now) > thresholds.serviceOrderGraceDays
  );
  if (overdueOrders.length > 0) {
    alerts.push({ type: 'service_order_overdue', title: `${overdueOrders.length} ordem(ns) de assistência/recondicionamento fora do prazo`, count: overdueOrders.length, itemIds: overdueOrders.map(o => o.returnItemId) });
  }

  const pendingApprovals = approvalRequests.filter(a => a.status === 'pending' && daysSince(a.requestedAt, now) > thresholds.approvalDays);
  if (pendingApprovals.length > 0) {
    alerts.push({ type: 'approval_pending', title: `${pendingApprovals.length} aprovação(ões) pendente(s) além do prazo`, count: pendingApprovals.length, itemIds: pendingApprovals.map(a => a.returnItemId) });
  }

  const destinationNotExecuted = items.filter(i => {
    if (i.destinationStatus !== 'pending' || !i.updatedAt) return false;
    const parent = returnById.get(i.returnId);
    return parent?.status === 'awaiting_destination' && daysSince(i.updatedAt, now) > thresholds.destinationExecutionDays;
  });
  if (destinationNotExecuted.length > 0) {
    alerts.push({ type: 'destination_not_executed', title: `${destinationNotExecuted.length} item(ns) aguardando decisão de destinação`, count: destinationNotExecuted.length, itemIds: destinationNotExecuted.map(i => i.id) });
  }

  return alerts;
}
