// Livro-razão do SKU — as regras de leitura, sem nenhum acesso a dados.
//
// ── O que este módulo é, e o que ele não é ──────────────────────────────────
// É uma LINHA DO TEMPO: reúne o que os subsistemas já gravam sobre um produto e põe
// tudo em ordem. Não é partida dobrada, não recalcula saldo e não escreve em lugar
// nenhum. A diferença importa porque o InventoryBlind não tem um "movimento de
// estoque" único: cada subsistema guarda o próprio registro, e vários deles registram
// fatos que nunca mexeram no saldo.
//
// ── O que de fato altera `products.stock_quantity` ──────────────────────────
// Dois caminhos, conferidos na definição viva do banco e no código de sincronização:
//
//   1. Devolução cujo destino decidido é "Estoque Vendável" (`restock`). Qualquer
//      outro destino — quarentena, avaria, descarte, devolução ao fornecedor — grava
//      o movimento e NÃO toca no saldo.
//   2. Sincronização com o ERP, quando o item sincronizado terminou em `success`.
//      `skipped` e `conflict` não aplicaram nada.
//
// Contagem física e inventário por SKU NÃO alteram o saldo: apuram a divergência e
// param ali. Mandar o ajuste ao ERP é um passo separado e explícito.
//
// É por isso que todo lançamento carrega um `effect`. Sem ele, a linha do tempo
// insinuaria que toda contagem mexeu no estoque — que é exatamente a confusão que um
// livro-razão deveria desfazer.

/** De onde o lançamento veio. Um por subsistema que registra algo sobre o produto. */
export type LedgerSource =
  | 'contagem'      // contagem física (sessão)
  | 'inventario'    // inventário por SKU
  | 'sincronizacao' // o ERP escreveu o saldo
  | 'devolucao'     // logística reversa
  | 'ajuste'        // ajuste de estoque enviado ao ERP
  | 'endereco';     // movimentação entre endereços do galpão

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  contagem: 'Contagem física',
  inventario: 'Inventário por SKU',
  sincronizacao: 'Sincronização com o ERP',
  devolucao: 'Logística reversa',
  ajuste: 'Ajuste enviado ao ERP',
  endereco: 'Movimentação de endereço',
};

/** O que o lançamento fez com o saldo. É a informação que separa um livro-razão
 *  honesto de uma lista que parece dizer mais do que sabe. */
export type BalanceEffect =
  /** Alterou a quantidade em estoque. */
  | 'moveu'
  /** Registrou um fato (contagem, conferência, troca de endereço) sem alterar o saldo. */
  | 'registrou'
  /** Tentou e não valeu: sincronização ignorada ou em conflito, ajuste ainda não enviado. */
  | 'nao_aplicado';

export const EFFECT_LABEL: Record<BalanceEffect, string> = {
  moveu: 'Alterou o saldo',
  registrou: 'Não alterou o saldo',
  nao_aplicado: 'Não aplicado',
};

export interface LedgerEntry {
  /** Único entre as origens: os ids vêm de tabelas diferentes e poderiam colidir. */
  key: string;
  source: LedgerSource;
  effect: BalanceEffect;
  /** Quando o fato aconteceu, em ISO. */
  at: string;
  /** A frase principal da linha. */
  title: string;
  /** Contexto de uma linha, quando existe algo a explicar. */
  detail: string | null;
  /** A quantidade envolvida. `null` quando a origem não guarda uma. */
  quantity: number | null;
  /** Como ler o número — "contado", "ficou em", "+3". A unidade de medida do
   *  lançamento muda com a origem, e um número sem rótulo seria adivinhação. */
  quantityLabel: string | null;
  /** Diferença apurada entre o que o sistema dizia e o que foi encontrado. Só as
   *  origens que contam têm isso; `null` nas demais. Campo próprio, e não um texto
   *  dentro de `detail`, porque é usado para decidir alerta — procurar uma palavra
   *  numa frase de tela quebraria no dia em que a frase mudasse. */
  divergence: number | null;
  /** Quem fez, quando a origem registra. */
  actor: string | null;
}

/** Destino de devolução que devolve a peça ao estoque vendável — o único dos sete que
 *  soma ao saldo (`return_items_decide_destination`, migration 083: o UPDATE em
 *  products está dentro de `IF p_destination = 'restock'`).
 *
 *  Comparado pelo `movement_type` e não pelo nome do local: o local é texto de
 *  apresentação ("Estoque Vendável") e mudaria numa troca de redação, enquanto o tipo
 *  é travado por CHECK no banco. */
export const RESTOCK_MOVEMENT = 'restock';

export const RETURN_DESTINATION_LABEL: Record<string, string> = {
  restock: 'Devolvido ao estoque vendável',
  quarantine: 'Enviado para quarentena',
  damaged_stock: 'Enviado para estoque de avariados',
  technical_assistance: 'Enviado para assistência técnica',
  refurbishment: 'Enviado para recondicionamento',
  return_to_supplier: 'Devolvido ao fornecedor',
  discard: 'Descartado',
};

export const BIN_MOVEMENT_LABEL: Record<string, string> = {
  entrada: 'Entrada em endereço',
  saida: 'Saída de endereço',
  transferencia: 'Transferência entre endereços',
};

export const COUNT_RESULT_LABEL: Record<string, string> = {
  ok: 'Sem divergência',
  missing: 'Falta',
  surplus: 'Sobra',
};

/** Situações do ajuste enviado ao ERP. `confirmed` e `sent` já alteraram o saldo lá;
 *  o resto não saiu daqui. */
export const ADJUSTMENT_APPLIED: readonly string[] = ['sent', 'confirmed'];

export const ADJUSTMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando envio',
  sent: 'Enviado ao ERP',
  confirmed: 'Confirmado pelo ERP',
  failed: 'Falhou ao enviar',
  skipped: 'Ignorado',
};

/** Mais recente primeiro. Empate desempata pela chave, para a ordem não depender de
 *  qual consulta voltou antes — duas origens podem gravar no mesmo instante. */
export function mergeLedger(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

export interface LedgerSummary {
  total: number;
  moveram: number;
  registraram: number;
  naoAplicados: number;
  /** O último lançamento que de fato mexeu no saldo. `null` se nenhum mexeu. */
  ultimoMovimento: LedgerEntry | null;
  /** A última contagem (física ou inventário). `null` se o SKU nunca foi contado. */
  ultimaContagem: LedgerEntry | null;
}

export function summarize(entries: LedgerEntry[]): LedgerSummary {
  const ordenados = mergeLedger(entries);
  return {
    total: ordenados.length,
    moveram: ordenados.filter(e => e.effect === 'moveu').length,
    registraram: ordenados.filter(e => e.effect === 'registrou').length,
    naoAplicados: ordenados.filter(e => e.effect === 'nao_aplicado').length,
    ultimoMovimento: ordenados.find(e => e.effect === 'moveu') ?? null,
    ultimaContagem:
      ordenados.find(e => e.source === 'contagem' || e.source === 'inventario') ?? null,
  };
}

/** Diz se há uma divergência apurada que nunca virou ajuste.
 *
 *  É a pergunta que justifica a tela existir: contar e não ajustar é o modo silencioso
 *  de o estoque continuar errado depois do trabalho todo de contar. Só vale quando a
 *  contagem é mais recente que o último ajuste — ajustar e contar de novo depois é o
 *  fluxo correto, não um alerta. */
export function contagemSemAjuste(entries: LedgerEntry[]): LedgerEntry | null {
  const ordenados = mergeLedger(entries);
  const contagem = ordenados.find(
    e => (e.source === 'contagem' || e.source === 'inventario')
      && e.divergence !== null && e.divergence !== 0
  );
  if (!contagem) return null;

  const ajuste = ordenados.find(e => e.source === 'ajuste' && e.effect === 'moveu');
  if (ajuste && ajuste.at > contagem.at) return null;
  return contagem;
}
