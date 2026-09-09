// Curva ABC — sinais associados por SKU. A recomendação PRINCIPAL continua sendo uma só, com
// a prioridade determinística de abcCurveRecommendations.ts. Os sinais são os outros fatos
// operacionais do mesmo SKU, que a recomendação única escondia: um SKU vendido sem custo com
// estoque estagnado tem uma recomendação (corrigir custo) e dois fatos (sem custo, estoque
// parado) — antes só o primeiro aparecia.
//
// São FATOS calculados do snapshot com a política da análise, não interpretação: nenhum
// sinal escolhe ação, nenhum sinal soma score, nenhum sinal chama modelo.

import type { SkuSnapshot } from './abcCurveEngine';
import type { AbcCommercialPolicy } from './abcCurvePolicy';

export type AbcSignalCode =
  | 'SEM_CUSTO'
  | 'PREJUIZO'
  | 'RUPTURA'
  | 'BAIXA_COBERTURA'
  | 'EXCESSO_COBERTURA'
  | 'ESTOQUE_PARADO'
  | 'MARGEM_BAIXA'
  | 'MARGEM_FORTE'
  | 'ALTO_GIRO'
  | 'ALTO_FATURAMENTO'
  | 'ALTO_LUCRO';

export const ABC_SIGNAL_LABEL: Record<AbcSignalCode, string> = {
  SEM_CUSTO: 'Sem custo',
  PREJUIZO: 'Prejuízo',
  RUPTURA: 'Ruptura',
  BAIXA_COBERTURA: 'Baixa cobertura',
  EXCESSO_COBERTURA: 'Excesso de cobertura',
  ESTOQUE_PARADO: 'Estoque parado',
  MARGEM_BAIXA: 'Margem baixa',
  MARGEM_FORTE: 'Margem forte',
  ALTO_GIRO: 'Alto giro',
  ALTO_FATURAMENTO: 'Alto faturamento',
  ALTO_LUCRO: 'Alto lucro',
};

/** Ordem de exibição — do problema ao destaque, para a leitura da linha ser estável. */
export const ABC_SIGNAL_ORDER: AbcSignalCode[] = [
  'PREJUIZO', 'SEM_CUSTO', 'RUPTURA', 'BAIXA_COBERTURA', 'ESTOQUE_PARADO',
  'EXCESSO_COBERTURA', 'MARGEM_BAIXA', 'MARGEM_FORTE', 'ALTO_GIRO', 'ALTO_FATURAMENTO', 'ALTO_LUCRO',
];

export const signalLabel = (code: string): string => ABC_SIGNAL_LABEL[code as AbcSignalCode] ?? code;

/** Campos do snapshot que os sinais realmente leem. Declarado aqui para o módulo aceitar
 *  tanto o snapshot recém-calculado quanto qualquer objeto com a mesma forma. */
export type SignalInput = Pick<
  SkuSnapshot,
  'quantity' | 'revenue' | 'costState' | 'grossMargin' | 'coverageDays'
  | 'stockAvailable' | 'turnoverClass' | 'revenueClass' | 'profitClass'
>;

/** Todos os sinais que se aplicam ao SKU, na ordem de ABC_SIGNAL_ORDER. Função pura: sem I/O,
 *  sem escrita, sem escolha de ação. Roda UMA vez, na publicação — histórico nunca é
 *  reavaliado com regra nova (os códigos ficam gravados no snapshot). */
export function evaluateSignals(s: SignalInput, policy: AbcCommercialPolicy): AbcSignalCode[] {
  const signals = new Set<AbcSignalCode>();

  if (s.costState === 'SEM_CUSTO') signals.add('SEM_CUSTO');
  if (s.costState === 'PREJUIZO') signals.add('PREJUIZO');

  // Estoque só entra quando existe snapshot de estoque: saldo desconhecido não é zero.
  if (s.stockAvailable !== null) {
    if (s.stockAvailable <= 0 && s.quantity > 0) signals.add('RUPTURA');
    if (s.quantity === 0 && s.stockAvailable > 0) signals.add('ESTOQUE_PARADO');
  }
  if (s.coverageDays !== null) {
    if (s.coverageDays < policy.lowCoverageDays) signals.add('BAIXA_COBERTURA');
    if (s.coverageDays > policy.excessCoverageDays) signals.add('EXCESSO_COBERTURA');
  }

  if (s.grossMargin !== null) {
    if (s.grossMargin < policy.lowMarginPct / 100) signals.add('MARGEM_BAIXA');
    if (s.grossMargin >= policy.strongMarginPct / 100) signals.add('MARGEM_FORTE');
  }

  if (s.turnoverClass === 'A') signals.add('ALTO_GIRO');
  if (s.revenueClass === 'A') signals.add('ALTO_FATURAMENTO');
  if (s.profitClass === 'A') signals.add('ALTO_LUCRO');

  return ABC_SIGNAL_ORDER.filter(code => signals.has(code));
}

/** Códigos realmente presentes na análise, para o filtro não oferecer recorte vazio. */
export function presentSignals(rows: { signal_codes?: string[] | null }[]): string[] {
  const present = new Set<string>();
  for (const row of rows) for (const code of row.signal_codes ?? []) present.add(code);
  const known: string[] = ABC_SIGNAL_ORDER.filter(code => present.has(code));
  // Código gravado por uma versão futura do vocabulário aparece no fim, em ordem alfabética,
  // em vez de desaparecer do filtro.
  const unknown = Array.from(present).filter(code => !known.includes(code)).sort();
  return [...known, ...unknown];
}

/** Quantos SKUs de um grupo carregam cada sinal — usado nos agregados da Matriz. Só conta os
 *  SKUs daquele grupo, e só sinais que aparecem neles. */
export function countSignals(rows: { signal_codes?: string[] | null }[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const code of row.signal_codes ?? []) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return presentSignals(rows).map(code => ({ code, count: counts.get(code) ?? 0 }));
}
