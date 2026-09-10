import { describe, expect, it } from 'vitest';
import { parsePositiveNumber, toKg, toMm } from '../units';

describe('toMm / toKg', () => {
  it('converte cm e m para mm', () => {
    expect(toMm(120, 'cm')).toBe(1200);
    expect(toMm(1.2, 'm')).toBe(1200);
    expect(toMm(1200, 'mm')).toBe(1200);
  });

  it('converte g para kg', () => {
    expect(toKg(500, 'g')).toBeCloseTo(0.5, 6);
    expect(toKg(2, 'kg')).toBe(2);
  });
});

describe('parsePositiveNumber (vírgula/ponto, spec §3)', () => {
  it('aceita vírgula como decimal', () => {
    expect(parsePositiveNumber('10,5')).toBeCloseTo(10.5, 6);
  });

  it('aceita ponto como decimal', () => {
    expect(parsePositiveNumber('10.5')).toBeCloseTo(10.5, 6);
  });

  it('aceita milhar BR (1.234,56)', () => {
    expect(parsePositiveNumber('1.234,56')).toBeCloseTo(1234.56, 6);
  });

  it('rejeita zero e negativo', () => {
    expect(parsePositiveNumber('0')).toBeNull();
    expect(parsePositiveNumber('-5')).toBeNull();
  });

  it('rejeita texto inválido', () => {
    expect(parsePositiveNumber('abc')).toBeNull();
    expect(parsePositiveNumber('')).toBeNull();
  });
});
