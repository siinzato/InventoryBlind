// Ondas de separação: a camada entre a tela e o banco.
//
// ── O que NÃO mora aqui ───────────────────────────────────────────────────────
// Regra de negócio. Reservar, separar, declarar ruptura, realocar e fechar a onda são
// decisões do banco (migrations 138 e 139), onde a invariante de saldo não dá para
// contornar. Este arquivo chama, tipa e traduz o erro — nada mais. Qualquer cálculo de
// quanto reservar ou de quem pode separar que aparecer aqui é uma segunda fonte da
// verdade esperando divergir da primeira.
//
// ── Por que `db` e não `supabase` ─────────────────────────────────────────────
// `db` é o MESMO cliente com o schema real anexado. Aqui o compilador confere nome de
// tabela, de coluna e de argumento de RPC contra o banco. Em estoque, coluna renomeada
// que vira `undefined` em silêncio não é tela quebrada — é furo de inventário.
//
// ── Isolamento entre empresas ─────────────────────────────────────────────────
// Nenhuma função daqui filtra por empresa, e isso é deliberado: as quatro tabelas têm
// RLS com `company_id = get_my_company_id()`, a view da rota é `security_invoker`, e as
// RPCs são `SECURITY DEFINER` que começam por `wms_require_operator()`. Filtrar também
// no cliente criaria a ilusão de que a garantia mora aqui — e no dia em que alguém
// esquecesse o filtro, a tela entregaria dado alheio sem nada acusar.
//
// Nomes em português seguem o vocabulário do domínio e das RPCs (onda, parada, ruptura),
// como o resto do módulo 3D. `wmsService.ts`, mais antigo, usa nomes em inglês.

import { db } from '../supabase';
import type { Database } from '../database.types';

type WaveRow  = Database['public']['Tables']['picking_waves']['Row'];
type ItemRow  = Database['public']['Tables']['picking_wave_items']['Row'];
type RouteRow = Database['public']['Views']['picking_wave_route_v']['Row'];

// ── Vocabulário ───────────────────────────────────────────────────────────────

export type EstadoDaOnda =
  | 'rascunho' | 'reservada' | 'em_separacao' | 'concluida' | 'parcial' | 'cancelada';

export type OrigemDaOnda = 'manual' | 'importacao' | 'plano_full';

export type EstadoDoItem = 'pendente' | 'alocado' | 'parcial' | 'atendido' | 'sem_saldo';

export type EstadoDaParada = 'pendente' | 'separado' | 'parcial' | 'ruptura' | 'cancelado';

export type OrigemDaLeitura = 'scanner' | 'camera' | 'manual';

export const ROTULO_DO_ESTADO: Record<EstadoDaOnda, string> = {
  rascunho:     'Rascunho',
  reservada:    'Reservada',
  em_separacao: 'Em separação',
  concluida:    'Concluída',
  parcial:      'Concluída com falta',
  cancelada:    'Cancelada',
};

export interface Onda {
  id: string;
  codigo: string;
  estado: EstadoDaOnda;
  origem: OrigemDaOnda;
  origemRef: string | null;
  responsavel: string | null;
  observacao: string | null;
  criadaEm: string;
  reservadaEm: string | null;
  iniciadaEm: string | null;
  encerradaEm: string | null;
}

export interface ItemDaOnda {
  id: string;
  produtoId: string;
  sku: string;
  demandadas: number;
  alocadas: number;
  separadas: number;
  estado: EstadoDoItem;
}

/** Uma parada da rota: endereço, o que pegar lá e quanto já saiu. */
export interface ParadaDaOnda {
  alocacaoId: string;
  sequencia: number;
  estado: EstadoDaParada;
  endereco: string;
  enderecoBloqueado: boolean;
  itemId: string;
  produtoId: string;
  sku: string;
  produto: string;
  ean: string | null;
  caixas: number;
  separadas: number;
  restantes: number;
  unidadesPorCaixa: number | null;
  guardadoDesde: string | null;
}

export interface CandidatoDeProduto {
  produtoId: string;
  sku: string;
  nome: string;
  ean: string | null;
}

// ── Conversões ────────────────────────────────────────────────────────────────

const daOnda = (r: WaveRow): Onda => ({
  id: r.id,
  codigo: r.code,
  estado: r.status as EstadoDaOnda,
  origem: r.origin as OrigemDaOnda,
  origemRef: r.origin_ref,
  responsavel: r.assigned_to,
  observacao: r.notes,
  criadaEm: r.created_at,
  reservadaEm: r.reserved_at,
  iniciadaEm: r.started_at,
  encerradaEm: r.finished_at,
});

const doItem = (r: ItemRow): ItemDaOnda => ({
  id: r.id,
  produtoId: r.product_id,
  sku: r.sku,
  demandadas: r.boxes_demandadas,
  alocadas: r.boxes_alocadas,
  separadas: r.boxes_separadas,
  estado: r.status as EstadoDoItem,
});

/**
 * A view devolve quase tudo anulável porque é view — mas a parada só existe quando a
 * alocação existe, e aí os campos de chave estão lá. Descartar a linha incompleta é mais
 * honesto que preencher com zero: parada sem endereço mandaria o operador a lugar nenhum.
 */
const daParada = (r: RouteRow): ParadaDaOnda | null => {
  if (!r.allocation_id || !r.bin_code || !r.item_id || !r.product_id) return null;
  return {
    alocacaoId: r.allocation_id,
    sequencia: r.sequencia ?? 0,
    estado: (r.allocation_status ?? 'pendente') as EstadoDaParada,
    endereco: r.bin_code,
    enderecoBloqueado: r.bin_blocked ?? false,
    itemId: r.item_id,
    produtoId: r.product_id,
    sku: r.sku ?? '',
    produto: r.product_name ?? '',
    ean: r.ean,
    caixas: r.boxes ?? 0,
    separadas: r.boxes_separadas ?? 0,
    restantes: r.boxes_restantes ?? 0,
    unidadesPorCaixa: r.units_per_box,
    guardadoDesde: r.first_stored_at,
  };
};

/** Erro de RPC chega como mensagem do Postgres — que é escrita para o operador ler. */
const falhar = (mensagem: string | undefined, padrao: string): never => {
  throw new Error(mensagem && mensagem.trim() ? mensagem : padrao);
};

/** `jsonb` chega como `Json`. Ler campo a campo é o preço de não fingir um tipo. */
const campo = (dado: unknown, chave: string): unknown =>
  dado && typeof dado === 'object' && !Array.isArray(dado)
    ? (dado as Record<string, unknown>)[chave]
    : undefined;

const numero = (dado: unknown, chave: string): number => {
  const v = campo(dado, chave);
  return typeof v === 'number' ? v : 0;
};

const texto = (dado: unknown, chave: string): string | null => {
  const v = campo(dado, chave);
  return typeof v === 'string' ? v : null;
};

// ── Leitura ───────────────────────────────────────────────────────────────────

export async function listarOndas(limite = 50): Promise<Onda[]> {
  const { data, error } = await db
    .from('picking_waves')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []).map(daOnda);
}

export async function ondasAbertas(): Promise<Onda[]> {
  const { data, error } = await db
    .from('picking_waves')
    .select('*')
    .in('status', ['rascunho', 'reservada', 'em_separacao'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(daOnda);
}

export async function itensDaOnda(ondaId: string): Promise<ItemDaOnda[]> {
  const { data, error } = await db
    .from('picking_wave_items')
    .select('*')
    .eq('wave_id', ondaId)
    .order('sku', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(doItem);
}

/**
 * A rota, na ordem de caminhada.
 *
 * `sequencia` já vem calculada pelo banco (rua → módulo → nível). Reordenar aqui seria a
 * segunda opinião que desalinha a lista do operador do traçado do 3D.
 */
export async function rotaDaOnda(ondaId: string): Promise<ParadaDaOnda[]> {
  const { data, error } = await db
    .from('picking_wave_route_v')
    .select('*')
    .eq('wave_id', ondaId)
    .order('sequencia', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(daParada).filter((p): p is ParadaDaOnda => p !== null);
}

export interface DetalheDaOnda {
  onda: Onda;
  itens: ItemDaOnda[];
  rota: ParadaDaOnda[];
}

export async function detalheDaOnda(ondaId: string): Promise<DetalheDaOnda | null> {
  const { data, error } = await db
    .from('picking_waves')
    .select('*')
    .eq('id', ondaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [itens, rota] = await Promise.all([itensDaOnda(ondaId), rotaDaOnda(ondaId)]);
  return { onda: daOnda(data), itens, rota };
}

/** Só as paradas que ainda têm o que separar — é a lista que o operador percorre. */
export const paradasPendentes = (rota: readonly ParadaDaOnda[]): ParadaDaOnda[] =>
  rota.filter(p => (p.estado === 'pendente' || p.estado === 'parcial') && p.restantes > 0);

// ── Montagem ──────────────────────────────────────────────────────────────────

export async function criarOnda(params: {
  origem?: OrigemDaOnda;
  origemRef?: string | null;
  observacao?: string | null;
} = {}): Promise<string> {
  const { data, error } = await db.rpc('picking_wave_create', {
    p_origin: params.origem ?? 'manual',
    p_origin_ref: params.origemRef ?? undefined,
    p_notes: params.observacao ?? undefined,
  });
  if (error) falhar(error.message, 'Não foi possível criar a onda.');
  return data as string;
}

/**
 * Quem é este código?
 *
 * Devolve lista, no plural, porque o cadastro tem EANs repetidos entre produtos — foram
 * medidos 199. Escolher o primeiro em silêncio é separar o produto errado com a bênção
 * do sistema.
 */
export async function resolverProduto(codigo: string): Promise<CandidatoDeProduto[]> {
  const { data, error } = await db.rpc('picking_resolve_product', { p_code: codigo });
  if (error) falhar(error.message, 'Não foi possível consultar o produto.');

  const lista = campo(data, 'candidatos');
  if (!Array.isArray(lista)) return [];

  return lista.map(c => ({
    produtoId: String(campo(c, 'product_id') ?? ''),
    sku: String(campo(c, 'sku') ?? ''),
    nome: String(campo(c, 'name') ?? ''),
    ean: typeof campo(c, 'ean') === 'string' ? (campo(c, 'ean') as string) : null,
  })).filter(c => c.produtoId !== '');
}

export async function adicionarItem(
  ondaId: string, produtoId: string, caixas: number,
): Promise<string> {
  const { data, error } = await db.rpc('picking_wave_add_item', {
    p_wave_id: ondaId, p_product_id: produtoId, p_boxes: caixas,
  });
  if (error) falhar(error.message, 'Não foi possível adicionar o item.');
  return data as string;
}

export async function removerItem(itemId: string): Promise<boolean> {
  const { data, error } = await db.rpc('picking_wave_remove_item', { p_item_id: itemId });
  if (error) falhar(error.message, 'Não foi possível remover o item.');
  return data === true;
}

/**
 * O resultado de tentar incluir UMA linha da lista colada.
 *
 * Ambiguidade é resultado, não erro: a tela precisa dos candidatos para perguntar qual,
 * e um `throw` deixaria a importação inteira parada numa linha que só precisa de escolha.
 */
export type ResultadoDeInclusao =
  | { status: 'adicionado'; itemId: string; candidato: CandidatoDeProduto }
  | { status: 'ambiguo'; candidatos: CandidatoDeProduto[] }
  | { status: 'nao_encontrado' };

export async function adicionarPorCodigo(
  ondaId: string, codigo: string, caixas: number,
): Promise<ResultadoDeInclusao> {
  const candidatos = await resolverProduto(codigo);

  if (candidatos.length === 0) return { status: 'nao_encontrado' };
  if (candidatos.length > 1) return { status: 'ambiguo', candidatos };

  const itemId = await adicionarItem(ondaId, candidatos[0].produtoId, caixas);
  return { status: 'adicionado', itemId, candidato: candidatos[0] };
}

// ── Lista colada ──────────────────────────────────────────────────────────────

export interface LinhaDaLista {
  codigo: string;
  caixas: number;
}

export interface LinhaRecusada {
  linha: number;
  texto: string;
  motivo: 'sem_quantidade' | 'quantidade_invalida' | 'sem_codigo' | 'ambigua';
}

export interface ListaInterpretada {
  linhas: LinhaDaLista[];
  recusadas: LinhaRecusada[];
}

/**
 * Transforma o texto colado em linhas de demanda.
 *
 * Aceita `SKU 10`, `SKU;10`, `SKU,10`, `SKU\t10` — porque é o que sai de uma planilha,
 * de um WhatsApp e de um e-mail, e obrigar um formato único faria o operador editar a
 * lista à mão antes de colar.
 *
 * Linha ruim NÃO interrompe a importação: ela volta em `recusadas`, com o número da
 * linha e o texto original. Abortar tudo por causa da linha 7 obrigaria a recomeçar do
 * zero — e quem está com pressa simplesmente apaga a linha 7 e perde a demanda dela.
 *
 * Pura de propósito: é a única parte da importação que dá para conferir sem banco.
 */
export function interpretarLista(texto: string): ListaInterpretada {
  const linhas: LinhaDaLista[] = [];
  const recusadas: LinhaRecusada[] = [];

  texto.split(/\r?\n/).forEach((bruta, i) => {
    const limpa = bruta.trim();
    if (limpa === '') return;

    const partes = limpa.split(/[\s;,\t]+/).filter(p => p !== '');
    const numeroDaLinha = i + 1;

    if (partes.length === 1) {
      recusadas.push({ linha: numeroDaLinha, texto: limpa, motivo: 'sem_quantidade' });
      return;
    }

    // A quantidade é o ÚLTIMO campo: nome de produto com espaço no meio é comum, e
    // quantidade no fim é como toda planilha de separação se escreve.
    const quantidadeBruta = partes[partes.length - 1];
    const codigo = partes.slice(0, -1).join(' ').trim();

    // ── O caso que mordeu, e por que a recusa é a resposta certa ───────────────
    // A vírgula é separador de campo (`SKU,10`, vindo de CSV) E separador decimal
    // (`10,5`, vindo de planilha em pt-BR). As duas leituras de `A 10,5` são
    // indistinguíveis: três campos com quantidade 5, ou dois campos com quantidade 10,5.
    //
    // Ler como 5 é entregar metade da demanda sem avisar ninguém — o tipo de erro que
    // só aparece no corredor. Então: número solto imediatamente antes da quantidade
    // torna a linha AMBÍGUA, e linha ambígua volta para quem colou. Separador explícito
    // (`SKU-3,2` → SKU-3, 2 caixas) continua funcionando, porque ali o código não é um
    // número solto.
    if (partes.length > 2 && /^\d+$/.test(partes[partes.length - 2])) {
      recusadas.push({ linha: numeroDaLinha, texto: limpa, motivo: 'ambigua' });
      return;
    }

    if (codigo === '') {
      recusadas.push({ linha: numeroDaLinha, texto: limpa, motivo: 'sem_codigo' });
      return;
    }

    const caixas = Number(quantidadeBruta.replace(',', '.'));
    if (!Number.isInteger(caixas) || caixas <= 0) {
      recusadas.push({ linha: numeroDaLinha, texto: limpa, motivo: 'quantidade_invalida' });
      return;
    }

    linhas.push({ codigo, caixas });
  });

  return { linhas, recusadas };
}

// ── Reserva ───────────────────────────────────────────────────────────────────

export interface ResumoDaReserva {
  ondaId: string;
  itensProcessados: number;
  demandado: number;
  alocado: number;
  /** Quanto a demanda pediu e o galpão não tinha. Zero é cobertura total. */
  descoberto: number;
  paradas: number;
}

/**
 * Reserva o saldo da onda.
 *
 * Cobertura parcial NÃO é erro: o banco aloca o que existe e devolve o descoberto. Quem
 * decide o que fazer com a falta é a operação, e esconder o número aqui só adiaria a
 * descoberta para o corredor.
 */
export async function reservarOnda(
  ondaId: string, serpentina = false,
): Promise<ResumoDaReserva> {
  const { data, error } = await db.rpc('picking_wave_reserve', {
    p_wave_id: ondaId, p_serpentina: serpentina,
  });
  if (error) falhar(error.message, 'Não foi possível reservar a onda.');

  return {
    ondaId,
    itensProcessados: numero(data, 'itens_processados'),
    demandado: numero(data, 'demandado'),
    alocado: numero(data, 'alocado'),
    descoberto: numero(data, 'descoberto'),
    paradas: numero(data, 'paradas'),
  };
}

// ── Separação ─────────────────────────────────────────────────────────────────

export type DesfechoDaBipagem =
  | 'ok' | 'endereco_errado' | 'produto_errado'
  | 'quantidade_divergente' | 'ruptura' | 'duplicado' | 'ambiguo';

export interface ResultadoDaBipagem {
  desfecho: DesfechoDaBipagem;
  /** Texto pronto para a tela. Em recusa, NUNCA diz qual era o produto certo. */
  mensagem: string | null;
  /** Repetição da mesma chave: o banco devolveu o resultado anterior, sem bipar de novo. */
  repetida: boolean;
  movimentoId: string | null;
  separadasNestaParada: number;
  restantesNestaParada: number;
  /** Em ruptura: quanto faltou e quanto foi realocado para outro endereço. */
  faltou: number;
  realocado: number;
}

/**
 * Bipa uma parada.
 *
 * ── A chave de idempotência não é opcional ────────────────────────────────────
 * Ela é gerada UMA vez por tentativa, na tela, e repetida em todo reenvio. É isso que
 * faz a rede ruim do galpão não virar caixa a mais: o banco reconhece a chave e devolve
 * o resultado anterior em vez de dar baixa de novo.
 *
 * ── Recusa volta como DADO ────────────────────────────────────────────────────
 * Endereço errado, produto errado e quantidade acima do esperado chegam em `desfecho`,
 * não como exceção. Só erro de verdade — parada inexistente, onda encerrada — vira
 * `throw`. Esse desenho vem do banco: lá, um `RAISE` desfaria o registro da própria
 * recusa, e o log de divergência nunca existiria.
 */
export async function separarParada(params: {
  alocacaoId: string;
  caixas: number;
  enderecoBipado: string;
  codigoBipado: string;
  origem: OrigemDaLeitura;
  chaveDeIdempotencia: string;
}): Promise<ResultadoDaBipagem> {
  const { data, error } = await db.rpc('picking_wave_pick', {
    p_allocation_id: params.alocacaoId,
    p_boxes: params.caixas,
    p_scanned_bin: params.enderecoBipado,
    p_scanned_code: params.codigoBipado,
    p_source: params.origem,
    p_idempotency_key: params.chaveDeIdempotencia,
  });
  if (error) falhar(error.message, 'Não foi possível registrar a bipagem.');

  return {
    desfecho: (texto(data, 'outcome') ?? 'ok') as DesfechoDaBipagem,
    mensagem: texto(data, 'mensagem'),
    repetida: campo(data, 'repetida') === true,
    movimentoId: texto(data, 'movimento'),
    separadasNestaParada: numero(data, 'separado_nesta_parada'),
    restantesNestaParada: numero(data, 'restante_nesta_parada'),
    faltou: numero(data, 'faltou'),
    realocado: numero(data, 'realocado'),
  };
}

/**
 * "Não tem nada aqui."
 *
 * Declarar falta é ação explícita, nunca dedução a partir de uma quantidade menor: bipar
 * menos que o esperado é o gesto normal de quem tira o que cabe no carrinho e volta.
 * O código bipado vai vazio porque não há produto para bipar.
 */
export async function declararRuptura(params: {
  alocacaoId: string;
  enderecoBipado: string;
  origem: OrigemDaLeitura;
  chaveDeIdempotencia: string;
}): Promise<ResultadoDaBipagem> {
  return separarParada({
    alocacaoId: params.alocacaoId,
    caixas: 0,
    enderecoBipado: params.enderecoBipado,
    codigoBipado: '',
    origem: params.origem,
    chaveDeIdempotencia: params.chaveDeIdempotencia,
  });
}

// ── Encerramento ──────────────────────────────────────────────────────────────

export interface ResumoDoEncerramento {
  ondaId: string;
  estado: EstadoDaOnda;
  faltou: number;
  reservasLiberadas: number;
}

export async function concluirOnda(ondaId: string): Promise<ResumoDoEncerramento> {
  const { data, error } = await db.rpc('picking_wave_finish', { p_wave_id: ondaId });
  if (error) falhar(error.message, 'Não foi possível concluir a onda.');

  return {
    ondaId,
    estado: (texto(data, 'status') ?? 'concluida') as EstadoDaOnda,
    faltou: numero(data, 'faltou'),
    reservasLiberadas: numero(data, 'reservas_liberadas'),
  };
}

/**
 * Cancelar devolve a PROMESSA, não a mercadoria. O que já foi separado saiu de verdade,
 * e trazê-lo de volta é uma armazenagem nova, com movimento próprio.
 */
export async function cancelarOnda(
  ondaId: string, motivo = 'cancelamento',
): Promise<ResumoDoEncerramento> {
  const { data, error } = await db.rpc('picking_wave_cancel', {
    p_wave_id: ondaId, p_reason: motivo,
  });
  if (error) falhar(error.message, 'Não foi possível cancelar a onda.');

  return {
    ondaId,
    estado: 'cancelada',
    faltou: 0,
    reservasLiberadas: numero(data, 'reservas_liberadas'),
  };
}
