import { describe, expect, it } from 'vitest';
import { detectColumns, suggestMapping, VENDAS_FIELDS, PRECOS_CUSTOS_FIELDS, normalizeSku, parseNumber, missingRequiredFields } from '../abcCurveParsing';

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

// parseNumber: os dois padrões de planilha (pt-BR e internacional) sem heurística de idioma.
// O caso "4002.80" é o bug corrigido — antes virava 400280 porque todos os pontos eram
// removidos antes da conversão.
describe('parseNumber — formatos numéricos', () => {
  it('inteiro sem separador', () => {
    expect(parseNumber('1234')).toBe(1234);
  });

  it('decimal com vírgula (pt-BR)', () => {
    expect(parseNumber('1234,56')).toBe(1234.56);
  });

  it('milhar com ponto e decimal com vírgula (pt-BR)', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
  });

  it('decimal com ponto (internacional) — não vira 123456', () => {
    expect(parseNumber('1234.56')).toBe(1234.56);
    expect(parseNumber('4002.80')).toBe(4002.8);
  });

  it('milhar com vírgula e decimal com ponto (internacional)', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
  });

  it('preserva o sinal negativo, inclusive com símbolo monetário', () => {
    expect(parseNumber('-1234,56')).toBe(-1234.56);
    expect(parseNumber('R$ -10,50')).toBe(-10.5);
    expect(parseNumber(-42)).toBe(-42);
  });

  it('valor impossível retorna null', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber('R$')).toBeNull();
    expect(parseNumber(NaN)).toBeNull();
  });

  it('separador único com 3 casas é milhar; com parte inteira "0" continua decimal', () => {
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('0.500')).toBe(0.5);
  });

  it('número já numérico passa direto e descarta ruído monetário', () => {
    expect(parseNumber(1234.56)).toBe(1234.56);
    expect(parseNumber('R$ 1.234,56')).toBe(1234.56);
  });
});

describe('missingRequiredFields', () => {
  it('lista os campos obrigatórios sem coluna escolhida', () => {
    const missing = missingRequiredFields(VENDAS_FIELDS, { sku: 'Código', quantidade: null, valor: null, produto: 'Produto' });
    expect(missing).toEqual(['Quantidade', 'Valor']);
  });

  it('mapeamento completo não devolve nada, e campo opcional nunca bloqueia', () => {
    const missing = missingRequiredFields(VENDAS_FIELDS, { sku: 'Código', quantidade: 'Qtd', valor: 'Valor', frete: null });
    expect(missing).toEqual([]);
  });
});
