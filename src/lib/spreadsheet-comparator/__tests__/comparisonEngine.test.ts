import { describe, expect, it } from 'vitest';
import { runComparison } from '../comparisonEngine';
import { KeyPartMapping, FieldMapping, ComparisonSettings, SpreadsheetDataRow } from '../types';

const row = (sourceRowNumber: number, data: Record<string, string | number | undefined>): SpreadsheetDataRow => ({ sourceRowNumber, data });

const simpleKey = (columnA: string, columnB: string): KeyPartMapping[] => [{ id: 'k1', label: 'Chave', columnA, columnB }];

const qtyField = (id = 'qty'): FieldMapping => ({
  id, label: 'Quantidade', columnA: 'qty', columnB: 'qty', dataType: 'number', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0,
});

const defaultSettings: ComparisonSettings = {
  duplicateStrategy: 'aggregate', defaultCaseSensitive: false, defaultToleranceAbsolute: 0, defaultTolerancePercent: 0,
};

describe('runComparison — casos básicos', () => {
  it('1. chave simples presente e igual nas duas bases', async () => {
    const a = [row(2, { sku: 'A1', qty: 10 })];
    const b = [row(2, { sku: 'A1', qty: 10 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('equal');
  });

  it('2. chave simples com valor divergente', async () => {
    const a = [row(2, { sku: 'A1', qty: 10 })];
    const b = [row(2, { sku: 'A1', qty: 12 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records[0].status).toBe('divergent');
    expect(result.records[0].fields[0].difference).toBe(2);
  });

  it('3. registro somente na A', async () => {
    const a = [row(2, { sku: 'A1', qty: 10 })];
    const b: SpreadsheetDataRow[] = [];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records[0].status).toBe('only-a');
    expect(result.records[0].sourceRowsA).toEqual([2]);
  });

  it('4. registro somente na B', async () => {
    const a: SpreadsheetDataRow[] = [];
    const b = [row(3, { sku: 'A1', qty: 10 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records[0].status).toBe('only-b');
    expect(result.records[0].sourceRowsB).toEqual([3]);
  });

  it('5. chave composta (SKU + depósito)', async () => {
    const keyParts: KeyPartMapping[] = [
      { id: 'k1', label: 'SKU', columnA: 'sku', columnB: 'sku' },
      { id: 'k2', label: 'Depósito', columnA: 'deposito', columnB: 'deposito' },
    ];
    const a = [row(2, { sku: 'A1', deposito: 'D1', qty: 5 }), row(3, { sku: 'A1', deposito: 'D2', qty: 7 })];
    const b = [row(2, { sku: 'A1', deposito: 'D1', qty: 5 }), row(3, { sku: 'A1', deposito: 'D2', qty: 9 })];
    const result = await runComparison(a, b, keyParts, [qtyField()], defaultSettings);
    expect(result.records).toHaveLength(2);
    const d1 = result.records.find(r => r.keyDisplay.includes('D1'))!;
    const d2 = result.records.find(r => r.keyDisplay.includes('D2'))!;
    expect(d1.status).toBe('equal');
    expect(d2.status).toBe('divergent');
  });

  it('6. colunas com nomes diferentes entre A e B (codigo_produto x SKU)', async () => {
    const a = [row(2, { codigo_produto: 'A1', qty: 10 })];
    const b = [row(2, { SKU: 'A1', qty: 10 })];
    const field: FieldMapping = { id: 'qty', label: 'Qtd', columnA: 'qty', columnB: 'qty', dataType: 'number', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0 };
    const result = await runComparison(a, b, simpleKey('codigo_produto', 'SKU'), [field], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('7. preservação de zeros à esquerda na chave', async () => {
    const a = [row(2, { sku: '00123', qty: 1 })];
    const b = [row(2, { sku: '00123', qty: 1 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [], defaultSettings);
    expect(result.records[0].status).toBe('equal');
    // "123" (sem zeros) não deveria casar com "00123"
    const bMismatch = [row(2, { sku: '123', qty: 1 })];
    const mismatchResult = await runComparison(a, bMismatch, simpleKey('sku', 'sku'), [], defaultSettings);
    expect(mismatchResult.records.map(r => r.status).sort()).toEqual(['only-a', 'only-b']);
  });

  it('8. comparação textual exata rejeita diferença de caixa', async () => {
    const field: FieldMapping = { id: 'f1', label: 'Nome', columnA: 'nome', columnB: 'nome', dataType: 'text', caseSensitive: true, toleranceAbsolute: 0, tolerancePercent: 0 };
    const a = [row(2, { sku: 'A1', nome: 'Produto X' })];
    const b = [row(2, { sku: 'A1', nome: 'produto x' })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    expect(result.records[0].status).toBe('divergent');
  });

  it('9. comparação textual ignorando maiúsculas/minúsculas', async () => {
    const field: FieldMapping = { id: 'f1', label: 'Nome', columnA: 'nome', columnB: 'nome', dataType: 'text', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0 };
    const a = [row(2, { sku: 'A1', nome: 'Produto X' })];
    const b = [row(2, { sku: 'A1', nome: 'produto x' })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('10. número em formato brasileiro', async () => {
    const a = [row(2, { sku: 'A1', qty: '1.234,00' })];
    const b = [row(2, { sku: 'A1', qty: 1234 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('11. número em formato internacional', async () => {
    const a = [row(2, { sku: 'A1', qty: '1,234.00' })];
    const b = [row(2, { sku: 'A1', qty: 1234 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('12. tolerância absoluta', async () => {
    const field: FieldMapping = { id: 'preco', label: 'Preço', columnA: 'preco', columnB: 'preco', dataType: 'number', caseSensitive: false, toleranceAbsolute: 0.01, tolerancePercent: 0 };
    const a = [row(2, { sku: 'A1', preco: 10 })];
    const b = [row(2, { sku: 'A1', preco: 10.01 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('13. tolerância percentual', async () => {
    const field: FieldMapping = { id: 'preco', label: 'Preço', columnA: 'preco', columnB: 'preco', dataType: 'number', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 2 };
    const a = [row(2, { sku: 'A1', preco: 100 })];
    const b = [row(2, { sku: 'A1', preco: 101.5 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('14. data válida — mesmo dia em formatos diferentes', async () => {
    const field: FieldMapping = { id: 'validade', label: 'Validade', columnA: 'val', columnB: 'val', dataType: 'date', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0 };
    const a = [row(2, { sku: 'A1', val: '31/12/2026' })];
    const b = [row(2, { sku: 'A1', val: '2026-12-31' })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });

  it('15. data inválida marca o registro como inválido, sem travar a comparação', async () => {
    const field: FieldMapping = { id: 'validade', label: 'Validade', columnA: 'val', columnB: 'val', dataType: 'date', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0 };
    const a = [row(2, { sku: 'A1', val: '31/02/2026' }), row(3, { sku: 'A2', val: '01/01/2026' })];
    const b = [row(2, { sku: 'A1', val: '2026-01-15' }), row(3, { sku: 'A2', val: '2026-01-01' })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [field], defaultSettings);
    const invalidRec = result.records.find(r => r.keyDisplay === 'A1')!;
    const validRec = result.records.find(r => r.keyDisplay === 'A2')!;
    expect(invalidRec.status).toBe('invalid');
    expect(validRec.status).toBe('equal');
  });

  it('16. duplicados agrupados com soma (modo agregado)', async () => {
    const a = [row(2, { sku: 'A1', qty: 5 }), row(3, { sku: 'A1', qty: 5 })];
    const b = [row(2, { sku: 'A1', qty: 10 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].status).toBe('equal'); // 5+5 == 10
    expect(result.records[0].duplicateGroupSizeA).toBe(2);
    expect(result.records[0].sourceRowsA).toEqual([2, 3]);
  });

  it('17. duplicados comparados linha a linha, na ordem original', async () => {
    const settings: ComparisonSettings = { ...defaultSettings, duplicateStrategy: 'row-by-row' };
    const a = [row(2, { sku: 'A1', qty: 5 }), row(3, { sku: 'A1', qty: 9 })];
    const b = [row(2, { sku: 'A1', qty: 5 }), row(3, { sku: 'A1', qty: 7 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], settings);
    expect(result.records).toHaveLength(2);
    const first = result.records.find(r => r.sourceRowsA[0] === 2)!;
    const second = result.records.find(r => r.sourceRowsA[0] === 3)!;
    expect(first.status).toBe('equal');
    expect(second.status).toBe('divergent');
  });

  it('linha a linha: sobra sem par vira "duplicate-a" quando a chave existe nos dois lados', async () => {
    const settings: ComparisonSettings = { ...defaultSettings, duplicateStrategy: 'row-by-row' };
    const a = [row(2, { sku: 'A1', qty: 5 }), row(3, { sku: 'A1', qty: 5 }), row(4, { sku: 'A1', qty: 5 })];
    const b = [row(2, { sku: 'A1', qty: 5 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], settings);
    expect(result.records.filter(r => r.status === 'equal')).toHaveLength(1);
    expect(result.records.filter(r => r.status === 'duplicate-a')).toHaveLength(2);
  });

  it('18. linhas inválidas (chave vazia) não impedem o processamento das válidas', async () => {
    const a = [row(2, { sku: '', qty: 5 }), row(3, { sku: 'A1', qty: 5 })];
    const b = [row(2, { sku: 'A1', qty: 5 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    expect(result.records.some(r => r.status === 'invalid')).toBe(true);
    expect(result.records.some(r => r.status === 'equal')).toBe(true);
    expect(result.summary.invalidCount).toBe(1);
  });

  it('19. diferença líquida (net) soma B - A, mesmo com sinais opostos', async () => {
    const a = [row(2, { sku: 'A1', qty: 10 }), row(3, { sku: 'A2', qty: 10 })];
    const b = [row(2, { sku: 'A1', qty: 8 }), row(3, { sku: 'A2', qty: 12 })]; // -2 e +2
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    const totals = result.summary.fieldTotals.find(t => t.fieldId === 'qty')!;
    expect(totals.netDifference).toBe(0); // -2 + 2 = 0
  });

  it('20. diferença absoluta não permite que falta e sobra se cancelem', async () => {
    const a = [row(2, { sku: 'A1', qty: 10 }), row(3, { sku: 'A2', qty: 10 })];
    const b = [row(2, { sku: 'A1', qty: 8 }), row(3, { sku: 'A2', qty: 12 })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [qtyField()], defaultSettings);
    const totals = result.summary.fieldTotals.find(t => t.fieldId === 'qty')!;
    expect(totals.absoluteDifference).toBe(4); // |-2| + |2| = 4, nunca 0
  });

  it('21. chave vazia é classificada como inválida com motivo', async () => {
    const a = [row(2, { sku: '   ', qty: 5 })];
    const b: SpreadsheetDataRow[] = [];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [], defaultSettings);
    expect(result.records[0].status).toBe('invalid');
    expect(result.records[0].invalidReason).toMatch(/vazio/i);
    expect(result.records[0].sourceRowsA).toEqual([2]);
  });

  it('comparar somente a existência das chaves (sem campos) — chave igual nas duas bases é "equal"', async () => {
    const a = [row(2, { sku: 'A1' })];
    const b = [row(2, { sku: 'A1' })];
    const result = await runComparison(a, b, simpleKey('sku', 'sku'), [], defaultSettings);
    expect(result.records[0].status).toBe('equal');
  });
});
