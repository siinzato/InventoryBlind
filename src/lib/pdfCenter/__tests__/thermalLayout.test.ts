import { describe, expect, it } from 'vitest';
import { mmToPt } from '../units';
import { computeThermalLayout } from '../thermalLayout';
import { CUSTOM_SIZE_ID, findSizePreset, SIZE_PRESETS } from '../sizePresets';

const noMargin = { top: 0, right: 0, bottom: 0, left: 0 };

describe('computeThermalLayout', () => {
  it('presets térmicos existem com as dimensões corretas (40x25, 100x40, 100x150)', () => {
    expect(findSizePreset('40x25')).toMatchObject({ widthMm: 40, heightMm: 25 });
    expect(findSizePreset('100x40')).toMatchObject({ widthMm: 100, heightMm: 40 });
    expect(findSizePreset('100x150')).toMatchObject({ widthMm: 100, heightMm: 150 });
    expect(SIZE_PRESETS.find(p => p.id === CUSTOM_SIZE_ID)).toBeUndefined();
  });

  it('contain: cabe inteiro, centralizado, sem exceder a página', () => {
    const result = computeThermalLayout({
      sourceWidthPt: mmToPt(210), sourceHeightPt: mmToPt(297), // A4 origem
      targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150), // etiqueta destino
      fitMode: 'contain', orientation: 'auto',
      alignX: 'center', alignY: 'center', marginPt: noMargin,
      scale: 1, offsetXPt: 0, offsetYPt: 0, rotationDeg: 0,
    });
    expect(result.placedWidthPt).toBeLessThanOrEqual(result.pageWidthPt + 0.01);
    expect(result.placedHeightPt).toBeLessThanOrEqual(result.pageHeightPt + 0.01);
    expect(result.warnings).toEqual([]);
  });

  it('fill: preenche e avisa sobre recorte quando a proporção não bate', () => {
    const result = computeThermalLayout({
      sourceWidthPt: mmToPt(210), sourceHeightPt: mmToPt(297),
      targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150),
      fitMode: 'fill', orientation: 'auto',
      alignX: 'center', alignY: 'center', marginPt: noMargin,
      scale: 1, offsetXPt: 0, offsetYPt: 0, rotationDeg: 0,
    });
    expect(result.warnings.some(w => w.includes('Preencher'))).toBe(true);
  });

  it('original: nunca redimensiona mesmo se maior que a página, e avisa', () => {
    const result = computeThermalLayout({
      sourceWidthPt: mmToPt(210), sourceHeightPt: mmToPt(297),
      targetWidthPt: mmToPt(40), targetHeightPt: mmToPt(25),
      fitMode: 'original', orientation: 'auto',
      alignX: 'center', alignY: 'center', marginPt: noMargin,
      scale: 1, offsetXPt: 0, offsetYPt: 0, rotationDeg: 0,
    });
    expect(result.placedWidthPt).toBeCloseTo(mmToPt(210), 4);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('orientação auto gira a página destino para bater com a origem paisagem', () => {
    const result = computeThermalLayout({
      sourceWidthPt: mmToPt(150), sourceHeightPt: mmToPt(100), // origem paisagem
      targetWidthPt: mmToPt(100), targetHeightPt: mmToPt(150), // preset retrato
      fitMode: 'contain', orientation: 'auto',
      alignX: 'center', alignY: 'center', marginPt: noMargin,
      scale: 1, offsetXPt: 0, offsetYPt: 0, rotationDeg: 0,
    });
    expect(result.pageWidthPt).toBeCloseTo(mmToPt(150), 4);
    expect(result.pageHeightPt).toBeCloseTo(mmToPt(100), 4);
  });

  it('margens maiores que a página avisam e não geram área negativa', () => {
    const result = computeThermalLayout({
      sourceWidthPt: 100, sourceHeightPt: 100,
      targetWidthPt: 50, targetHeightPt: 50,
      fitMode: 'contain', orientation: 'auto',
      alignX: 'center', alignY: 'center', marginPt: { top: 30, right: 30, bottom: 30, left: 30 },
      scale: 1, offsetXPt: 0, offsetYPt: 0, rotationDeg: 0,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.placedWidthPt).toBe(0);
  });
});
