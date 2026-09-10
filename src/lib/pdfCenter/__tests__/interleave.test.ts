import { describe, expect, it } from 'vitest';
import { computeInterleaveOrder } from '../interleave';

describe('computeInterleaveOrder', () => {
  it('A1,B1,A2,B2... com mesma quantidade de páginas', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 3 }, { key: 'B', pageCount: 3 }],
      { order: ['A', 'B'], leftover: 'keep' }
    );
    expect(result.sequence).toEqual([
      { docKey: 'A', pageIndex: 0 }, { docKey: 'B', pageIndex: 0 },
      { docKey: 'A', pageIndex: 1 }, { docKey: 'B', pageIndex: 1 },
      { docKey: 'A', pageIndex: 2 }, { docKey: 'B', pageIndex: 2 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('A1,B1,C1,A2,B2,C2 com três documentos', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 2 }, { key: 'B', pageCount: 2 }, { key: 'C', pageCount: 2 }],
      { order: ['A', 'B', 'C'], leftover: 'keep' }
    );
    expect(result.sequence.map(e => `${e.docKey}${e.pageIndex}`)).toEqual([
      'A0', 'B0', 'C0', 'A1', 'B1', 'C1',
    ]);
  });

  it('blocos configuráveis: 2 de A para 1 de B', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 4 }, { key: 'B', pageCount: 2 }],
      { order: ['A', 'B'], blockSizes: { A: 2, B: 1 }, leftover: 'keep' }
    );
    expect(result.sequence.map(e => `${e.docKey}${e.pageIndex}`)).toEqual([
      'A0', 'A1', 'B0', 'A2', 'A3', 'B1',
    ]);
  });

  it('quantidades diferentes com leftover=keep mantém o excedente', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 4 }, { key: 'B', pageCount: 2 }],
      { order: ['A', 'B'], leftover: 'keep' }
    );
    expect(result.sequence.map(e => `${e.docKey}${e.pageIndex}`)).toEqual([
      'A0', 'B0', 'A1', 'B1', 'A2', 'A3',
    ]);
    expect(result.warnings.some(w => w.includes('B'))).toBe(true);
  });

  it('quantidades diferentes com leftover=stopAtShortest para junto do menor', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 4 }, { key: 'B', pageCount: 2 }],
      { order: ['A', 'B'], leftover: 'stopAtShortest' }
    );
    expect(result.sequence.map(e => `${e.docKey}${e.pageIndex}`)).toEqual([
      'A0', 'B0', 'A1', 'B1',
    ]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('documento inicial diferente do primeiro da lista', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 2 }, { key: 'B', pageCount: 2 }],
      { order: ['A', 'B'], startDoc: 'B', leftover: 'keep' }
    );
    expect(result.sequence.map(e => e.docKey)[0]).toBe('B');
  });

  it('reporta erro para documento fora do padrão', () => {
    const result = computeInterleaveOrder(
      [{ key: 'A', pageCount: 2 }],
      { order: ['A', 'X'], leftover: 'keep' }
    );
    expect(result.sequence).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
