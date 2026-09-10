// Leitura de arquivo do lote (spec §9) — reaproveita direto o leitor de
// planilhas do Comparador (spreadsheet-comparator/fileParser.ts): já resolve
// CSV/XLS/XLSX, seleção de aba, detecção de linha de cabeçalho e limite de
// tamanho, sem duplicar nada disso aqui.

import { buildParsedSheet, detectHeaderRowIndex, readSpreadsheetGrid, validateFileBeforeParse } from '../spreadsheet-comparator/fileParser';
import type { ParsedSheet } from '../spreadsheet-comparator/types';

export { validateFileBeforeParse };

export async function readPalletBatchFile(file: File): Promise<ParsedSheet> {
  const grid = await readSpreadsheetGrid(file);
  const headerRowIndex = detectHeaderRowIndex(grid.grid);
  return buildParsedSheet(grid.grid, headerRowIndex, grid.truncated);
}
