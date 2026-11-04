// Monta o livro-razão de UM produto a partir do que o banco já guarda.
//
// Nenhuma tabela nova, nenhuma migration, nenhuma escrita: a unificação acontece na
// leitura. Foi a decisão de projeto desta fatia — um razão que escrevesse lançamentos
// em paralelo criaria uma segunda verdade ao lado de `products.stock_quantity`, que
// ninguém concilia; e um razão que virasse a fonte do saldo reescreveria o núcleo do
// estoque. Ver o cabeçalho de `ledgerDomain.ts`.
//
// ── Por que por SKU, e não um feed geral ────────────────────────────────────
// A pergunta que a tela responde é "o que aconteceu com ESTE produto". Um feed de
// tudo exigiria paginar seis origens em conjunto, e o teto de 1.000 linhas do
// PostgREST transformaria qualquer leitura ampla numa amostra silenciosa. Recortado
// por produto, o volume é pequeno: o SKU com mais histórico de sincronização nesta
// base tem 14 eventos.
//
// Só SELECT. Este módulo não escreve em lugar nenhum.

import { supabase } from '../supabase';
import {
  ADJUSTMENT_APPLIED, ADJUSTMENT_STATUS_LABEL, BIN_MOVEMENT_LABEL, COUNT_RESULT_LABEL,
  RESTOCK_MOVEMENT, RETURN_DESTINATION_LABEL, mergeLedger, type LedgerEntry,
} from './ledgerDomain';

/** Teto por origem. Não é paginação: é uma trava para o dia em que um SKU tiver
 *  histórico fora do comum, para a tela não tentar desenhar milhares de linhas. A
 *  tela informa quando bateu no teto, em vez de calar. */
export const LIMITE_POR_ORIGEM = 200;

export interface ProductRef {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number | null;
}

/** Busca produtos por SKU ou nome. Usada pelo campo de busca da tela — o razão é por
 *  produto, então achar o produto é o primeiro passo da pergunta. */
export async function searchProducts(companyId: string, termo: string, limite = 20): Promise<ProductRef[]> {
  const limpo = termo.trim();
  if (limpo.length < 2) return [];

  // `or` com ilike nos dois campos: quem procura tanto digita o SKU quanto um pedaço
  // do nome, e obrigar a escolher antes seria obrigar a saber o que se procura.
  const escapado = limpo.replace(/[%,()]/g, ' ');
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, stock_quantity')
    .eq('company_id', companyId)
    .or(`sku.ilike.%${escapado}%,name.ilike.%${escapado}%`)
    .order('sku', { ascending: true })
    .limit(limite);

  if (error) throw error;
  return (data ?? []).map(p => ({
    id: p.id as string,
    sku: p.sku as string,
    name: p.name as string,
    stockQuantity: (p.stock_quantity as number | null) ?? null,
  }));
}

const numero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// ── Contagem física ─────────────────────────────────────────────────────────
// Item sem `physical_quantity` é sessão que incluiu o SKU e não chegou a contá-lo —
// não é um fato sobre o produto, é uma lista. Fica de fora.
//
// A data é `updated_at` do item: a RPC grava a quantidade e o carimbo na mesma
// operação, e não existe coluna própria de "contado em" aqui. É a mesma leitura que
// a Cobertura de Contagem já faz.
async function lerContagemFisica(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('physical_count_items')
    .select('id, session_id, physical_quantity, erp_quantity_snapshot, result_status, updated_at, found_location')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .not('physical_quantity', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  const linhas = data ?? [];
  if (linhas.length === 0) return [];

  // As sessões vêm numa segunda consulta em vez de um join embutido: são poucas, e
  // depender do nome da relação no PostgREST quebraria numa renomeação de chave.
  const sessoes = new Map<string, { from: string; to: string; status: string }>();
  const ids = [...new Set(linhas.map(l => l.session_id as string).filter(Boolean))];
  if (ids.length > 0) {
    const { data: ses } = await supabase
      .from('physical_count_sessions')
      .select('id, street_from, street_to, status')
      .in('id', ids);
    for (const s of ses ?? []) {
      sessoes.set(s.id as string, {
        from: (s.street_from as string) ?? '',
        to: (s.street_to as string) ?? '',
        status: (s.status as string) ?? '',
      });
    }
  }

  return linhas.map(l => {
    const contado = numero(l.physical_quantity);
    const sistema = numero(l.erp_quantity_snapshot);
    const sessao = sessoes.get(l.session_id as string);
    const origem = sessao && sessao.from ? `${sessao.from} → ${sessao.to}` : null;

    const partes: string[] = [];
    if (origem) partes.push(origem);
    if (l.result_status) partes.push(COUNT_RESULT_LABEL[l.result_status as string] ?? String(l.result_status));
    if (sistema !== null) partes.push(`o sistema marcava ${sistema}`);
    if (l.found_location) partes.push(`encontrado em ${l.found_location}`);

    return {
      key: `contagem:${l.id}`,
      source: 'contagem' as const,
      effect: 'registrou' as const,
      at: (l.updated_at as string) ?? '',
      title: 'Contagem física',
      detail: partes.length > 0 ? partes.join(' · ') : null,
      quantity: contado,
      quantityLabel: 'contado',
      divergence: contado !== null && sistema !== null ? contado - sistema : null,
      actor: null,
    };
  });
}

// ── Inventário por SKU ──────────────────────────────────────────────────────
async function lerInventario(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, counted_quantity, expected_quantity, divergence, counted_at, counted_by_name, observation, location')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .eq('status', 'counted')
    .not('counted_at', 'is', null)
    .order('counted_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  return (data ?? []).map(l => {
    const esperado = numero(l.expected_quantity);
    const partes: string[] = [];
    if (l.location) partes.push(String(l.location));
    if (esperado !== null) partes.push(`o sistema marcava ${esperado}`);
    if (l.observation) partes.push(String(l.observation));

    return {
      key: `inventario:${l.id}`,
      source: 'inventario' as const,
      effect: 'registrou' as const,
      at: (l.counted_at as string) ?? '',
      title: 'Inventário por SKU',
      detail: partes.length > 0 ? partes.join(' · ') : null,
      quantity: numero(l.counted_quantity),
      quantityLabel: 'contado',
      divergence: numero(l.divergence),
      actor: (l.counted_by_name as string) ?? null,
    };
  });
}

// ── Sincronização com o ERP ─────────────────────────────────────────────────
// A única origem que altera `products.stock_quantity` com frequência — e a que menos
// conta sobre si mesma: `previous_value` é nulo em todas as linhas desta base, então
// dá para mostrar em quanto o saldo ficou, nunca de quanto ele veio. A tela diz isso
// com todas as letras em vez de inventar um "de X para Y".
async function lerSincronizacao(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('integration_sync_items')
    .select('id, operation, status, new_value, processed_at, created_at, error_message')
    .eq('company_id', companyId)
    .eq('internal_id', productId)
    .eq('entity_type', 'stock')
    .order('created_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  return (data ?? []).map(l => {
    const status = (l.status as string) ?? '';
    const valor = (l.new_value ?? null) as { quantity?: unknown } | null;
    const aplicou = status === 'success';

    const partes: string[] = [];
    if (!aplicou) {
      partes.push(
        status === 'skipped' ? 'A sincronização ignorou este item'
        : status === 'conflict' ? 'Conflito entre o saldo daqui e o do ERP'
        : `Situação: ${status}`
      );
    }
    if (l.error_message) partes.push(String(l.error_message));

    return {
      key: `sync:${l.id}`,
      source: 'sincronizacao' as const,
      effect: aplicou ? ('moveu' as const) : ('nao_aplicado' as const),
      at: (l.processed_at as string) ?? (l.created_at as string) ?? '',
      title: aplicou ? 'O ERP gravou o saldo' : 'Sincronização sem efeito',
      detail: partes.length > 0 ? partes.join(' · ') : null,
      quantity: numero(valor?.quantity),
      quantityLabel: aplicou ? 'ficou em' : 'tentou gravar',
      divergence: null,
      actor: null,
    };
  });
}

// ── Logística reversa ───────────────────────────────────────────────────────
async function lerDevolucoes(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('return_stock_movements')
    .select('id, movement_type, origin_location, destination_location, quantity, reason, created_at')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  return (data ?? []).map(l => {
    const tipo = (l.movement_type as string) ?? '';
    const voltou = tipo === RESTOCK_MOVEMENT;
    const qtd = numero(l.quantity);

    const partes: string[] = [];
    if (l.destination_location) partes.push(`destino: ${l.destination_location}`);
    if (l.reason) partes.push(String(l.reason));
    if (!voltou) partes.push('não entrou no saldo vendável');

    return {
      key: `devolucao:${l.id}`,
      source: 'devolucao' as const,
      effect: voltou ? ('moveu' as const) : ('registrou' as const),
      at: (l.created_at as string) ?? '',
      title: RETURN_DESTINATION_LABEL[tipo] ?? 'Movimento de devolução',
      detail: partes.length > 0 ? partes.join(' · ') : null,
      quantity: qtd,
      quantityLabel: voltou && qtd !== null ? 'somado ao saldo' : 'peças',
      divergence: null,
      actor: null,
    };
  });
}

// ── Ajuste enviado ao ERP ───────────────────────────────────────────────────
// É o passo que fecha o ciclo da contagem: sem ele, a divergência apurada fica só
// registrada aqui e o estoque do ERP continua errado.
async function lerAjustes(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('integration_stock_adjustments')
    .select('id, previous_quantity, counted_quantity, delta_quantity, sync_status, origin, reason, created_at, sent_at, confirmed_at, error_message')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  return (data ?? []).map(l => {
    const status = (l.sync_status as string) ?? '';
    const aplicou = ADJUSTMENT_APPLIED.includes(status);
    const antes = numero(l.previous_quantity);
    const depois = numero(l.counted_quantity);

    const partes: string[] = [ADJUSTMENT_STATUS_LABEL[status] ?? status];
    if (antes !== null && depois !== null) partes.push(`de ${antes} para ${depois}`);
    if (l.reason) partes.push(String(l.reason));
    if (l.error_message) partes.push(String(l.error_message));

    return {
      key: `ajuste:${l.id}`,
      source: 'ajuste' as const,
      effect: aplicou ? ('moveu' as const) : ('nao_aplicado' as const),
      at: (l.confirmed_at as string) ?? (l.sent_at as string) ?? (l.created_at as string) ?? '',
      title: 'Ajuste de estoque no ERP',
      detail: partes.join(' · '),
      quantity: numero(l.delta_quantity),
      quantityLabel: 'diferença',
      divergence: null,
      actor: null,
    };
  });
}

// ── Movimentação entre endereços ────────────────────────────────────────────
// Muda onde a peça está, não quanto existe.
async function lerEnderecos(companyId: string, productId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('warehouse_bin_movements')
    .select('id, movement_type, from_bin_id, to_bin_id, boxes, units_per_box, reason, created_at')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_POR_ORIGEM);
  if (error) throw error;

  return (data ?? []).map(l => {
    const caixas = numero(l.boxes);
    const porCaixa = numero(l.units_per_box);
    const partes: string[] = [];
    if (caixas !== null && porCaixa !== null) partes.push(`${caixas} caixa(s) de ${porCaixa}`);
    if (l.reason) partes.push(String(l.reason));

    return {
      key: `endereco:${l.id}`,
      source: 'endereco' as const,
      effect: 'registrou' as const,
      at: (l.created_at as string) ?? '',
      title: BIN_MOVEMENT_LABEL[(l.movement_type as string) ?? ''] ?? 'Movimentação de endereço',
      detail: partes.length > 0 ? partes.join(' · ') : null,
      quantity: caixas !== null && porCaixa !== null ? caixas * porCaixa : null,
      quantityLabel: 'peças',
      divergence: null,
      actor: null,
    };
  });
}

export interface ProductLedger {
  entries: LedgerEntry[];
  /** Origens que falharam ao carregar. A tela mostra o que conseguiu ler e diz o que
   *  faltou: esconder uma origem indisponível transformaria um razão incompleto num
   *  razão aparentemente completo, que é pior do que não ter razão nenhum. */
  indisponiveis: string[];
  /** Origens que bateram no teto de linhas — o histórico mostrado está cortado. */
  truncadas: string[];
}

export async function fetchProductLedger(companyId: string, productId: string): Promise<ProductLedger> {
  const origens: { nome: string; ler: () => Promise<LedgerEntry[]> }[] = [
    { nome: 'Contagem física', ler: () => lerContagemFisica(companyId, productId) },
    { nome: 'Inventário por SKU', ler: () => lerInventario(companyId, productId) },
    { nome: 'Sincronização com o ERP', ler: () => lerSincronizacao(companyId, productId) },
    { nome: 'Logística reversa', ler: () => lerDevolucoes(companyId, productId) },
    { nome: 'Ajustes enviados ao ERP', ler: () => lerAjustes(companyId, productId) },
    { nome: 'Movimentação de endereços', ler: () => lerEnderecos(companyId, productId) },
  ];

  const resultados = await Promise.all(
    origens.map(async o => {
      try {
        return { nome: o.nome, linhas: await o.ler(), ok: true };
      } catch (err) {
        // Uma origem fora do ar não derruba o razão inteiro: as outras cinco ainda
        // respondem a maior parte da pergunta.
        console.error(`[Livro-razão] ${o.nome}`, err);
        return { nome: o.nome, linhas: [] as LedgerEntry[], ok: false };
      }
    })
  );

  return {
    entries: mergeLedger(resultados.flatMap(r => r.linhas)),
    indisponiveis: resultados.filter(r => !r.ok).map(r => r.nome),
    truncadas: resultados.filter(r => r.ok && r.linhas.length >= LIMITE_POR_ORIGEM).map(r => r.nome),
  };
}
