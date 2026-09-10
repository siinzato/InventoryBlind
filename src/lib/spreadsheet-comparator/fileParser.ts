// Leitura de planilhas do Comparador — .xlsx/.xls/.csv → grade bruta → linhas
// com cabeçalho escolhido (auto-detectado ou manual). Não duplica o parser de
// CSV: reaproveita parseCSVLine de productImportUtils.ts (só isso foi exportado
// lá, sem mudar nenhum comportamento existente). O parser de XLSX é novo porque
// nenhum consumidor atual precisava de seleção de aba + linha de cabeçalho —
// os pontos existentes (ProductImportPage, countManagementUtils, barcodeBatchUtils)
// sempre assumem cabeçalho na primeira linha da primeira aba.

import { parseCSVLine } from '../productImportUtils';
import { CellValue, SheetGrid, ParsedSheet, SpreadsheetDataRow } from './types';

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — não havia limite parametrizado no projeto; adotado por esta ferramenta.
export const MAX_GRID_ROWS = 200_000; // trava de segurança para não travar o navegador.
const HEADER_SCAN_LIMIT = 15;

const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export function validateFileBeforeParse(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return 'Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.';
  }
  if (file.size === 0) {
    return 'O arquivo está vazio.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Arquivo muito grande (máximo de ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB).`;
  }
  return null;
}

function isCsv(file: File): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}

function readCsvGrid(content: string): CellValue[][] {
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  return lines.map(line => parseCSVLine(line, delimiter));
}

/**
 * Lê o arquivo e devolve a grade bruta (sem aplicar cabeçalho ainda) — para
 * XLSX/XLS, lista as abas disponíveis; CSV não tem abas.
 * Nunca executa fórmulas: sheet_to_json com `raw: true` lê o valor já
 * calculado/armazenado no arquivo, não a fórmula.
 */
export async function readSpreadsheetGrid(file: File, sheetName?: string): Promise<SheetGrid> {
  if (isCsv(file)) {
    const text = await file.text();
    const grid = readCsvGrid(text);
    const truncated = grid.length > MAX_GRID_ROWS;
    return { sheetNames: ['CSV'], activeSheet: 'CSV', grid: truncated ? grid.slice(0, MAX_GRID_ROWS) : grid, truncated };
  }

  const XLSX = await import('xlsx');
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', raw: true });
  } catch (err) {
    console.error('[SpreadsheetComparator] failed to read workbook:', err);
    throw new Error('Não foi possível ler o arquivo — verifique se não está corrompido ou protegido por senha.');
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('O arquivo não contém nenhuma aba com dados.');
  }

  const activeSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[activeSheet];
  const grid = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true, defval: undefined });
  const truncated = grid.length > MAX_GRID_ROWS;

  return {
    sheetNames: workbook.SheetNames,
    activeSheet,
    grid: truncated ? grid.slice(0, MAX_GRID_ROWS) : grid,
    truncated,
  };
}

/** Heurística: entre as primeiras linhas, escolhe a com mais células preenchidas e mais valores distintos. */
export function detectHeaderRowIndex(grid: CellValue[][]): number {
  if (grid.length === 0) return 0;
  const scanLimit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i++) {
    const row = grid[i];
    const nonEmptyValues = row.filter(c => c !== undefined && String(c).trim() !== '');
    if (nonEmptyValues.length === 0) continue;
    const uniqueRatio = new Set(nonEmptyValues.map(c => String(c).trim().toLowerCase())).size / nonEmptyValues.length;
    const score = nonEmptyValues.length + uniqueRatio;
    if (score > bestScore) { bestScore = score; bestIndex = i; }
  }
  return bestIndex;
}

/** Aplica a linha de cabeçalho escolhida (auto ou manual) e monta as linhas de dados. Pula linhas totalmente vazias. */
export function buildParsedSheet(grid: CellValue[][], headerRowIndex: number, truncated: boolean): ParsedSheet {
  if (headerRowIndex < 0 || headerRowIndex >= grid.length) {
    return { headers: [], rows: [], headerRowIndex, truncated };
  }

  const headerRow = grid[headerRowIndex];
  const headers = headerRow.map((h, i) => {
    const label = h === undefined ? '' : String(h).trim();
    return label || `Coluna ${i + 1}`;
  });

  const rows: SpreadsheetDataRow[] = [];
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const dataRow = grid[i];
    if (!dataRow || dataRow.every(c => c === undefined || String(c).trim() === '')) continue;
    const row: Record<string, CellValue> = {};
    headers.forEach((h, idx) => { row[h] = dataRow[idx]; });
    rows.push({ sourceRowNumber: i + 1, data: row });
  }

  return { headers, rows, headerRowIndex, truncated };
}
