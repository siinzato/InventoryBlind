import { describe, it, expect } from 'vitest';
import { buildReturnSlaAlerts, DEFAULT_RETURN_SLA_THRESHOLDS } from '../reverseLogisticsSla';
import type { ReturnItem, ReturnRecord, ServiceOrder, ApprovalRequest, QuarantineHold } from '../reverseLogisticsTypes';

const NOW = new Date('2026-08-26T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();

function makeReturn(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: 'r1', companyId: 'c1', code: 'DEV-1', status: 'received', sourceType: 'manual',
    referenceValue: null, linkedSaleId: null, linkedNfeInvoiceId: null, linkedPurchaseOrderId: null,
    unresolved: false, customerName: null, origin: null, originChannelConnectionId: null, originSource: null,
    reason: null, expectedQuantity: null,
    receivedAt: daysAgo(0), receivedBy: null, notes: null, statusChangedBy: null, statusChangedAt: null,
    cancellationReason: null, createdBy: null, createdAt: daysAgo(0), updatedAt: daysAgo(0),
    ...overrides,
  };
}

function makeItem(overrides: Partial<ReturnItem> = {}): ReturnItem {
  return {
    id: 'i1', returnId: 'r1', companyId: 'c1', lineNumber: 1, productId: null, sku: null, ean: null,
    description: 'x', expectedQuantity: null, receivedQuantity: 1, lotNumber: null, serialNumber: null,
    originalPackaging: null, accessoriesReceived: null, itemNotes: null,
    checklistCorrectProduct: null, checklistPackagingIntact: null, checklistNoVisibleDamage: null,
    checklistApparentlyFunctional: null, checklistAccessoriesComplete: null, checklistSignsOfUse: null,
    checklistSerialMatches: null, classification: null, inspectedBy: null, inspectedAt: null,
    destination: null, destinationReason: null, destinationStatus: 'pending', destinationDecidedBy: null,
    destinationDecidedAt: null, currentLocation: 'Quarentena', checklistTemplateId: null,
    checklistTemplateVersion: null, conditionGradeId: null, suggestedDestination: null,
    suggestedDestinationRuleId: null, erpSyncAdjustmentId: null, createdAt: daysAgo(0), updatedAt: daysAgo(0),
    ...overrides,
  };
}

describe('buildReturnSlaAlerts', () => {
  it('sem nada vencido, nenhum alerta', () => {
    const alerts = buildReturnSlaAlerts([makeReturn({ receivedAt: daysAgo(0) })], [], [], [], [], DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts).toEqual([]);
  });

  it('devolução recebida além do prazo de conferência gera alerta', () => {
    const alerts = buildReturnSlaAlerts([makeReturn({ receivedAt: daysAgo(5) })], [], [], [], [], DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts.find(a => a.type === 'awaiting_conference')?.count).toBe(1);
  });

  it('quarentena aberta além do prazo gera alerta, liberada não conta', () => {
    const holds: QuarantineHold[] = [
      { id: 'h1', companyId: 'c1', returnItemId: 'i1', location: null, blockReason: 'x', responsible: null, reviewDeadline: null, pendingNotes: null, releasedAt: null, releasedBy: null, releasedReason: null, createdAt: daysAgo(10) },
      { id: 'h2', companyId: 'c1', returnItemId: 'i2', location: null, blockReason: 'x', responsible: null, reviewDeadline: null, pendingNotes: null, releasedAt: daysAgo(1), releasedBy: 'u', releasedReason: 'ok', createdAt: daysAgo(10) },
    ];
    const alerts = buildReturnSlaAlerts([], [], [], [], holds, DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts.find(a => a.type === 'quarantine_stalled')?.count).toBe(1);
  });

  it('ordem de assistência com prazo vencido e ainda não encerrada gera alerta', () => {
    const orders: ServiceOrder[] = [{
      id: 'o1', companyId: 'c1', returnItemId: 'i1', serviceType: 'technical_assistance', responsible: null,
      locationInternal: null, externalProvider: null, defectIdentified: null, partsServicesExpected: null,
      estimatedCost: null, deadline: daysAgo(2).slice(0, 10), status: 'in_service', resultNotes: null,
      createdAt: daysAgo(5), updatedAt: daysAgo(5),
    }];
    const alerts = buildReturnSlaAlerts([], [], orders, [], [], DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts.find(a => a.type === 'service_order_overdue')?.count).toBe(1);
  });

  it('aprovação pendente além do prazo gera alerta', () => {
    const requests: ApprovalRequest[] = [{
      id: 'a1', companyId: 'c1', returnItemId: 'i1', approvalType: 'discard', status: 'pending',
      requestedBy: 'u', requestedAt: daysAgo(5), decidedBy: null, decidedAt: null, decisionReason: null, notes: null,
    }];
    const alerts = buildReturnSlaAlerts([], [], [], requests, [], DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts.find(a => a.type === 'approval_pending')?.count).toBe(1);
  });

  it('item aguardando decisão de destinação além do prazo gera alerta', () => {
    const items = [makeItem({ destinationStatus: 'pending', updatedAt: daysAgo(5) })];
    const returns = [makeReturn({ status: 'awaiting_destination' })];
    const alerts = buildReturnSlaAlerts(returns, items, [], [], [], DEFAULT_RETURN_SLA_THRESHOLDS, NOW);
    expect(alerts.find(a => a.type === 'destination_not_executed')?.count).toBe(1);
  });
});
