// Camadas alternadas (spec §4/§6): só podem ser recomendadas se o apoio de
// CADA caixa da camada de cima sobre as de baixo for validado geometricamente
// contra o limite configurado — nunca aceitas "de olho".

import { supportPct } from './geometry';
import type { PlacedBox } from './layoutEngine';

export interface AlternatingLayersCheck {
  ok: boolean;
  minSupportPct: number;
  worstBoxIndex: number | null;
}

/** `upper` normalmente é uma segunda alternativa girada 90° em relação a
 *  `lower` (o caso clássico de paletização "travada") — mas a função aceita
 *  qualquer par, a decisão de QUAL alternativa vira a "de cima" é de quem
 *  chama (calculatePallet.ts / UI). */
export function checkAlternatingLayers(lower: PlacedBox[], upper: PlacedBox[], requiredSupportPct: number): AlternatingLayersCheck {
  if (upper.length === 0) return { ok: true, minSupportPct: 100, worstBoxIndex: null };

  let worst = 100;
  let worstIndex: number | null = null;
  for (const box of upper) {
    const pct = supportPct(box, lower);
    if (pct < worst) { worst = pct; worstIndex = box.index; }
  }

  return { ok: worst >= requiredSupportPct, minSupportPct: worst, worstBoxIndex: worstIndex };
}

/** Escolhe, entre as alternativas de layout já geradas para a mesma caixa,
 *  um par (par, ímpar) plausível para alternar — prioriza duas orientações
 *  UNIFORMES diferentes (A e B), que é o padrão real de "travamento" usado
 *  em paletização; sem uma segunda orientação distinta, não há o que
 *  alternar e a função devolve `null`. */
export function pickAlternatingPair<T extends { pattern: { id: string; placements: PlacedBox[] } }>(alternatives: T[]): [T, T] | null {
  const a = alternatives.find(alt => alt.pattern.id === 'uniform-a');
  const b = alternatives.find(alt => alt.pattern.id === 'uniform-b');
  if (a && b) return [a, b];
  return null;
}
