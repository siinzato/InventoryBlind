import { describe, expect, it } from 'vitest';
import { detectColumns, suggestMapping, VENDAS_FIELDS, PRECOS_CUSTOS_FIELDS, normalizeSku } from '../abcCurveParsing';

describe('detectColumns / suggestMapping — presets do Tiny', () => {
  it('reconhece as colunas do relatório de vendas do Tiny', () => {
    const headers = ['Produto', 'Código (SKU)', 'Quantidade', 'Valor', 'Frete', 'Total'];
    const detected = detectColumns(headers, VENDAS_FIELDS);
    const mapping = suggestMapping(detected, VENDAS_FIELDS);
    expect(mapping.sku).toBe('Código (SKU)');
    expect(mapping.quantidade).toBe('Quantidade');
    expect(mapping.valor).toBe('Valor');
  });

  it('reconhece as colunas do relatório de preços e custos do Tiny', () => {
    const headers = ['Descrição', 'Código (SKU)', 'Unidade', 'Preço', 'Preço promocional', 'Custo'];
    const detected = detectColumns(headers, PRECOS_CUSTOS_FIELDS);
    const mapping = suggestMapping(detected, PRECOS_CUSTOS_FIELDS);
    expect(mapping.sku).toBe('Código (SKU)');
    expect(mapping.preco).toBe('Preço');
    expect(mapping.precoPromocional).toBe('Preço promocional');
    expect(mapping.custo).toBe('Custo');
  });
});

describe('normalizeSku', () => {
  it('remove só espaços nas extremidades, sem alterar o conteúdo', () => {
    expect(normalizeSku('  ABC-123  ')).toBe('ABC-123');
    expect(normalizeSku('abc-123')).toBe('abc-123');
  });

  it('retorna null para vazio/ausente', () => {
    expect(normalizeSku(undefined)).toBeNull();
    expect(normalizeSku('')).toBeNull();
    expect(normalizeSku('   ')).toBe(null);
  });
});
