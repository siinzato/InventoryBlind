import { describe, expect, it } from 'vitest';
import {
  normalizeIdentifier, buildCompositeKey, normalizeText,
  parseFlexibleNumber, numbersMatch, parseFlexibleDate, datesMatch, inferFieldDataType,
} from '../normalization';

describe('normalizeIdentifier — preservação de zeros à esquerda', () => {
  it('preserva zeros à esquerda em strings', () => {
    expect(normalizeIdentifier('0012345').value).toBe('0012345');
  });

  it('remove só espaços nas pontas, nunca caracteres internos', () => {
    expect(normalizeIdentifier('  ABC 123  ').value).toBe('ABC 123');
  });

  it('nunca converte para número (0012345 continua string, não 12345)', () => {
    const result = normalizeIdentifier('0012345');
    expect(typeof result.value).toBe('string');
    expect(result.value).not.toBe('12345');
  });

  it('marca vazio quando só há espaços ou undefined', () => {
    expect(normalizeIdentifier('   ').empty).toBe(true);
    expect(normalizeIdentifier(undefined).empty).toBe(true);
    expect(normalizeIdentifier('x').empty).toBe(false);
  });
});

describe('buildCompositeKey', () => {
  it('junta partes sem colisão entre combinações diferentes', () => {
    const k1 = buildCompositeKey(['AB', 'C']);
    const k2 = buildCompositeKey(['A', 'BC']);
    expect(k1).not.toBe(k2);
  });
});

describe('normalizeText', () => {
  it('comparação exata diferencia maiúsculas/minúsculas', () => {
    expect(normalizeText('ABC', true)).not.toBe(normalizeText('abc', true));
  });

  it('ignorando maiúsculas/minúsculas, ABC == abc', () => {
    expect(normalizeText('ABC', false)).toBe(normalizeText('abc', false));
  });

  it('não remove pontuação interna', () => {
    expect(normalizeText('Rua A, nº 10', false)).toBe('rua a, nº 10');
  });
});

describe('parseFlexibleNumber', () => {
  it('formato brasileiro: 1.234,56 -> 1234.56', () => {
    const r = parseFlexibleNumber('1.234,56');
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(1234.56);
  });

  it('formato internacional: 1,234.56 -> 1234.56', () => {
    const r = parseFlexibleNumber('1,234.56');
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(1234.56);
  });

  it('decimal simples BR: 10,5 -> 10.5', () => {
    expect(parseFlexibleNumber('10,5').value).toBeCloseTo(10.5);
  });

  it('decimal simples internacional: 10.5 -> 10.5', () => {
    expect(parseFlexibleNumber('10.5').value).toBeCloseTo(10.5);
  });

  it('número nativo (já vindo como number da planilha) é aceito diretamente', () => {
    expect(parseFlexibleNumber(42).value).toBe(42);
  });

  it('texto não numérico não é interpretável', () => {
    expect(parseFlexibleNumber('abc').ok).toBe(false);
  });

  it('vazio não é interpretável', () => {
    expect(parseFlexibleNumber('').ok).toBe(false);
    expect(parseFlexibleNumber(undefined).ok).toBe(false);
  });
});

describe('numbersMatch — tolerância', () => {
  it('sem tolerância, exige igualdade exata', () => {
    expect(numbersMatch(10, 10, 0, 0)).toBe(true);
    expect(numbersMatch(10, 10.01, 0, 0)).toBe(false);
  });

  it('tolerância absoluta de 0,01 aceita diferença dentro do limite', () => {
    expect(numbersMatch(10, 10.01, 0.01, 0)).toBe(true);
    expect(numbersMatch(10, 10.02, 0.01, 0)).toBe(false);
  });

  it('tolerância percentual de 2% aceita diferença proporcional dentro do limite', () => {
    expect(numbersMatch(100, 101.5, 0, 2)).toBe(true);
    expect(numbersMatch(100, 103, 0, 2)).toBe(false);
  });
});

describe('parseFlexibleDate', () => {
  it('aceita dd/mm/aaaa válida', () => {
    const r = parseFlexibleDate('31/12/2026');
    expect(r.ok).toBe(true);
    expect(r.value?.getUTCFullYear()).toBe(2026);
    expect(r.value?.getUTCMonth()).toBe(11);
    expect(r.value?.getUTCDate()).toBe(31);
  });

  it('aceita aaaa-mm-dd (ISO)', () => {
    const r = parseFlexibleDate('2026-08-21');
    expect(r.ok).toBe(true);
  });

  it('aceita número serial do Excel', () => {
    const r = parseFlexibleDate(45500); // ~2024-08
    expect(r.ok).toBe(true);
  });

  it('rejeita data impossível (31/02) em vez de adivinhar', () => {
    expect(parseFlexibleDate('31/02/2026').ok).toBe(false);
  });

  it('rejeita mês impossível (13)', () => {
    expect(parseFlexibleDate('10/13/2026').ok).toBe(false);
  });

  it('rejeita texto que não é data', () => {
    expect(parseFlexibleDate('não é uma data').ok).toBe(false);
  });

  it('datesMatch compara pelo dia exato', () => {
    const a = parseFlexibleDate('01/01/2026').value!;
    const b = parseFlexibleDate('2026-01-01').value!;
    expect(datesMatch(a, b)).toBe(true);
  });
});

describe('inferFieldDataType', () => {
  it('infere número quando ambos os lados são numéricos', () => {
    expect(inferFieldDataType('10,5', '11.2')).toBe('number');
  });

  it('infere data quando ambos os lados são datas', () => {
    expect(inferFieldDataType('01/01/2026', '2026-01-02')).toBe('date');
  });

  it('cai para texto quando não é claramente número nem data', () => {
    expect(inferFieldDataType('Rua A', 'Rua B')).toBe('text');
  });
});
