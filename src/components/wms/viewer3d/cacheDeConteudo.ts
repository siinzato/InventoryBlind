// O conteúdo de cada vaga já lido, guardado entre aberturas da gaveta.
//
// Módulo próprio, e não parte do `PainelDetalhe`, por dois motivos: quem INVALIDA é o
// orquestrador (tempo real e movimentação) e quem LÊ é o painel — nenhum dos dois precisa
// do outro para isso —, e um arquivo que exporta componente e função solta perde o
// recarregamento a quente do Vite.

import type { BinStockRow } from '../../../lib/wms/wmsService';

/**
 * Por endereço.
 *
 * Antes cada seleção ia ao banco: abrir a mesma vaga dez vezes eram dez consultas, e no
 * corredor — onde a rede é ruim e o app é PWA por causa disso — cada uma custava segundos
 * de "Lendo…" para um dado que não tinha mudado.
 *
 * Vive no MÓDULO, não em estado do React, porque precisa sobreviver ao desmonte da gaveta:
 * fechar e reabrir a vaga é exatamente o caso que o cache existe para cobrir.
 *
 * ── O que invalida ──────────────────────────────────────────────────────────────
 * Saldo de vaga muda por MOVIMENTO, e todo movimento chega de duas formas: o canal de
 * tempo real (outro operador) ou a própria tela de movimentação. As duas chamam
 * `esquecerConteudoDaVaga`. Sem isso o cache mostraria saldo velho com cara de atual — que
 * é pior do que o "Lendo…" que ele economiza.
 */
const cache = new Map<string, BinStockRow[]>();

export const conteudoGuardado = (codigo: string): BinStockRow[] | undefined => cache.get(codigo);

export const guardarConteudo = (codigo: string, linhas: BinStockRow[]): void => {
  cache.set(codigo, linhas);
};

/** Esquece uma vaga, ou TODAS quando não se sabe qual mudou. */
export function esquecerConteudoDaVaga(codigo?: string): void {
  if (codigo === undefined) cache.clear();
  else cache.delete(codigo);
}
