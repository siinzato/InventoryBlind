import { describe, expect, it } from 'vitest';
import { anyOverlap, centroidOffsetPct, intersectionArea, overhangUsed, rectsOverlap, rectWithinBounds, supportPct } from '../geometry';

describe('rectsOverlap', () => {
  it('detecta sobreposição real', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('encostar nas bordas não é sobreposição', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it('sem sobreposição', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });
});

describe('anyOverlap', () => {
  it('true se qualquer par se sobrepor', () => {
    const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }];
    expect(anyOverlap(rects)).toBe(true);
  });

  it('false quando nenhum par se sobrepõe (grade normal)', () => {
    const rects = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 }];
    expect(anyOverlap(rects)).toBe(false);
  });
});

describe('rectWithinBounds', () => {
  const noOverhang = { front: 0, back: 0, left: 0, right: 0 };

  it('dentro do palete', () => {
    expect(rectWithinBounds({ x: 0, y: 0, w: 100, h: 100 }, 200, 200, noOverhang)).toBe(true);
  });

  it('fora do palete sem overhang é rejeitado', () => {
    expect(rectWithinBounds({ x: 150, y: 0, w: 100, h: 100 }, 200, 200, noOverhang)).toBe(false);
  });

  it('overhang configurado permite ultrapassar', () => {
    expect(rectWithinBounds({ x: 150, y: 0, w: 100, h: 100 }, 200, 200, { front: 0, back: 0, left: 0, right: 60 })).toBe(true);
  });
});

describe('overhangUsed', () => {
  it('zero quando cabe dentro', () => {
    expect(overhangUsed({ x: 0, y: 0, w: 100, h: 100 }, 200, 200)).toEqual({ left: 0, front: 0, right: 0, back: 0 });
  });

  it('mede quanto ultrapassa cada lado', () => {
    expect(overhangUsed({ x: -10, y: 0, w: 100, h: 100 }, 200, 200).left).toBe(10);
    expect(overhangUsed({ x: 150, y: 0, w: 100, h: 100 }, 200, 200).right).toBe(50);
  });
});

describe('intersectionArea / supportPct', () => {
  it('área de interseção correta', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
  });

  it('zero quando não se tocam', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(0);
  });

  it('100% de apoio quando totalmente sobre uma caixa de baixo do mesmo tamanho', () => {
    expect(supportPct({ x: 0, y: 0, w: 10, h: 10 }, [{ x: 0, y: 0, w: 10, h: 10 }])).toBe(100);
  });

  it('apoio parcial soma interseção com várias caixas de baixo', () => {
    const top = { x: 0, y: 0, w: 10, h: 10 };
    const below = [{ x: 0, y: 0, w: 5, h: 10 }, { x: 5, y: 0, w: 5, h: 10 }];
    expect(supportPct(top, below)).toBe(100);
  });

  it('0% quando não há nada embaixo', () => {
    expect(supportPct({ x: 0, y: 0, w: 10, h: 10 }, [])).toBe(0);
  });
});

describe('centroidOffsetPct', () => {
  it('0% quando a carga está perfeitamente centralizada', () => {
    // 4 caixas simétricas ao redor do centro de um palete 200x200
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 },
      { x: 0, y: 100, w: 100, h: 100 }, { x: 100, y: 100, w: 100, h: 100 },
    ];
    expect(centroidOffsetPct(rects, 200, 200)).toBeCloseTo(0, 6);
  });

  it('> 0% quando a carga está concentrada de um lado', () => {
    const rects = [{ x: 0, y: 0, w: 50, h: 200 }];
    expect(centroidOffsetPct(rects, 200, 200)).toBeGreaterThan(0);
  });

  it('vazio não quebra (0%)', () => {
    expect(centroidOffsetPct([], 200, 200)).toBe(0);
  });
});
