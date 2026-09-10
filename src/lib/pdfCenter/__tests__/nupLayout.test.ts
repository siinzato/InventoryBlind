import { describe, expect, it } from 'vitest';
import { computeNupGrid } from '../nupLayout';

const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };

describe('computeNupGrid', () => {
  it('grade 2x2 sem margem/espaçamento divide a página em partes iguais', () => {
    const result = computeNupGrid({
      pageWidthPt: 200, pageHeightPt: 100, rows: 2, cols: 2,
      marginPt: noMargin, spacingPt: { row: 0, col: 0 }, fillOrder: 'linhas',
    });
    expect(result.fits).toBe(true);
    expect(result.cellWidthPt).toBeCloseTo(100, 6);
    expect(result.cellHeightPt).toBeCloseTo(50, 6);
    expect(result.cells).toHaveLength(4);
  });

  it('respeita margens e espaçamento no cálculo do tamanho de célula', () => {
    const result = computeNupGrid({
      pageWidthPt: 220, pageHeightPt: 120, rows: 2, cols: 2,
      marginPt: { top: 10, right: 10, bottom: 10, left: 10 },
      spacingPt: { row: 10, col: 10 }, fillOrder: 'linhas',
    });
    // largura útil = 220-20-10=190 -> /2 = 95 ; altura útil = 120-20-10=90 -> /2 = 45
    expect(result.cellWidthPt).toBeCloseTo(95, 6);
    expect(result.cellHeightPt).toBeCloseTo(45, 6);
  });

  it('avisa em vez de cortar quando a grade não cabe', () => {
    const result = computeNupGrid({
      pageWidthPt: 50, pageHeightPt: 50, rows: 5, cols: 5,
      marginPt: noMargin, spacingPt: { row: 15, col: 15 }, fillOrder: 'linhas',
    });
    expect(result.fits).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.cells).toEqual([]);
  });

  it('ordem de preenchimento por linhas vs por colunas', () => {
    const rows = computeNupGrid({ pageWidthPt: 300, pageHeightPt: 200, rows: 2, cols: 3, marginPt: noMargin, spacingPt: { row: 0, col: 0 }, fillOrder: 'linhas' });
    const cols = computeNupGrid({ pageWidthPt: 300, pageHeightPt: 200, rows: 2, cols: 3, marginPt: noMargin, spacingPt: { row: 0, col: 0 }, fillOrder: 'colunas' });

    expect(rows.cells.map(c => `${c.row}${c.col}`)).toEqual(['00', '01', '02', '10', '11', '12']);
    expect(cols.cells.map(c => `${c.row}${c.col}`)).toEqual(['00', '10', '01', '11', '02', '12']);
  });

  it('primeira célula (ordem 0) fica no topo-esquerda da folha', () => {
    const result = computeNupGrid({ pageWidthPt: 200, pageHeightPt: 100, rows: 2, cols: 2, marginPt: noMargin, spacingPt: { row: 0, col: 0 }, fillOrder: 'linhas' });
    const first = result.cells[0];
    expect(first.row).toBe(0);
    expect(first.col).toBe(0);
    expect(first.y).toBeCloseTo(50, 6); // topo = y alto (origem embaixo)
  });

  it('rejeita grade com 0 linhas ou colunas', () => {
    const result = computeNupGrid({ pageWidthPt: 200, pageHeightPt: 100, rows: 0, cols: 2, marginPt: noMargin, spacingPt: { row: 0, col: 0 }, fillOrder: 'linhas' });
    expect(result.fits).toBe(false);
  });
});
