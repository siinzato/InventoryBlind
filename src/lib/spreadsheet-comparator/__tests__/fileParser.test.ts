import { describe, expect, it } from 'vitest';
import { detectHeaderRowIndex, buildParsedSheet, validateFileBeforeParse, readSpreadsheetGrid, MAX_FILE_SIZE_BYTES } from '../fileParser';
import { CellValue } from '../types';

describe('detectHeaderRowIndex', () => {
  it('detecta a primeira linha como cabeçalho no caso comum', () => {
    const grid: CellValue[][] = [
      ['SKU', 'Nome', 'Quantidade'],
      ['A1', 'Produto 1', 10],
      ['A2', 'Produto 2', 5],
    ];
    expect(detectHeaderRowIndex(grid)).toBe(0);
  });

  it('pula uma linha de título vazia/irrelevante antes do cabeçalho real', () => {
    const grid: CellValue[][] = [
      ['Relatório de Estoque — Agosto 2026', undefined, undefined],
      [undefined, undefined, undefined],
      ['SKU', 'Nome', 'Quantidade'],
      ['A1', 'Produto 1', 10],
    ];
    expect(detectHeaderRowIndex(grid)).toBe(2);
  });

  it('grade vazia retorna 0 sem lançar erro', () => {
    expect(detectHeaderRowIndex([])).toBe(0);
  });
});

describe('buildParsedSheet', () => {
  it('monta headers e linhas a partir da linha de cabeçalho escolhida', () => {
    const grid: CellValue[][] = [
      ['SKU', 'Quantidade'],
      ['A1', 10],
      ['A2', 5],
    ];
    const parsed = buildParsedSheet(grid, 0, false);
    expect(parsed.headers).toEqual(['SKU', 'Quantidade']);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ sourceRowNumber: 2, data: { SKU: 'A1', Quantidade: 10 } });
  });

  it('24. permite trocar a linha de cabeçalho manualmente', () => {
    const grid: CellValue[][] = [
      ['Relatório', undefined],
      ['SKU', 'Quantidade'],
      ['A1', 10],
    ];
    // Cabeçalho detectado automaticamente seria a linha 1 (índice 1); o usuário pode forçar outra.
    const autoDetected = detectHeaderRowIndex(grid);
    expect(autoDetected).toBe(1);
    const manual = buildParsedSheet(grid, 1, false);
    expect(manual.headers).toEqual(['SKU', 'Quantidade']);
    expect(manual.rows).toHaveLength(1);
  });

  it('pula linhas totalmente vazias entre os dados', () => {
    const grid: CellValue[][] = [
      ['SKU', 'Quantidade'],
      ['A1', 10],
      [undefined, undefined],
      ['A2', 5],
    ];
    const parsed = buildParsedSheet(grid, 0, false);
    expect(parsed.rows).toHaveLength(2);
  });

  it('gera nome de coluna padrão quando o cabeçalho está vazio', () => {
    const grid: CellValue[][] = [['SKU', undefined], ['A1', 'x']];
    const parsed = buildParsedSheet(grid, 0, false);
    expect(parsed.headers[1]).toBe('Coluna 2');
  });
});

describe('validateFileBeforeParse', () => {
  const makeFile = (name: string, size: number) => {
    const file = new File([new Uint8Array(Math.max(1, size))], name);
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  it('rejeita formato não suportado', () => {
    expect(validateFileBeforeParse(makeFile('planilha.txt', 100))).toMatch(/não suportado/i);
  });

  it('rejeita arquivo vazio', () => {
    expect(validateFileBeforeParse(makeFile('planilha.csv', 0))).toMatch(/vazio/i);
  });

  it('rejeita arquivo acima do limite de tamanho', () => {
    expect(validateFileBeforeParse(makeFile('planilha.xlsx', MAX_FILE_SIZE_BYTES + 1))).toMatch(/grande/i);
  });

  it('aceita .xlsx, .xls e .csv dentro do limite', () => {
    expect(validateFileBeforeParse(makeFile('a.xlsx', 100))).toBeNull();
    expect(validateFileBeforeParse(makeFile('a.xls', 100))).toBeNull();
    expect(validateFileBeforeParse(makeFile('a.csv', 100))).toBeNull();
  });
});

describe('readSpreadsheetGrid — 23. CSV, XLS e XLSX válidos', () => {
  it('lê um CSV com ponto e vírgula', async () => {
    const file = new File(['SKU;Quantidade\nA1;10\nA2;5'], 'base.csv', { type: 'text/csv' });
    const result = await readSpreadsheetGrid(file);
    expect(result.sheetNames).toEqual(['CSV']);
    expect(result.grid).toEqual([['SKU', 'Quantidade'], ['A1', '10'], ['A2', '5']]);
  });

  it('lê um XLSX gerado com a lib xlsx (mesma que o projeto já usa) e lista as abas', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([['SKU', 'Quantidade'], ['A1', 10]]);
    const ws2 = XLSX.utils.aoa_to_sheet([['SKU', 'Quantidade'], ['B1', 20]]);
    XLSX.utils.book_append_sheet(wb, ws1, 'Aba1');
    XLSX.utils.book_append_sheet(wb, ws2, 'Aba2');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'base.xlsx');

    const result = await readSpreadsheetGrid(file);
    expect(result.sheetNames).toEqual(['Aba1', 'Aba2']);
    expect(result.activeSheet).toBe('Aba1');
    expect(result.grid[0]).toEqual(['SKU', 'Quantidade']);
    expect(result.grid[1]).toEqual(['A1', 10]);

    const secondSheet = await readSpreadsheetGrid(file, 'Aba2');
    expect(secondSheet.activeSheet).toBe('Aba2');
    expect(secondSheet.grid[1]).toEqual(['B1', 20]);
  });

  it('rejeita arquivo XLSX corrompido com mensagem clara', async () => {
    // Cabeçalho de ZIP válido seguido de lixo — a lib recusa a decodificar, como
    // aconteceria com um .xlsx truncado/corrompido de verdade.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new File([bytes], 'corrompido.xlsx');
    await expect(readSpreadsheetGrid(file)).rejects.toThrow(/corrompido|senha/i);
  });
});
