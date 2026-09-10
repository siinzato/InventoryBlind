import { describe, expect, it } from 'vitest';
import { sanitizeExportValue, buildResultCSV } from '../exportUtils';
import { ComparisonRecord } from '../types';

describe('22. sanitizeExportValue — proteção contra formula injection', () => {
  it('neutraliza valores iniciados por =, +, -, @', () => {
    expect(sanitizeExportValue('=SOMA(A1:A9)')).toBe("'=SOMA(A1:A9)");
    expect(sanitizeExportValue('+1234')).toBe("'+1234");
    expect(sanitizeExportValue('-cmd|calc')).toBe("'-cmd|calc");
    expect(sanitizeExportValue('@SUM(1)')).toBe("'@SUM(1)");
  });

  it('não altera valores normais', () => {
    expect(sanitizeExportValue('SKU-123')).toBe('SKU-123');
    expect(sanitizeExportValue('Produto A')).toBe('Produto A');
  });

  it('trata undefined/null como string vazia, sem lançar erro', () => {
    expect(sanitizeExportValue(undefined)).toBe('');
    expect(sanitizeExportValue(null as unknown as undefined)).toBe('');
  });

  it('números não são afetados (não têm prefixo de fórmula)', () => {
    expect(sanitizeExportValue(42)).toBe('42');
  });
});

describe('buildResultCSV', () => {
  const baseRecord = (over: Partial<ComparisonRecord>): ComparisonRecord => ({
    id: 'r1', keyValues: { SKU: 'A1' }, keyDisplay: 'A1', status: 'equal', fields: [],
    sourceRowsA: [2], sourceRowsB: [2], duplicateGroupSizeA: 1, duplicateGroupSizeB: 1, invalidReason: null,
    ...over,
  });

  it('inclui cabeçalho e neutraliza chave maliciosa vinda de uma célula', () => {
    const csv = buildResultCSV([baseRecord({ keyDisplay: '=cmd|calc!A1' })], []);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Chave');
    expect(lines[1]).toContain("'=cmd|calc!A1");
  });

  it('inclui linhas de origem e status traduzido', () => {
    const csv = buildResultCSV([baseRecord({ status: 'divergent', sourceRowsA: [5], sourceRowsB: [7] })], []);
    expect(csv).toContain('Divergente');
    expect(csv).toContain('5');
    expect(csv).toContain('7');
  });
});
