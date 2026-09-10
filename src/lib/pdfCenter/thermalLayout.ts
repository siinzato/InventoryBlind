// Matemática pura do "Preparar para impressão térmica" (spec §6) — decide
// tamanho final da página e onde/como o conteúdo original é posicionado
// dentro dela. Não desenha nada (isso é pdfOps.ts, que já roda no navegador).

import { computeAlignedPosition, computeFitPlacement, type AlignX, type AlignY } from './fitPlacement';
import type { EdgeInsets, FitMode, Rotation } from './types';

export interface ThermalLayoutInput {
  sourceWidthPt: number;
  sourceHeightPt: number;
  targetWidthPt: number;
  targetHeightPt: number;
  fitMode: FitMode;
  orientation: 'auto' | 'retrato' | 'paisagem';
  alignX: AlignX;
  alignY: AlignY;
  marginPt: EdgeInsets;
  /** Multiplicador extra de escala definido pelo usuário (1 = sem ajuste). */
  scale: number;
  offsetXPt: number;
  offsetYPt: number;
  rotationDeg: Rotation;
}

export interface ThermalLayoutResult {
  pageWidthPt: number;
  pageHeightPt: number;
  placedWidthPt: number;
  placedHeightPt: number;
  x: number;
  y: number;
  rotationDeg: Rotation;
  warnings: string[];
}

function resolvePageOrientation(width: number, height: number, orientation: ThermalLayoutInput['orientation'], sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  if (width === height) return { width, height };

  const targetIsLandscape = width > height;
  let wantLandscape: boolean;
  if (orientation === 'paisagem') wantLandscape = true;
  else if (orientation === 'retrato') wantLandscape = false;
  else wantLandscape = sourceWidth > sourceHeight;

  if (wantLandscape === targetIsLandscape) return { width, height };
  return { width: height, height: width };
}

export function computeThermalLayout(input: ThermalLayoutInput): ThermalLayoutResult {
  const warnings: string[] = [];
  const page = resolvePageOrientation(input.targetWidthPt, input.targetHeightPt, input.orientation, input.sourceWidthPt, input.sourceHeightPt);

  const availWidth = page.width - input.marginPt.left - input.marginPt.right;
  const availHeight = page.height - input.marginPt.top - input.marginPt.bottom;

  if (availWidth <= 0 || availHeight <= 0) {
    warnings.push('As margens são maiores que a página — não sobrou área útil.');
    return { pageWidthPt: page.width, pageHeightPt: page.height, placedWidthPt: 0, placedHeightPt: 0, x: 0, y: 0, rotationDeg: input.rotationDeg, warnings };
  }

  const fit = computeFitPlacement(input.sourceWidthPt, input.sourceHeightPt, availWidth, availHeight, input.fitMode, input.scale);
  if (fit.clipped) {
    warnings.push(input.fitMode === 'fill'
      ? 'O modo "Preencher" recorta partes do conteúdo para preencher a página inteira.'
      : 'O conteúdo original é maior que a área útil da página — parte dele ficará fora da página.');
  }

  const aligned = computeAlignedPosition(fit.placedWidth, fit.placedHeight, availWidth, availHeight, input.alignX, input.alignY);

  return {
    pageWidthPt: page.width,
    pageHeightPt: page.height,
    placedWidthPt: fit.placedWidth,
    placedHeightPt: fit.placedHeight,
    x: input.marginPt.left + aligned.x + input.offsetXPt,
    y: input.marginPt.bottom + aligned.y + input.offsetYPt,
    rotationDeg: input.rotationDeg,
    warnings,
  };
}
