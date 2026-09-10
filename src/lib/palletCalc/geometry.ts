// Geometria 2D pura — retângulos representando a base de cada caixa vista de
// cima. Nada aqui sabe de pallet/camada, só de posição/tamanho/colisão.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Verdadeiro quando dois retângulos se sobrepõem (encostar nas bordas não
 *  conta como sobreposição — por isso a comparação é estrita). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function anyOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) return true;
    }
  }
  return false;
}

/** Verdadeiro se o retângulo cabe dentro da base do palete, respeitando o
 *  overhang liberado em cada lado (spec §3/§4 — "impeça caixas fora do
 *  palete, salvo overhang configurado"). */
export function rectWithinBounds(
  rect: Rect,
  palletLengthMm: number,
  palletWidthMm: number,
  overhangMm: { front: number; back: number; left: number; right: number }
): boolean {
  const EPS = 1e-6;
  return (
    rect.x >= -overhangMm.left - EPS &&
    rect.y >= -overhangMm.front - EPS &&
    rect.x + rect.w <= palletLengthMm + overhangMm.right + EPS &&
    rect.y + rect.h <= palletWidthMm + overhangMm.back + EPS
  );
}

/** Quanto o retângulo ultrapassa cada lado do palete (0 se não ultrapassa) —
 *  usado tanto para validar overhang quanto para reportar o maior overhang
 *  realmente usado num arranjo. */
export function overhangUsed(rect: Rect, palletLengthMm: number, palletWidthMm: number) {
  return {
    left: Math.max(0, -rect.x),
    front: Math.max(0, -rect.y),
    right: Math.max(0, rect.x + rect.w - palletLengthMm),
    back: Math.max(0, rect.y + rect.h - palletWidthMm),
  };
}

export function maxOverhangUsed(rects: Rect[], palletLengthMm: number, palletWidthMm: number): number {
  let max = 0;
  for (const r of rects) {
    const o = overhangUsed(r, palletLengthMm, palletWidthMm);
    max = Math.max(max, o.left, o.front, o.right, o.back);
  }
  return max;
}

/** Área de interseção entre dois retângulos (0 se não se tocam) — base do
 *  cálculo de apoio entre camadas (spec §6/§4 "camadas alternadas"). */
export function intersectionArea(a: Rect, b: Rect): number {
  const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapW <= 0 || overlapH <= 0) return 0;
  return overlapW * overlapH;
}

/** Percentual de apoio de UM retângulo de cima sobre o conjunto de baixo —
 *  soma a área de interseção com todos os retângulos da camada de baixo e
 *  divide pela própria área. Nunca conta a mesma área duas vezes seria mais
 *  correto (união, não soma), mas como a camada de baixo não tem sobreposição
 *  entre si (já validada), somar é equivalente a unir. */
export function supportPct(top: Rect, below: Rect[]): number {
  const area = top.w * top.h;
  if (area <= 0) return 0;
  const supported = below.reduce((sum, b) => sum + intersectionArea(top, b), 0);
  return Math.min(100, (supported / area) * 100);
}

/** Desvio do centro de massa da carga em relação ao centro geométrico do
 *  palete, como % da meia-diagonal (0% = perfeitamente centrado, 100% =
 *  centroide numa quina) — usado pelo alerta de desequilíbrio (spec §6). */
export function centroidOffsetPct(rects: Rect[], palletLengthMm: number, palletWidthMm: number): number {
  if (rects.length === 0) return 0;
  const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0);
  if (totalArea <= 0) return 0;

  const cx = rects.reduce((sum, r) => sum + (r.x + r.w / 2) * (r.w * r.h), 0) / totalArea;
  const cy = rects.reduce((sum, r) => sum + (r.y + r.h / 2) * (r.w * r.h), 0) / totalArea;

  const centerX = palletLengthMm / 2;
  const centerY = palletWidthMm / 2;
  const offset = Math.hypot(cx - centerX, cy - centerY);
  const halfDiagonal = Math.hypot(centerX, centerY);

  return halfDiagonal > 0 ? Math.min(100, (offset / halfDiagonal) * 100) : 0;
}
