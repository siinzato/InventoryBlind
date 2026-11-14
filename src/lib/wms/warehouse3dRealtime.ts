// Tempo real do Pulmão: saber que outro operador mexeu numa vaga, e em QUAL.
//
// Habilitado pela migration 129, que pôs `warehouse_bin_stock` e
// `warehouse_storage_bins` na publicação `supabase_realtime`. Antes dela o canal
// conectava e não recebia nada — e nada na tela denunciava isso.
//
// ── O isolamento não é feito aqui ───────────────────────────────────────────────
// O Realtime avalia a policy de SELECT por assinante, e as duas tabelas isolam por
// `company_id = get_my_company_id()`. O filtro por empresa que este arquivo aplica é
// REDUNDANTE de propósito: ele corta tráfego inútil no socket, mas quem garante que
// ninguém vê dado de outra empresa é o banco, não este código.
//
// ── Por que a tradução de UUID existe ───────────────────────────────────────────
// O mapa 3D identifica vaga pelo código impresso (`PP-A01-N1`); o banco referencia por
// UUID. As duas tabelas carregam o UUID em campos DIFERENTES: no saldo é `bin_id`
// (chave estrangeira), na tabela de endereços é o próprio `id`. Trocar um pelo outro
// não gera erro — gera destaque na vaga errada, que é pior, porque parece funcionar.

import { supabase } from '../supabase';

export type RegistroDeEvento = Record<string, unknown> | null | undefined;

export const TABELA_SALDO = 'warehouse_bin_stock';
export const TABELA_VAGAS = 'warehouse_storage_bins';

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.length > 0 ? valor : null;

/**
 * UUID da vaga afetada por um evento.
 *
 * Lê o registro NOVO primeiro e cai para o ANTIGO: em INSERT e UPDATE o novo é o que
 * vale; em DELETE só existe o antigo. É por isso que a 129 pôs `replica identity full`
 * no saldo — sem ela, o DELETE traria apenas a chave primária da linha de saldo, e o
 * `bin_id` viria vazio: saberíamos que algo saiu, sem saber de onde.
 */
export function binIdDoEvento(
  tabela: string,
  novo: RegistroDeEvento,
  antigo: RegistroDeEvento,
): string | null {
  if (tabela === TABELA_SALDO) {
    return texto(novo?.bin_id) ?? texto(antigo?.bin_id);
  }
  if (tabela === TABELA_VAGAS) {
    // Aqui a linha É a vaga: a chave primária já é o que se procura.
    return texto(novo?.id) ?? texto(antigo?.id);
  }
  return null;
}

/**
 * Código da vaga afetada, pronto para casar com `Slot.id`.
 *
 * Devolve `null` quando o UUID não está no mapa — vaga criada por outro operador
 * depois da última carga. Nesse caso a tela ainda precisa RECARREGAR (a vaga nova tem
 * de aparecer), só não tem o que destacar. Chutar um código aqui destacaria a vaga
 * errada.
 */
export function codigoDaMudanca(
  tabela: string,
  novo: RegistroDeEvento,
  antigo: RegistroDeEvento,
  codigoPorBinId: ReadonlyMap<string, string>,
): string | null {
  const binId = binIdDoEvento(tabela, novo, antigo);
  return binId === null ? null : codigoPorBinId.get(binId) ?? null;
}

export interface AssinaturaDoPulmao {
  /** Desfaz a inscrição. Chamar duas vezes é seguro. */
  cancelar: () => void;
}

/**
 * Assina as mudanças de saldo e de endereços da empresa.
 *
 * `aoMudar` recebe o código da vaga afetada, ou `null` quando ela não é conhecida. Em
 * ambos os casos quem chama deve recarregar — a diferença é só se há o que destacar.
 *
 * Devolve o cancelamento em vez de se desinscrever sozinho: o ciclo de vida é de quem
 * montou, e deixar o canal aberto depois que a tela sai é vazamento de socket.
 */
export function assinarMudancasDoPulmao(
  companyId: string,
  /**
   * Devolve o mapa VIGENTE de UUID -> código. É uma função, e não o mapa, porque cada
   * recarga produz um mapa novo: receber o valor obrigaria a refazer a inscrição a
   * cada evento recebido — derrubando e reabrindo o socket justamente quando o
   * armazém está em movimento.
   */
  obterCodigoPorBinId: () => ReadonlyMap<string, string>,
  aoMudar: (codigo: string | null) => void,
): AssinaturaDoPulmao {
  const filtro = `company_id=eq.${companyId}`;
  const canal = supabase
    .channel(`wms-pulmao-3d:${companyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABELA_SALDO, filter: filtro },
      payload => aoMudar(codigoDaMudanca(TABELA_SALDO, payload.new, payload.old, obterCodigoPorBinId())),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABELA_VAGAS, filter: filtro },
      payload => aoMudar(codigoDaMudanca(TABELA_VAGAS, payload.new, payload.old, obterCodigoPorBinId())),
    )
    .subscribe();

  let cancelado = false;
  return {
    cancelar: () => {
      if (cancelado) return;
      cancelado = true;
      void supabase.removeChannel(canal);
    },
  };
}
