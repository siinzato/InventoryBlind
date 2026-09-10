// Matemática pura da montagem de folhas (N-up, spec §7) — calcula a grade de
// células dentro de uma folha; quem desenha cada célula (pdfOps.ts) usa
// `computeFitPlacement`/`computeAlignedPosition` de fitPlacement.ts por cima
// do retângulo de cada célula, exatamente como thermalLayout.ts faz para uma
// folha inteira.

import type { EdgeInsets } from './types';

export interface NupLayoutInput {
  pageWidthPt: number;
  pageHeightPt: number;
  rows: number;
  cols: number;
  marginPt: EdgeInsets;
  spacingPt: { row: number; col: number };
  fillOrder: 'linhas' | 'colunas';
}

export interface NupCell {
  row: number;
  col: number;
  /** Índice de preenchimento (0-based), já respeitando `fillOrder`. */
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NupLayoutResult {
  cells: NupCell[];
  cellWidthPt: number;
  cellHeightPt: number;
  fits: boolean;
  warnings: string[];
}

export function computeNupGrid(input: NupLayoutInput): NupLayoutResult {
  const warnings: string[] = [];
  const { rows, cols } = input;

  if (rows < 1 || cols < 1) {
    return { cells: [], cellWidthPt: 0, cellHeightPt: 0, fits: false, warnings: ['A grade precisa de ao menos 1 linha e 1 coluna.'] };
  }

  const availWidth = input.pageWidthPt - input.marginPt.left - input.marginPt.right - input.spacingPt.col * (cols - 1);
  const availHeight = input.pageHeightPt - input.marginPt.top - input.marginPt.bottom - input.spacingPt.row * (rows - 1);
  const cellWidth = availWidth / cols;
  const cellHeight = availHeight / rows;

  if (cellWidth <= 0 || cellHeight <= 0) {
    return {
      cells: [], cellWidthPt: Math.max(0, cellWidth), cellHeightPt: Math.max(0, cellHeight), fits: false,
      warnings: [`A grade ${rows}×${cols} não cabe na folha com essas margens e espaçamentos.`],
    };
  }

  const cells: NupCell[] = [];
  // row 0 = topo da folha; y do PDF cresce de baixo pra cima.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = input.marginPt.left + c * (cellWidth + input.spacingPt.col);
      const yFromTop = r * (cellHeight + input.spacingPt.row);
      const y = input.pageHeightPt - input.marginPt.top - yFromTop - cellHeight;
      const order = input.fillOrder === 'linhas' ? r * cols + c : c * rows + r;
      cells.push({ row: r, col: c, order, x, y, width: cellWidth, height: cellHeight });
    }
  }

  cells.sort((a, b) => a.order - b.order);

  return { cells, cellWidthPt: cellWidth, cellHeightPt: cellHeight, fits: true, warnings };
}
