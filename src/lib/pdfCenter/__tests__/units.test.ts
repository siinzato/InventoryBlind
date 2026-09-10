import { describe, expect, it } from 'vitest';
import { mmToPt, ptToMm } from '../units';

describe('units mm <-> pt', () => {
  it('converte 25,4mm para exatamente 72pt (1 polegada)', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
  });

  it('converte 100mm', () => {
    expect(mmToPt(100)).toBeCloseTo(283.464567, 4);
  });

  it('é o inverso de ptToMm', () => {
    expect(ptToMm(mmToPt(150))).toBeCloseTo(150, 9);
  });

  it('40x25mm (etiqueta) em pontos', () => {
    expect(mmToPt(40)).toBeCloseTo(113.3858, 3);
    expect(mmToPt(25)).toBeCloseTo(70.8661, 3);
  });
});
