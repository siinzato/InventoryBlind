import { describe, expect, it } from 'vitest';
import { formatPageRanges, parsePageRanges } from '../pageRanges';

describe('parsePageRanges', () => {
  it('aceita páginas soltas e intervalos misturados', () => {
    const result = parsePageRanges('1-3,5,8-10', 12);
    expect(result.ok).toBe(true);
    expect(result.indices).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it('rejeita intervalo invertido', () => {
    const result = parsePageRanges('5-3', 10);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/invertido/);
  });

  it('rejeita página fora do documento', () => {
    const result = parsePageRanges('1,20', 10);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/fora do documento/);
  });

  it('rejeita token inválido', () => {
    const result = parsePageRanges('abc', 10);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/não é uma página nem um intervalo/);
  });

  it('ignora repetição com aviso, sem falhar', () => {
    const result = parsePageRanges('1-3,2,3', 10);
    expect(result.ok).toBe(true);
    expect(result.indices).toEqual([0, 1, 2]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejeita entrada vazia', () => {
    expect(parsePageRanges('', 10).ok).toBe(false);
    expect(parsePageRanges('   ', 10).ok).toBe(false);
  });

  it('documento sem páginas', () => {
    expect(parsePageRanges('1', 0).ok).toBe(false);
  });
});

describe('formatPageRanges (inverso de parsePageRanges para exibição)', () => {
  it('agrupa sequências consecutivas', () => {
    expect(formatPageRanges([0, 1, 2, 4, 7, 8, 9])).toBe('1-3,5,8-10');
  });

  it('página única', () => {
    expect(formatPageRanges([4])).toBe('5');
  });

  it('vazio', () => {
    expect(formatPageRanges([])).toBe('');
  });
});
