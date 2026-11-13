// Congelamento de produto — leitura do confronto com a fonte e escrita do estado.
//
// Camada de I/O: a regra vive em productFreezeRule.ts, sem Supabase. Aqui só se
// busca o que ela precisa e se grava o que foi decidido.
//
// ── Por que paginar ─────────────────────────────────────────────────────────
// O PostgREST devolve no máximo 1.000 linhas por requisição, e cala sobre o
// resto: uma leitura sem `.range()` sobre as 4.628 linhas do catálogo não dá
// erro — dá 1.000 linhas e um resultado calculado sobre uma amostra silenciosa.
// Seria o pior desfecho possível aqui: a tela diria "nenhum produto sumiu da
// fonte" porque nunca olhou os outros 3.628.

import { supabase } from '../supabase';
import {
  reconcileAgainstSource,
  type ReconciliationInput,
  type ReconciliationResult,
} from './productFreezeRule';

const FETCH_PAGE = 1000;

export type FreezeReason = 'sem_fonte_de_saldo' | 'manual';

interface ProductRow {
  id: string;
  sku: string | null;
  name: string | null;
  frozen_at: string | null;
}

/** Catálogo inteiro, paginado. A ordenação por `id` é o critério estável de
 *  desempate: sem ela, linhas podem repetir ou sumir na virada de bloco. */
async function loadCatalog(): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, frozen_at')
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as ProductRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

interface LinkRow {
  id: string;
  internal_id: string | null;
}

async function loadLinks(connectionId: string): Promise<LinkRow[]> {
  const rows: LinkRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('integration_entity_links')
      .select('id, internal_id')
      .eq('connection_id', connectionId)
      .eq('entity_type', 'product')
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as LinkRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

interface LevelRow {
  entity_link_id: string;
  observed_at: string | null;
}

async function loadLevels(connectionId: string): Promise<LevelRow[]> {
  const rows: LevelRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('integration_stock_levels')
      .select('entity_link_id, observed_at')
      .eq('connection_id', connectionId)
      .order('entity_link_id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as LevelRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

/**
 * Confronta o catálogo com o snapshot vigente da fonte.
 *
 * `snapshotObservedAt` é o MAIOR `observed_at` do snapshot, não a data da
 * importação: é ele que a importação carimbou em quem veio desta vez.
 */
export async function loadSourceReconciliation(connectionId: string): Promise<ReconciliationResult> {
  const [produtos, links, niveis] = await Promise.all([
    loadCatalog(),
    loadLinks(connectionId),
    loadLevels(connectionId),
  ]);

  const observedByLink = new Map<string, string>();
  let snapshotObservedAt: string | null = null;

  for (const nivel of niveis) {
    if (!nivel.observed_at) continue;
    // Mais de um registro da fonte no mesmo produto: vale o mais recente. Usar o
    // mais antigo sugeriria congelar um produto que a fonte ainda traz.
    const atual = observedByLink.get(nivel.entity_link_id);
    if (!atual || nivel.observed_at > atual) observedByLink.set(nivel.entity_link_id, nivel.observed_at);
    if (!snapshotObservedAt || nivel.observed_at > snapshotObservedAt) snapshotObservedAt = nivel.observed_at;
  }

  const observedByProduct = new Map<string, string>();
  const produtosComVinculo = new Set<string>();

  for (const link of links) {
    if (!link.internal_id) continue;
    produtosComVinculo.add(link.internal_id);
    const observed = observedByLink.get(link.id);
    if (!observed) continue;
    const atual = observedByProduct.get(link.internal_id);
    if (!atual || observed > atual) observedByProduct.set(link.internal_id, observed);
  }

  const entrada: ReconciliationInput[] = produtos.map(p => ({
    productId: p.id,
    sku: p.sku ?? '',
    name: p.name ?? '',
    hasSourceLink: produtosComVinculo.has(p.id),
    lastObservedAt: observedByProduct.get(p.id) ?? null,
    frozenAt: p.frozen_at,
  }));

  return reconcileAgainstSource(entrada, snapshotObservedAt);
}

/** Congela os produtos indicados. Operação em lote e idempotente: congelar quem
 *  já está congelado não muda nada, porque o filtro exclui esses. */
export async function freezeProducts(productIds: string[], reason: FreezeReason): Promise<number> {
  if (productIds.length === 0) return 0;

  const { data: userId } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('products')
    .update({
      frozen_at: new Date().toISOString(),
      frozen_reason: reason,
      frozen_by: userId?.user?.id ?? null,
    })
    .in('id', productIds)
    .is('frozen_at', null)
    .select('id');

  if (error) throw error;
  return (data ?? []).length;
}

/** Descongela. Os três campos voltam juntos a nulo — o CHECK da migration 127
 *  recusa data sem motivo e motivo sem data, então limpar só um daria erro. */
export async function unfreezeProducts(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('products')
    .update({ frozen_at: null, frozen_reason: null, frozen_by: null })
    .in('id', productIds)
    .not('frozen_at', 'is', null)
    .select('id');

  if (error) throw error;
  return (data ?? []).length;
}

export interface FrozenProduct {
  id: string;
  sku: string;
  name: string;
  frozenAt: string;
  frozenReason: FreezeReason;
}

/** Lista o que está congelado hoje — a tela de gestão e o aviso de "voltou à
 *  fonte" leem daqui. */
export async function listFrozenProducts(): Promise<FrozenProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, frozen_at, frozen_reason')
    .not('frozen_at', 'is', null)
    .order('frozen_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(r => {
    const row = r as { id: string; sku: string | null; name: string | null; frozen_at: string; frozen_reason: FreezeReason };
    return {
      id: row.id,
      sku: row.sku ?? '',
      name: row.name ?? '',
      frozenAt: row.frozen_at,
      frozenReason: row.frozen_reason,
    };
  });
}
