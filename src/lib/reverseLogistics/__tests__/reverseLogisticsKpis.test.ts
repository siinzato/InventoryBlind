import { describe, it, expect } from 'vitest';
import { computeReturnKpis } from '../reverseLogisticsKpis';
import type { ReturnItem, ReturnRecord } from '../reverseLogisticsTypes';

function makeReturn(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: 'r1', companyId: 'c1', code: 'DEV-1', status: 'finalized', sourceType: 'manual',
    referenceValue: null, linkedSaleId: null, linkedNfeInvoiceId: null, linkedPurchaseOrderId: null,
    unresolved: false, customerName: null, origin: null, originChannelConnectionId: null, originSource: null,
    reason: 'defeito', expectedQuantity: null,
    receivedAt: '2026-08-01T00:00:00Z', receivedBy: null, notes: null, statusChangedBy: null,
    statusChangedAt: '2026-08-05T00:00:00Z', cancellationReason: null, createdBy: null,
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<ReturnItem> = {}): ReturnItem {
  return {
    id: 'i1', returnId: 'r1', companyId: 'c1', lineNumber: 1, productId: 'p1', sku: 'SKU-1', ean: null,
    description: 'x', expectedQuantity: null, receivedQuantity: 1, lotNumber: null, serialNumber: null,
    originalPackaging: null, accessoriesReceived: null, itemNotes: null,
    checklistCorrectProduct: null, checklistPackagingIntact: null, checklistNoVisibleDamage: null,
    checklistApparentlyFunctional: null, checklistAccessoriesComplete: null, checklistSignsOfUse: null,
    checklistSerialMatches: null, classification: null, inspectedBy: null, inspectedAt: null,
    destination: 'restock', destinationReason: null, destinationStatus: 'moved', destinationDecidedBy: null,
    destinationDecidedAt: null, currentLocation: 'Estoque', checklistTemplateId: null,
    checklistTemplateVersion: null, conditionGradeId: null, suggestedDestination: null,
    suggestedDestinationRuleId: null, erpSyncAdjustmentId: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('computeReturnKpis', () => {
  it('sem devoluções, tudo null/zero e nenhum dado de valor', () => {
    const kpis = computeReturnKpis([], [], { start: null, end: null }, () => null, new Set());
    expect(kpis.receivedCount).toBe(0);
    expect(kpis.averageProcessingDays).toBeNull();
    expect(kpis.recoveredPct).toBeNull();
    expect(kpis.hasValueData).toBe(false);
  });

  it('calcula tempo médio de processamento só para devoluções finalizadas', () => {
    const returns = [makeReturn({ receivedAt: '2026-08-01T00:00:00Z', statusChangedAt: '2026-08-03T00:00:00Z' })];
    const kpis = computeReturnKpis(returns, [], { start: null, end: null }, () => null, new Set());
    expect(kpis.averageProcessingDays).toBe(2);
  });

  it('percentuais de recuperado/assistência/descarte batem com a distribuição de destinações', () => {
    const returns = [makeReturn()];
    const items = [
      makeItem({ id: 'a', destination: 'restock' }),
      makeItem({ id: 'b', destination: 'restock' }),
      makeItem({ id: 'c', destination: 'discard' }),
      makeItem({ id: 'd', destination: 'technical_assistance' }),
    ];
    const kpis = computeReturnKpis(returns, items, { start: null, end: null }, () => null, new Set());
    expect(kpis.recoveredPct).toBe(50);
    expect(kpis.discardedPct).toBe(25);
    expect(kpis.assistancePct).toBe(25);
  });

  it('valor recuperado/perdido só conta itens com preço conhecido, e sinaliza hasValueData', () => {
    const returns = [makeReturn()];
    const items = [
      makeItem({ id: 'a', productId: 'known', destination: 'restock', receivedQuantity: 2 }),
      makeItem({ id: 'b', productId: 'unknown', destination: 'discard' }),
    ];
    const getPrice = (productId: string | null) => (productId === 'known' ? 50 : null);
    const kpis = computeReturnKpis(returns, items, { start: null, end: null }, getPrice, new Set());
    expect(kpis.recoveredValue).toBe(100);
    expect(kpis.estimatedLossValue).toBeNull();
    expect(kpis.hasValueData).toBe(true);
  });

  it('filtra por período e calcula % dentro do SLA', () => {
    const returns = [makeReturn({ id: 'in', receivedAt: '2026-08-10T00:00:00Z' }), makeReturn({ id: 'out', receivedAt: '2026-07-01T00:00:00Z' })];
    const kpis = computeReturnKpis(returns, [], { start: '2026-08-01', end: '2026-08-31' }, () => null, new Set(['in']));
    expect(kpis.receivedCount).toBe(1);
    expect(kpis.slaCompliancePct).toBe(100);
  });

  it('top motivos e produtos recorrentes', () => {
    const returns = [makeReturn({ id: 'r1', reason: 'defeito' }), makeReturn({ id: 'r2', reason: 'defeito' }), makeReturn({ id: 'r3', reason: 'arrependimento' })];
    const items = [makeItem({ id: 'a', returnId: 'r1', sku: 'X' }), makeItem({ id: 'b', returnId: 'r2', sku: 'X' })];
    const kpis = computeReturnKpis(returns, items, { start: null, end: null }, () => null, new Set());
    expect(kpis.topReasons[0]).toEqual({ reason: 'defeito', count: 2 });
    expect(kpis.topProducts[0]).toEqual({ sku: 'X', count: 2 });
  });
});
