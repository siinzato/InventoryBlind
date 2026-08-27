// Logística Reversa — regras puras (sem banco), testáveis isoladamente.
//
// Espelha a validação real da migration 083 (RPCs returns_transition_status /
// return_items_decide_destination) só para a UI habilitar/desabilitar controles
// e mostrar mensagens antes de ir ao servidor. A barreira de verdade continua na RPC.

import type {
  ApprovalSettings, ApprovalType, ChecklistTemplate, ConditionGrade, DestinationRule,
  ReturnDestination, ReturnItem, ReturnStatus,
} from './reverseLogisticsTypes';

const FORWARD_TRANSITIONS: Partial<Record<ReturnStatus, ReturnStatus>> = {
  received: 'in_conference',
  in_conference: 'in_inspection',
  in_inspection: 'awaiting_destination',
  awaiting_destination: 'finalized',
};

const TERMINAL_STATUSES: readonly ReturnStatus[] = ['finalized', 'cancelled'];

/** Transições possíveis a partir do status atual — o próximo passo em frente, e
 *  cancelar (sempre disponível fora de um estado terminal). Mesma regra da RPC. */
export function allowedNextStatuses(current: ReturnStatus): ReturnStatus[] {
  if (TERMINAL_STATUSES.includes(current)) return [];
  const next: ReturnStatus[] = ['cancelled'];
  const forward = FORWARD_TRANSITIONS[current];
  if (forward) next.unshift(forward);
  return next;
}

export function isValidTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return allowedNextStatuses(from).includes(to);
}

const DESTINATIONS_REQUIRING_REASON: readonly ReturnDestination[] = ['discard', 'technical_assistance', 'return_to_supplier'];
const DESTINATIONS_REQUIRING_APPROVAL: readonly ReturnDestination[] = ['restock', 'discard'];

export function isDestinationReasonRequired(destination: ReturnDestination): boolean {
  return DESTINATIONS_REQUIRING_REASON.includes(destination);
}

export function isDestinationApprovalRequired(destination: ReturnDestination): boolean {
  return DESTINATIONS_REQUIRING_APPROVAL.includes(destination);
}

/** Uma correção de inspeção já registrada exige justificativa — mesma regra de
 *  `return_items_set_inspection` na RPC. */
export function isInspectionCorrectionReasonRequired(alreadyInspected: boolean): boolean {
  return alreadyInspected;
}

/** Um item só pode ser finalizado quando a destinação já foi processada
 *  (`destination_status = 'moved'`) — mesma checagem de `returns_transition_status`
 *  antes de aceitar `finalized`. */
export function canFinalizeReturn(items: ReturnItem[]): boolean {
  return items.length > 0 && items.every(item => item.destinationStatus === 'moved');
}

export interface ReturnItemsSummary {
  itemCount: number;
  totalReceivedQuantity: number;
  predominantDestination: ReturnDestination | null;
}

type SummarizableItem = Pick<ReturnItem, 'destination' | 'receivedQuantity'>;

/** Resumo agregado para a listagem — calculado no cliente, nunca persistido
 *  (mesma filosofia de `poProgress.ts`: progresso é sempre derivado, não gravado). */
export function computeReturnItemsSummary(items: SummarizableItem[]): ReturnItemsSummary {
  const totalReceivedQuantity = items.reduce((sum, item) => sum + item.receivedQuantity, 0);

  const counts = new Map<ReturnDestination, number>();
  for (const item of items) {
    if (!item.destination) continue;
    counts.set(item.destination, (counts.get(item.destination) ?? 0) + 1);
  }

  let predominantDestination: ReturnDestination | null = null;
  let maxCount = 0;
  for (const [destination, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      predominantDestination = destination;
    }
  }

  return { itemCount: items.length, totalReceivedQuantity, predominantDestination };
}

/** Divergência entre esperado e recebido — calculada no cliente, nunca gravada. */
export function computeQuantityDivergence(item: Pick<ReturnItem, 'expectedQuantity' | 'receivedQuantity'>): number | null {
  if (item.expectedQuantity == null) return null;
  return item.receivedQuantity - item.expectedQuantity;
}

// ── Fase 2: checklists configuráveis ─────────────────────────────────────────

type ItemForTemplateSelection = { productId: string | null; reason: string | null };

/** Escolhe, de forma determinística, o template de checklist ativo mais específico que se
 *  aplica ao item — nunca um "motor de regras" genérico, só um filtro + ordenação por
 *  especificidade (produto > categoria/motivo > faixa de valor > nenhum critério). */
export function selectApplicableChecklistTemplate(
  item: ItemForTemplateSelection,
  itemValue: number | null,
  templates: Pick<ChecklistTemplate, 'id' | 'active' | 'category' | 'productId' | 'reason' | 'minValue' | 'maxValue'>[]
): string | null {
  const candidates = templates.filter(t => {
    if (!t.active) return false;
    if (t.productId && t.productId !== item.productId) return false;
    if (t.reason && t.reason !== item.reason) return false;
    if (t.minValue != null && (itemValue == null || itemValue < t.minValue)) return false;
    if (t.maxValue != null && (itemValue == null || itemValue > t.maxValue)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const specificity = (t: (typeof candidates)[number]) =>
    (t.productId ? 2 : 0) + (t.reason ? 1 : 0) + (t.minValue != null || t.maxValue != null ? 1 : 0);
  candidates.sort((a, b) => specificity(b) - specificity(a));
  return candidates[0].id;
}

// ── Fase 2: sugestão de destinação ────────────────────────────────────────────

type ItemForSuggestion = {
  conditionGradeId: string | null;
  category?: string | null;
  reason: string | null;
  hasWarranty?: boolean | null;
  hasAccessories?: boolean | null;
  defectReported?: string | null;
};

export interface DestinationSuggestion {
  destination: ReturnDestination;
  ruleId: string;
}

/** Sugere uma destinação a partir das regras configuradas pela empresa, por prioridade —
 *  determinístico e explicável (a regra vencedora é sempre a de maior prioridade cujas
 *  condições batem). Nunca decide sozinho: só alimenta a UI, a decisão final continua sendo
 *  return_items_decide_destination. */
export function suggestDestination(
  item: ItemForSuggestion,
  itemValue: number | null,
  rules: DestinationRule[]
): DestinationSuggestion | null {
  const sorted = [...rules].filter(r => r.active).sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.conditionGradeId && rule.conditionGradeId !== item.conditionGradeId) continue;
    if (rule.category && rule.category !== item.category) continue;
    if (rule.reason && rule.reason !== item.reason) continue;
    if (rule.minValue != null && (itemValue == null || itemValue < rule.minValue)) continue;
    if (rule.maxValue != null && (itemValue == null || itemValue > rule.maxValue)) continue;
    if (rule.requiresWarranty != null && rule.requiresWarranty !== (item.hasWarranty ?? null)) continue;
    if (rule.requiresAccessories != null && rule.requiresAccessories !== (item.hasAccessories ?? null)) continue;
    if (rule.defectReported && rule.defectReported !== item.defectReported) continue;
    return { destination: rule.suggestedDestination, ruleId: rule.id };
  }
  return null;
}

// ── Fase 2: aprovações configuráveis ──────────────────────────────────────────

type ItemForApprovalCheck = {
  destination: ReturnDestination;
  serialMismatch: boolean;
  hasChecklistException: boolean;
  suggestedDestination: ReturnDestination | null;
};

/** Espelha (só para a UI) os gates de aprovação que a RPC return_items_decide_destination
 *  aplica de verdade — quais tipos de aprovação essa decisão exigiria dado o settings da
 *  empresa. Retorna a lista de tipos ainda pendentes de aprovação. */
export function requiredApprovalTypes(
  item: ItemForApprovalCheck,
  itemValue: number | null,
  settings: Pick<ApprovalSettings,
    'requireApprovalDiscard' | 'requireApprovalRestock' | 'highValueThreshold' | 'requireApprovalHighValue' |
    'requireApprovalSerialMismatch' | 'requireApprovalChecklistException' | 'requireApprovalDestinationChange'> | null
): ApprovalType[] {
  if (!settings) return [];
  const types: ApprovalType[] = [];
  if (item.destination === 'discard' && settings.requireApprovalDiscard) types.push('discard');
  if (item.destination === 'restock' && settings.requireApprovalRestock) types.push('restock');
  if (settings.requireApprovalHighValue && settings.highValueThreshold != null && itemValue != null && itemValue >= settings.highValueThreshold) {
    types.push('high_value');
  }
  if (settings.requireApprovalSerialMismatch && item.serialMismatch) types.push('serial_mismatch');
  if (settings.requireApprovalChecklistException && item.hasChecklistException) types.push('checklist_exception');
  if (settings.requireApprovalDestinationChange && item.suggestedDestination && item.suggestedDestination !== item.destination) {
    types.push('destination_change');
  }
  return types;
}

/** Um item tem "exceção de checklist" quando qualquer um dos itens obrigatórios do checklist
 *  fixo falhou — mesma regra usada dentro da RPC. */
export function hasChecklistException(item: Pick<ReturnItem,
  'checklistCorrectProduct' | 'checklistPackagingIntact' | 'checklistNoVisibleDamage' |
  'checklistApparentlyFunctional' | 'checklistAccessoriesComplete' | 'checklistSerialMatches'>): boolean {
  return (
    item.checklistCorrectProduct === false || item.checklistPackagingIntact === false ||
    item.checklistNoVisibleDamage === false || item.checklistApparentlyFunctional === false ||
    item.checklistAccessoriesComplete === false || item.checklistSerialMatches === false
  );
}

// ── Fase 2: grades de condição ────────────────────────────────────────────────

export function findConditionGrade(grades: ConditionGrade[], id: string | null): ConditionGrade | null {
  if (!id) return null;
  return grades.find(g => g.id === id) ?? null;
}
