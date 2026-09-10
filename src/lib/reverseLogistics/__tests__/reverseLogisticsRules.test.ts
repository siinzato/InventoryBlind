import { describe, it, expect } from 'vitest';
import {
  allowedNextStatuses, isValidTransition, isDestinationReasonRequired, isDestinationApprovalRequired,
  isInspectionCorrectionReasonRequired, canFinalizeReturn, computeReturnItemsSummary, computeQuantityDivergence,
  selectApplicableChecklistTemplate, suggestDestination, requiredApprovalTypes, hasChecklistException, findConditionGrade,
} from '../reverseLogisticsRules';
import type { ReturnItem, DestinationRule, ConditionGrade } from '../reverseLogisticsTypes';

function makeItem(overrides: Partial<ReturnItem> = {}): ReturnItem {
  return {
    id: 'item-1', returnId: 'return-1', companyId: 'company-1', lineNumber: 1,
    productId: 'product-1', sku: 'SKU-1', ean: null, description: 'Produto',
    expectedQuantity: 2, receivedQuantity: 2, lotNumber: null, serialNumber: null,
    originalPackaging: null, accessoriesReceived: null, itemNotes: null,
    checklistCorrectProduct: null, checklistPackagingIntact: null, checklistNoVisibleDamage: null,
    checklistApparentlyFunctional: null, checklistAccessoriesComplete: null, checklistSignsOfUse: null,
    checklistSerialMatches: null, classification: null, inspectedBy: null, inspectedAt: null,
    destination: null, destinationReason: null, destinationStatus: 'pending',
    destinationDecidedBy: null, destinationDecidedAt: null, currentLocation: 'Quarentena - Devoluções',
    checklistTemplateId: null, checklistTemplateVersion: null, conditionGradeId: null,
    suggestedDestination: null, suggestedDestinationRuleId: null, erpSyncAdjustmentId: null,
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
    ...overrides,
  };
}

describe('allowedNextStatuses / isValidTransition', () => {
  it('avança um passo por vez, na ordem certa', () => {
    expect(allowedNextStatuses('received')).toEqual(['in_conference', 'cancelled']);
    expect(allowedNextStatuses('in_conference')).toEqual(['in_inspection', 'cancelled']);
    expect(allowedNextStatuses('in_inspection')).toEqual(['awaiting_destination', 'cancelled']);
    expect(allowedNextStatuses('awaiting_destination')).toEqual(['finalized', 'cancelled']);
  });

  it('estados terminais não aceitam mais transições', () => {
    expect(allowedNextStatuses('finalized')).toEqual([]);
    expect(allowedNextStatuses('cancelled')).toEqual([]);
  });

  it('rejeita pular etapas', () => {
    expect(isValidTransition('received', 'in_inspection')).toBe(false);
    expect(isValidTransition('received', 'awaiting_destination')).toBe(false);
    expect(isValidTransition('received', 'finalized')).toBe(false);
  });

  it('aceita avanço de um passo e cancelamento de qualquer estado não-terminal', () => {
    expect(isValidTransition('received', 'in_conference')).toBe(true);
    expect(isValidTransition('in_conference', 'cancelled')).toBe(true);
    expect(isValidTransition('awaiting_destination', 'finalized')).toBe(true);
  });

  it('não permite reabrir um estado terminal', () => {
    expect(isValidTransition('finalized', 'awaiting_destination')).toBe(false);
    expect(isValidTransition('cancelled', 'received')).toBe(false);
  });
});

describe('isDestinationReasonRequired / isDestinationApprovalRequired', () => {
  it('exige justificativa só para descarte, assistência técnica e devolução ao fornecedor', () => {
    expect(isDestinationReasonRequired('discard')).toBe(true);
    expect(isDestinationReasonRequired('technical_assistance')).toBe(true);
    expect(isDestinationReasonRequired('return_to_supplier')).toBe(true);
    expect(isDestinationReasonRequired('restock')).toBe(false);
    expect(isDestinationReasonRequired('quarantine')).toBe(false);
    expect(isDestinationReasonRequired('damaged_stock')).toBe(false);
    expect(isDestinationReasonRequired('refurbishment')).toBe(false);
  });

  it('exige aprovação elevada só para retorno ao estoque e descarte', () => {
    expect(isDestinationApprovalRequired('restock')).toBe(true);
    expect(isDestinationApprovalRequired('discard')).toBe(true);
    expect(isDestinationApprovalRequired('quarantine')).toBe(false);
    expect(isDestinationApprovalRequired('technical_assistance')).toBe(false);
  });
});

describe('isInspectionCorrectionReasonRequired', () => {
  it('só exige justificativa quando já havia inspeção anterior', () => {
    expect(isInspectionCorrectionReasonRequired(false)).toBe(false);
    expect(isInspectionCorrectionReasonRequired(true)).toBe(true);
  });
});

describe('canFinalizeReturn', () => {
  it('não finaliza sem itens', () => {
    expect(canFinalizeReturn([])).toBe(false);
  });

  it('não finaliza se algum item ainda não teve destinação processada', () => {
    const items = [makeItem({ destinationStatus: 'moved' }), makeItem({ id: 'item-2', destinationStatus: 'pending' })];
    expect(canFinalizeReturn(items)).toBe(false);
  });

  it('finaliza quando todos os itens já foram movidos', () => {
    const items = [makeItem({ destinationStatus: 'moved' }), makeItem({ id: 'item-2', destinationStatus: 'moved' })];
    expect(canFinalizeReturn(items)).toBe(true);
  });
});

describe('computeReturnItemsSummary', () => {
  it('conta itens, soma quantidade recebida e acha a destinação predominante', () => {
    const items = [
      makeItem({ id: 'a', receivedQuantity: 2, destination: 'restock' }),
      makeItem({ id: 'b', receivedQuantity: 1, destination: 'restock' }),
      makeItem({ id: 'c', receivedQuantity: 3, destination: 'discard' }),
    ];
    const summary = computeReturnItemsSummary(items);
    expect(summary.itemCount).toBe(3);
    expect(summary.totalReceivedQuantity).toBe(6);
    expect(summary.predominantDestination).toBe('restock');
  });

  it('devolve null quando nenhum item ainda tem destinação', () => {
    const summary = computeReturnItemsSummary([makeItem({ destination: null }), makeItem({ id: 'b', destination: null })]);
    expect(summary.predominantDestination).toBeNull();
  });
});

describe('computeQuantityDivergence', () => {
  it('é null quando não há quantidade esperada', () => {
    expect(computeQuantityDivergence({ expectedQuantity: null, receivedQuantity: 5 })).toBeNull();
  });

  it('é a diferença entre recebido e esperado', () => {
    expect(computeQuantityDivergence({ expectedQuantity: 5, receivedQuantity: 3 })).toBe(-2);
    expect(computeQuantityDivergence({ expectedQuantity: 3, receivedQuantity: 5 })).toBe(2);
    expect(computeQuantityDivergence({ expectedQuantity: 4, receivedQuantity: 4 })).toBe(0);
  });
});

describe('selectApplicableChecklistTemplate', () => {
  const templates = [
    { id: 'generic', active: true, category: null, productId: null, reason: null, minValue: null, maxValue: null },
    { id: 'by-reason', active: true, category: null, productId: null, reason: 'defeito', minValue: null, maxValue: null },
    { id: 'by-product', active: true, category: null, productId: 'product-1', reason: null, minValue: null, maxValue: null },
    { id: 'inactive', active: false, category: null, productId: 'product-1', reason: null, minValue: null, maxValue: null },
  ];

  it('escolhe o template mais específico que bate (produto > motivo > genérico)', () => {
    expect(selectApplicableChecklistTemplate({ productId: 'product-1', reason: 'defeito' }, null, templates)).toBe('by-product');
    expect(selectApplicableChecklistTemplate({ productId: null, reason: 'defeito' }, null, templates)).toBe('by-reason');
    expect(selectApplicableChecklistTemplate({ productId: null, reason: null }, null, templates)).toBe('generic');
  });

  it('ignora templates inativos e retorna null se nada se aplica', () => {
    expect(selectApplicableChecklistTemplate({ productId: 'product-2', reason: 'outro' }, null, [templates[2], templates[3]])).toBeNull();
  });

  it('respeita faixa de valor', () => {
    const ranged = [{ id: 'ranged', active: true, category: null, productId: null, reason: null, minValue: 100, maxValue: 500 }];
    expect(selectApplicableChecklistTemplate({ productId: null, reason: null }, 300, ranged)).toBe('ranged');
    expect(selectApplicableChecklistTemplate({ productId: null, reason: null }, 50, ranged)).toBeNull();
    expect(selectApplicableChecklistTemplate({ productId: null, reason: null }, null, ranged)).toBeNull();
  });
});

describe('suggestDestination', () => {
  const rules: DestinationRule[] = [
    { id: 'r-low', companyId: 'c1', priority: 1, active: true, conditionGradeId: null, category: null, reason: null, minValue: null, maxValue: null, requiresWarranty: null, requiresAccessories: null, defectReported: null, suggestedDestination: 'quarantine' },
    { id: 'r-high', companyId: 'c1', priority: 10, active: true, conditionGradeId: 'grade-a', category: null, reason: null, minValue: null, maxValue: null, requiresWarranty: null, requiresAccessories: null, defectReported: null, suggestedDestination: 'restock' },
  ];

  it('escolhe a regra de maior prioridade cujas condições batem', () => {
    expect(suggestDestination({ conditionGradeId: 'grade-a', reason: null }, null, rules)).toEqual({ destination: 'restock', ruleId: 'r-high' });
  });

  it('cai para a próxima regra quando a de maior prioridade não bate', () => {
    expect(suggestDestination({ conditionGradeId: 'grade-b', reason: null }, null, rules)).toEqual({ destination: 'quarantine', ruleId: 'r-low' });
  });

  it('retorna null quando nenhuma regra ativa bate', () => {
    expect(suggestDestination({ conditionGradeId: 'grade-b', reason: null }, null, [{ ...rules[0], active: false }])).toBeNull();
  });
});

describe('requiredApprovalTypes', () => {
  const baseItem = { destination: 'discard' as const, serialMismatch: false, hasChecklistException: false, suggestedDestination: null };

  it('sem settings, nenhuma aprovação é exigida', () => {
    expect(requiredApprovalTypes(baseItem, null, null)).toEqual([]);
  });

  it('exige discard quando configurado e a destinação é discard', () => {
    const settings = { requireApprovalDiscard: true, requireApprovalRestock: false, highValueThreshold: null, requireApprovalHighValue: false, requireApprovalSerialMismatch: false, requireApprovalChecklistException: false, requireApprovalDestinationChange: false };
    expect(requiredApprovalTypes(baseItem, null, settings)).toEqual(['discard']);
  });

  it('acumula múltiplos tipos quando várias condições batem', () => {
    const settings = { requireApprovalDiscard: true, requireApprovalRestock: false, highValueThreshold: 100, requireApprovalHighValue: true, requireApprovalSerialMismatch: true, requireApprovalChecklistException: false, requireApprovalDestinationChange: false };
    const item = { ...baseItem, serialMismatch: true };
    expect(requiredApprovalTypes(item, 500, settings)).toEqual(['discard', 'high_value', 'serial_mismatch']);
  });

  it('destination_change só dispara quando a decisão diverge da sugestão', () => {
    const settings = { requireApprovalDiscard: false, requireApprovalRestock: false, highValueThreshold: null, requireApprovalHighValue: false, requireApprovalSerialMismatch: false, requireApprovalChecklistException: false, requireApprovalDestinationChange: true };
    expect(requiredApprovalTypes({ ...baseItem, suggestedDestination: 'discard' }, null, settings)).toEqual([]);
    expect(requiredApprovalTypes({ ...baseItem, suggestedDestination: 'quarantine' }, null, settings)).toEqual(['destination_change']);
  });
});

describe('hasChecklistException', () => {
  it('false quando tudo passou (ou nada foi respondido)', () => {
    expect(hasChecklistException(makeItem())).toBe(false);
  });

  it('true quando qualquer item obrigatório falhou', () => {
    expect(hasChecklistException(makeItem({ checklistSerialMatches: false }))).toBe(true);
    expect(hasChecklistException(makeItem({ checklistPackagingIntact: false }))).toBe(true);
  });
});

describe('findConditionGrade', () => {
  const grades: ConditionGrade[] = [{ id: 'g1', companyId: 'c1', code: 'A', label: 'Grau A', description: null, criteria: null, sortOrder: 0, active: true }];

  it('encontra pelo id', () => {
    expect(findConditionGrade(grades, 'g1')?.code).toBe('A');
  });

  it('null quando id é null ou não encontrado', () => {
    expect(findConditionGrade(grades, null)).toBeNull();
    expect(findConditionGrade(grades, 'missing')).toBeNull();
  });
});
