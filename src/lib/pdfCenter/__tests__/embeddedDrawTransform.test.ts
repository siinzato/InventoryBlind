import { describe, expect, it } from 'vitest';
import { computeEmbeddedDrawTransform, effectiveSize, normalizeAngle } from '../embeddedDrawTransform';

/** Reproduz a MESMA composição de matriz que `page.drawPage()` do pdf-lib usa
 *  internamente (translate -> rotate -> scale, rotação anti-horária, ver
 *  node_modules/pdf-lib/cjs/api/operations.js `exports.drawPage`) e devolve o
 *  bounding box do conteúdo bruto (rawW x rawH) depois de transformado — é
 *  assim que confirmamos, sem precisar do pdf-lib de verdade, que a
 *  transformação calculada realmente cai no retângulo alvo. */
function transformedBoundingBox(rawW: number, rawH: number, t: ReturnType<typeof computeEmbeddedDrawTransform>) {
  const sx = t.drawWidth / rawW;
  const sy = t.drawHeight / rawH;
  const theta = (t.rotateDegCcw * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const corners = [[0, 0], [rawW, 0], [0, rawH], [rawW, rawH]].map(([u, v]) => {
    const su = u * sx;
    const sv = v * sy;
    return { x: t.x + (su * cos - sv * sin), y: t.y + (su * sin + sv * cos) };
  });

  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('computeEmbeddedDrawTransform', () => {
  const cases: Array<{ nativeCw: number; extraCw: number }> = [
    { nativeCw: 0, extraCw: 0 },
    { nativeCw: 90, extraCw: 0 },
    { nativeCw: 180, extraCw: 0 },
    { nativeCw: 270, extraCw: 0 },
    { nativeCw: 0, extraCw: 90 },
    { nativeCw: 90, extraCw: 90 }, // combinado = 180
    { nativeCw: 90, extraCw: 270 }, // combinado = 0 (cancela)
    { nativeCw: 270, extraCw: 270 }, // combinado = 180
  ];

  it.each(cases)('rotação nativa=%o cai exatamente no retângulo alvo', ({ nativeCw, extraCw }) => {
    const rawW = 120;
    const rawH = 80;
    const target = { x: 30, y: 50, width: 200, height: 140 };

    const transform = computeEmbeddedDrawTransform(nativeCw, extraCw, target.x, target.y, target.width, target.height);
    const bbox = transformedBoundingBox(rawW, rawH, transform);

    expect(bbox.minX).toBeCloseTo(target.x, 6);
    expect(bbox.minY).toBeCloseTo(target.y, 6);
    expect(bbox.maxX).toBeCloseTo(target.x + target.width, 6);
    expect(bbox.maxY).toBeCloseTo(target.y + target.height, 6);
  });

  it('sem rotação nenhuma, x/y não são deslocados', () => {
    const t = computeEmbeddedDrawTransform(0, 0, 10, 20, 100, 50);
    expect(t).toEqual({ drawWidth: 100, drawHeight: 50, x: 10, y: 20, rotateDegCcw: 0 });
  });
});

describe('normalizeAngle', () => {
  it('normaliza ângulos negativos e maiores que 360', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
  });
});

describe('effectiveSize', () => {
  it('não troca largura/altura em 0 ou 180', () => {
    expect(effectiveSize(100, 200, 0)).toEqual({ width: 100, height: 200 });
    expect(effectiveSize(100, 200, 180)).toEqual({ width: 100, height: 200 });
  });

  it('troca largura/altura em 90 ou 270 (página deitada)', () => {
    expect(effectiveSize(100, 200, 90)).toEqual({ width: 200, height: 100 });
    expect(effectiveSize(100, 200, 270)).toEqual({ width: 200, height: 100 });
  });
});
