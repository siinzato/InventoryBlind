// Matemática de encaixe compartilhada entre o preparo térmico (thermalLayout)
// e a montagem de folhas N-up (nupLayout) — como um conteúdo de tamanho
// (srcW,srcH) se posiciona dentro de uma área disponível (availW,availH).

import type { FitMode } from './types';

export interface FitPlacementResult {
  scale: number;
  placedWidth: number;
  placedHeight: number;
  clipped: boolean;
}

/** Nunca deforma: a mesma escala é aplicada aos dois eixos. */
export function computeFitPlacement(
  srcWidth: number,
  srcHeight: number,
  availWidth: number,
  availHeight: number,
  mode: FitMode,
  userScale = 1
): FitPlacementResult {
  if (srcWidth <= 0 || srcHeight <= 0 || availWidth <= 0 || availHeight <= 0) {
    return { scale: 0, placedWidth: 0, placedHeight: 0, clipped: false };
  }

  let scale: number;
  if (mode === 'original') {
    scale = 1;
  } else if (mode === 'fill') {
    scale = Math.max(availWidth / srcWidth, availHeight / srcHeight);
  } else {
    scale = Math.min(availWidth / srcWidth, availHeight / srcHeight);
  }
  scale *= userScale;

  const placedWidth = srcWidth * scale;
  const placedHeight = srcHeight * scale;
  const clipped = placedWidth > availWidth + 0.01 || placedHeight > availHeight + 0.01;

  return { scale, placedWidth, placedHeight, clipped };
}

export type AlignX = 'left' | 'center' | 'right';
export type AlignY = 'top' | 'center' | 'bottom';

/** Posição do canto inferior-esquerdo do conteúdo dentro da área disponível,
 *  em coordenadas com origem no canto inferior-esquerdo da área (padrão PDF). */
export function computeAlignedPosition(
  placedWidth: number,
  placedHeight: number,
  availWidth: number,
  availHeight: number,
  alignX: AlignX,
  alignY: AlignY
): { x: number; y: number } {
  const x = alignX === 'left' ? 0 : alignX === 'right' ? availWidth - placedWidth : (availWidth - placedWidth) / 2;
  // Y invertido: "top" fica no topo da área, mas a origem PDF é embaixo.
  const y = alignY === 'bottom' ? 0 : alignY === 'top' ? availHeight - placedHeight : (availHeight - placedHeight) / 2;
  return { x, y };
}
