// Retiradas Full — camada de I/O. Mesmo espírito de reverseLogisticsService.ts:
// nunca escreve em `products` (só lê, por FK opcional, para localizar o que está
// sendo retirado do Full).

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type {
  FullWithdrawalPlan, FullWithdrawalItem, FullWithdrawalEvent,
  FullWithdrawalStatus, FullWithdrawalReason, FullWithdrawalMethod,
  WithdrawalCandidateProduct,
} from './fullWithdrawalTypes';

export { fetchReturnUserNames as fetchFullWithdrawalUserNames } from './reverseLogisticsService';

interface PlanRow {
  id: string; company_id: string; code: string; status: FullWithdrawalStatus;
  reason: FullWithdrawalReason | null; method: FullWithdrawalMethod;
  destination_label: string | null; destination_address: string | null;
  ml_reference: string | null; cost: number | string | null; cost_note: string | null;
  expected_delivery_date: string | null; notes: string | null;
  ml_confirmed_at: string | null; reserved_at: string | null; preparing_at: string | null;
  shipped_at: string | null; received_at: string | null; conferred_at: string | null;
  cancellation_reason: string | null; status_changed_by: string | null; status_changed_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

interface ItemRow {
  id: string; plan_id: string; company_id: string; product_id: string | null; sku: string | null;
  description: string; planned_quantity: number | string; confirmed_quantity: number | string | null;
  received_quantity: number | string | null; situation: FullWithdrawalItem['situation'];
  divergence_note: string | null; divergence_noted_by: string | null; divergence_noted_at: string | null;
  created_at: string; updated_at: string;
}

interface EventRow {
  id: string; plan_id: string; company_id: string; event_type: FullWithdrawalEvent['eventType'];
  occurred_at: string; created_by: string | null; note: string | null;
}

function planFromRow(row: PlanRow): FullWithdrawalPlan {
  return {
    id: row.id, companyId: row.company_id, code: row.code, status: row.status,
    reason: row.reason, method: row.method,
    destinationLabel: row.destination_label, destinationAddress: row.destination_address,
    mlReference: row.ml_reference, cost: row.cost !== null ? Number(row.cost) : null, costNote: row.cost_note,
    expectedDeliveryDate: row.expected_delivery_date, notes: row.notes,
    mlConfirmedAt: row.ml_confirmed_at, reservedAt: row.reserved_at, preparingAt: row.preparing_at,
    shippedAt: row.shipped_at, receivedAt: row.received_at, conferredAt: row.conferred_at,
    cancellationReason: row.cancellation_reason, statusChangedBy: row.status_changed_by, statusChangedAt: row.status_changed_at,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ItemRow): FullWithdrawalItem {
  return {
    id: row.id, planId: row.plan_id, companyId: row.company_id, productId: row.product_id, sku: row.sku,
    description: row.description, plannedQuantity: Number(row.planned_quantity),
    confirmedQuantity: row.confirmed_quantity !== null ? Number(row.confirmed_quantity) : null,
    receivedQuantity: row.received_quantity !== null ? Number(row.received_quantity) : null,
    situation: row.situation, divergenceNote: row.divergence_note,
    divergenceNotedBy: row.divergence_noted_by, divergenceNotedAt: row.divergence_noted_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function eventFromRow(row: EventRow): FullWithdrawalEvent {
  return {
    id: row.id, planId: row.plan_id, companyId: row.company_id, eventType: row.event_type,
    occurredAt: row.occurred_at, createdBy: row.created_by, note: row.note,
  };
}

// ── Listagem e detalhe ───────────────────────────────────────────────────────

export async function listFullWithdrawalPlans(companyId: string): Promise<FullWithdrawalPlan[]> {
  const { data, error } = await supabase
    .from('full_withdrawal_plans').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(planFromRow);
}

export async function getFullWithdrawalPlan(id: string): Promise<FullWithdrawalPlan | null> {
  const { data, error } = await supabase.from('full_withdrawal_plans').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? planFromRow(data) : null;
}

export async function getFullWithdrawalItems(planId: string): Promise<FullWithdrawalItem[]> {
  const { data, error } = await supabase
    .from('full_withdrawal_items').select('*').eq('plan_id', planId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(itemFromRow);
}

/** Itens de vários planos de uma vez, só quantidade planejada — evita N+1 na
 *  listagem central (coluna "SKUs"/"Unidades"). */
export async function listItemsForPlans(planIds: string[]): Promise<Pick<FullWithdrawalItem, 'id' | 'planId' | 'plannedQuantity'>[]> {
  if (planIds.length === 0) return [];
  const { data, error } = await supabase
    .from('full_withdrawal_items').select('id, plan_id, planned_quantity').in('plan_id', planIds);
  if (error) throw error;
  return (data ?? []).map(r => ({ id: r.id, planId: r.plan_id, plannedQuantity: Number(r.planned_quantity) }));
}

export async function getFullWithdrawalEvents(planId: string): Promise<FullWithdrawalEvent[]> {
  const { data, error } = await supabase
    .from('full_withdrawal_events').select('*').eq('plan_id', planId).order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(eventFromRow);
}

/** Catálogo real de produtos para a etapa "Selecionar estoque" — nunca inclui
 *  saldo/antiguidade do Full (não existe conector real do Mercado Livre neste
 *  projeto hoje, ver nota na migration 096). */
export async function searchWithdrawalCandidates(term: string, limit = 30): Promise<WithdrawalCandidateProduct[]> {
  const q = term.trim();
  let query = supabase.from('products').select('id, name, sku, ean, location, stock_quantity').order('name', { ascending: true }).limit(limit);
  if (q !== '') {
    const pattern = `%${q.replace(/[%_]/g, '')}%`;
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},ean.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(p => ({ id: p.id, name: p.name, sku: p.sku, ean: p.ean, location: p.location, systemStock: p.stock_quantity ?? 0 }));
}

// ── Rascunho ─────────────────────────────────────────────────────────────────

export interface DraftPlanItemInput {
  productId: string | null;
  sku: string | null;
  description: string;
  plannedQuantity: number;
}

export interface DraftPlanInput {
  companyId: string;
  reason: FullWithdrawalReason | null;
  method: FullWithdrawalMethod;
  destinationLabel: string | null;
  destinationAddress: string | null;
  notes: string | null;
  items: DraftPlanItemInput[];
}

/** Cria ou atualiza um rascunho — sempre substitui os itens (delete + insert),
 *  o suficiente enquanto o plano só é editável em `draft`. Nunca chamada fora
 *  desse estado (a UI só reabre o assistente para planos em rascunho). */
export async function saveDraftPlan(
  existingId: string | null,
  input: DraftPlanInput,
  userId: string,
  userEmail: string,
): Promise<FullWithdrawalPlan> {
  let plan: FullWithdrawalPlan;

  if (existingId) {
    const { data, error } = await supabase
      .from('full_withdrawal_plans')
      .update({
        reason: input.reason, method: input.method, destination_label: input.destinationLabel,
        destination_address: input.destinationAddress, notes: input.notes, updated_at: new Date().toISOString(),
      })
      .eq('id', existingId)
      .select().single();
    if (error || !data) throw error ?? new Error('Falha ao salvar o rascunho.');
    plan = planFromRow(data);
    const { error: delErr } = await supabase.from('full_withdrawal_items').delete().eq('plan_id', existingId);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await supabase
      .from('full_withdrawal_plans')
      .insert({
        company_id: input.companyId, reason: input.reason, method: input.method,
        destination_label: input.destinationLabel, destination_address: input.destinationAddress, notes: input.notes,
      })
      .select().single();
    if (error || !data) throw error ?? new Error('Falha ao criar o rascunho.');
    plan = planFromRow(data);
    await logAuditEvent({
      companyId: input.companyId, userId, userEmail, action: 'reverse_logistics.full_withdrawal_created',
      resourceType: 'full_withdrawal_plans', resourceId: plan.id, metadata: { code: plan.code },
    });
  }

  if (input.items.length > 0) {
    const rows = input.items.map(it => ({
      plan_id: plan.id, company_id: input.companyId, product_id: it.productId, sku: it.sku,
      description: it.description, planned_quantity: it.plannedQuantity,
    }));
    const { error: itemsErr } = await supabase.from('full_withdrawal_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }

  return plan;
}

// ── Transições e decisões (RPC) ───────────────────────────────────────────────

export async function advanceFullWithdrawalStatus(
  planId: string,
  toStatus: FullWithdrawalStatus,
  note?: string,
): Promise<FullWithdrawalPlan> {
  const { data, error } = await supabase.rpc('full_withdrawal_advance_status', {
    p_plan_id: planId, p_to_status: toStatus, p_note: note ?? null,
  });
  if (error) throw error;
  return planFromRow(data as PlanRow);
}

/** "Vincular retirada do ML" — o único caminho real para 'reserved', porque
 *  não existe correlação automática (sem conector do Mercado Livre hoje). */
export async function linkFullWithdrawalMl(
  planId: string,
  mlReference: string,
  cost?: number | null,
  expectedDeliveryDate?: string | null,
): Promise<FullWithdrawalPlan> {
  const { data, error } = await supabase.rpc('full_withdrawal_link_ml', {
    p_plan_id: planId, p_ml_reference: mlReference, p_cost: cost ?? null, p_expected_delivery_date: expectedDeliveryDate ?? null,
  });
  if (error) throw error;
  return planFromRow(data as PlanRow);
}

/** Registra a quantidade fisicamente contada — o campo nunca chega pré-preenchido do cliente. */
export async function conferFullWithdrawalItem(itemId: string, receivedQuantity: number, note?: string): Promise<FullWithdrawalItem> {
  const { data, error } = await supabase.rpc('full_withdrawal_conference_item', {
    p_item_id: itemId, p_received_quantity: receivedQuantity, p_note: note ?? null,
  });
  if (error) throw error;
  return itemFromRow(data as ItemRow);
}

export async function justifyFullWithdrawalDivergence(itemId: string, note: string): Promise<FullWithdrawalItem> {
  const { data, error } = await supabase.rpc('full_withdrawal_justify_divergence', {
    p_item_id: itemId, p_note: note,
  });
  if (error) throw error;
  return itemFromRow(data as ItemRow);
}
