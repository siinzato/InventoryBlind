import { describe, expect, it } from 'vitest';
import {
  detectSalesColumnMappings, suggestSalesMapping, applySalesColumnMapping, validateAndBuildSalesRows,
} from '../salesImportUtils';

describe('detectSalesColumnMappings / suggestSalesMapping', () => {
  it('detecta colunas por nome exato com alta confiança', () => {
    const detected = detectSalesColumnMappings(['data', 'sku', 'quantidade', 'faturamento']);
    expect(detected.find(d => d.name === 'data')?.detectedField).toBe('data');
    expect(detected.find(d => d.name === 'data')?.confidence).toBe('high');
  });

  it('sugere o mapeamento inicial a partir da detecção', () => {
    const detected = detectSalesColumnMappings(['Data da Venda', 'Código', 'Qtd', 'Preço Unitário']);
    const mapping = suggestSalesMapping(detected);
    expect(mapping.data).toBe('Data da Venda');
    expect(mapping.sku).toBe('Código');
    expect(mapping.quantidade).toBe('Qtd');
    expect(mapping.precoUnitario).toBe('Preço Unitário');
  });
});

describe('applySalesColumnMapping', () => {
  it('remapeia as linhas para os nomes de campo padrão', () => {
    const mapped = applySalesColumnMapping(
      [{ 'Data da Venda': '2026-08-01', Código: 'SKU1', Qtd: 3 }],
      { data: 'Data da Venda', sku: 'Código', produto: null, quantidade: 'Qtd', precoUnitario: null, faturamento: null }
    );
    expect(mapped[0]).toEqual({ data: '2026-08-01', sku: 'SKU1', quantidade: 3 });
  });
});

describe('validateAndBuildSalesRows', () => {
  it('calcula o faturamento a partir de quantidade x preço unitário quando faturamento não é informado', () => {
    const { valid, errors } = validateAndBuildSalesRows([
      { data: '2026-08-01', sku: 'SKU1', produto: 'Produto 1', quantidade: 4, precoUnitario: 10 },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid[0].totalValue).toBe(40);
  });

  it('usa o faturamento informado diretamente quando presente, mesmo sem preço unitário', () => {
    const { valid } = validateAndBuildSalesRows([
      { data: '2026-08-01', sku: 'SKU1', produto: 'Produto 1', quantidade: 4, faturamento: 55 },
    ]);
    expect(valid[0].totalValue).toBe(55);
  });

  it('rejeita a linha (sem travar as demais) quando não há data', () => {
    const { valid, errors } = validateAndBuildSalesRows([
      { sku: 'SKU1', produto: 'Produto 1', quantidade: 1, faturamento: 10 },
      { data: '2026-08-01', sku: 'SKU2', produto: 'Produto 2', quantidade: 1, faturamento: 20 },
    ]);
    expect(errors).toHaveLength(1);
    expect(valid).toHaveLength(1);
    expect(valid[0].sku).toBe('SKU2');
  });

  it('rejeita a linha quando não há faturamento nem preço unitário para calcular', () => {
    const { valid, errors } = validateAndBuildSalesRows([
      { data: '2026-08-01', sku: 'SKU1', produto: 'Produto 1', quantidade: 4 },
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/faturamento total ou preço unitário/i);
  });

  it('usa a data de referência (fallback) quando o arquivo não tem coluna de data — caso do relatório do Tiny', () => {
    const { valid, errors } = validateAndBuildSalesRows([
      { sku: 'OUT-TCGCM25-BRASIL', produto: 'Copo Vibe Outlet', quantidade: 2, faturamento: 49.07 },
    ], '2026-08-25');
    expect(errors).toHaveLength(0);
    expect(valid[0].saleDate).toBe('2026-08-25');
  });

  it('sem coluna de data e sem fallback informado, a linha continua sendo rejeitada', () => {
    const { valid, errors } = validateAndBuildSalesRows([
      { sku: 'SKU1', produto: 'Produto 1', quantidade: 1, faturamento: 10 },
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0].message).toMatch(/data/i);
  });

  it('produto sem SKU não bloqueia a importação — vira aviso, continua "não associado"', () => {
    const { valid, warnings, errors } = validateAndBuildSalesRows([
      { data: '2026-08-01', produto: 'Produto Sem SKU', quantidade: 2, faturamento: 20 },
    ]);
    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].sku).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
