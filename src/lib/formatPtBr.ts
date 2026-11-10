/**
 * Formatacao numerica em pt-BR.
 *
 * O app ja usava `toLocaleString('pt-BR')` em 209 lugares para moeda e
 * quantidade — virgula decimal, ponto de milhar — mas os percentuais eram
 * escritos a mao com `toFixed(1)`, que sempre devolve ponto decimal. O
 * resultado era "R$ 4.002.857,37" e "72.1%" lado a lado na MESMA tela.
 *
 * `pct` existe para fechar essa diferenca sem mudar arredondamento: a conta e
 * exatamente a mesma `toFixed` de antes, so o separador muda.
 */

/** Percentual ja com o sinal: `pct(72.14)` -> `"72,1%"`. */
export function pct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals).replace('.', ',')}%`;
}

/** Numero decimal sem sinal: `dec(1234.5, 1)` -> `"1.234,5"`. */
export function dec(value: number, decimals = 1): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Inteiro com separador de milhar: `int(4628)` -> `"4.628"`. */
export function int(value: number): string {
  return Math.round(value).toLocaleString('pt-BR');
}
