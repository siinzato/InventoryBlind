import { describe, expect, it } from 'vitest';
import { classifyObservation, normalizeForMatch } from '../observationClassifier';
import type { ClosingCategory } from '../closingReportTypes';

function category(overrides: Partial<ClosingCategory> = {}): ClosingCategory {
  return {
    id: 'cat-1',
    companyId: 'company-1',
    key: 'saldo_excesso',
    name: 'Saldo em excesso',
    keywords: ['saldo em excesso', 'excesso', 'sobrou', 'sobra', 'quantidade maior', 'saldo maior', 'a mais'],
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const FALTA = category({
  id: 'cat-2',
  key: 'saldo_falta',
  name: 'Saldo em falta',
  keywords: ['saldo em falta', 'faltou', 'falta', 'quantidade menor', 'saldo menor', 'a menos'],
});

const RECONTADO = category({
  id: 'cat-3',
  key: 'divergencia_recontagem',
  name: 'Divergência resolvida na recontagem',
  keywords: ['recontado', 'recontada', 'segunda contagem', 'conferido novamente'],
});

describe('normalizeForMatch', () => {
  it('ignora maiúsculas, acentos e pontuação', () => {
    expect(normalizeForMatch('Saldo em Falta!! Atrás do Vão.')).toBe('saldo em falta atras do vao');
  });

  it('colapsa espaços consecutivos', () => {
    expect(normalizeForMatch('  a   mais  ')).toBe('a mais');
  });
});

describe('classifyObservation', () => {
  it('classifica pela palavra-chave exata', () => {
    const result = classifyObservation('Encontrado saldo em excesso no vão 12', [category()]);
    expect(result.categoryIds).toEqual(['cat-1']);
    expect(result.isUnclassified).toBe(false);
  });

  it('ignora diferenças de maiúsculas, acentos e pontuação', () => {
    const result = classifyObservation('SALDO EM FALTA, atrás do vão!!', [category(), FALTA]);
    expect(result.categoryIds).toContain('cat-2');
  });

  it('respeita limite de palavra — não casa substring dentro de outra palavra', () => {
    // "falta" não deve casar dentro de "malfalta" nem "faltando" deve casar como "falta"
    const result = classifyObservation('produto malfaltante no sistema', [FALTA]);
    expect(result.categoryIds).toEqual([]);
    expect(result.isUnclassified).toBe(true);
  });

  it('uma observação pode pertencer a mais de uma categoria', () => {
    const result = classifyObservation('Saldo em excesso e depois recontado', [category(), RECONTADO]);
    expect(result.categoryIds.sort()).toEqual(['cat-1', 'cat-3']);
  });

  it('várias palavras-chave da mesma categoria contam como 1 única ocorrência', () => {
    const result = classifyObservation('sobrou, sobra e excesso confirmados', [category()]);
    expect(result.categoryIds).toEqual(['cat-1']);
  });

  it('observação sem correspondência fica não classificada', () => {
    const result = classifyObservation('nenhum problema relevante', [category(), FALTA]);
    expect(result.categoryIds).toEqual([]);
    expect(result.isUnclassified).toBe(true);
  });

  it('observação vazia não é classificada nem marcada como não classificada', () => {
    const result = classifyObservation('   ', [category()]);
    expect(result.categoryIds).toEqual([]);
    expect(result.isUnclassified).toBe(false);
  });

  it('ignora categorias inativas', () => {
    const result = classifyObservation('saldo em excesso', [category({ active: false })]);
    expect(result.categoryIds).toEqual([]);
    expect(result.isUnclassified).toBe(true);
  });
});
