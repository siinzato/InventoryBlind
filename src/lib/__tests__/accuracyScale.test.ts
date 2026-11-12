import { describe, it, expect } from 'vitest';
import {
  ACCURACY_TARGET_PCT, ACCURACY_WARNING_FLOOR_PCT, DEFAULT_ACCURACY_TARGETS,
  classifyAccuracy, validateAccuracyTargets, ACCURACY_BAND_LABEL, ACCURACY_BAND_TONE,
} from '../accuracyScale';

describe('accuracyScale — cortes', () => {
  it('a meta é a mesma já escrita na tela do dashboard', () => {
    expect(ACCURACY_TARGET_PCT).toBe(95);
    expect(ACCURACY_WARNING_FLOOR_PCT).toBe(80);
  });

  it('o piso de atenção é menor que a meta', () => {
    expect(ACCURACY_WARNING_FLOOR_PCT).toBeLessThan(ACCURACY_TARGET_PCT);
  });
});

describe('classifyAccuracy — bandas', () => {
  it('na meta exata já é "meta"', () => {
    expect(classifyAccuracy(ACCURACY_TARGET_PCT)).toBe('meta');
    expect(classifyAccuracy(100)).toBe('meta');
  });

  it('no piso exato é "atencao", logo abaixo é "critico"', () => {
    expect(classifyAccuracy(ACCURACY_WARNING_FLOOR_PCT)).toBe('atencao');
    expect(classifyAccuracy(ACCURACY_WARNING_FLOOR_PCT - 0.1)).toBe('critico');
  });

  it('logo abaixo da meta é "atencao", nunca "meta"', () => {
    expect(classifyAccuracy(ACCURACY_TARGET_PCT - 0.1)).toBe('atencao');
  });

  it('sem valor é "insuficiente" — nunca "meta" por omissão', () => {
    expect(classifyAccuracy(null)).toBe('insuficiente');
    expect(classifyAccuracy(undefined)).toBe('insuficiente');
    expect(classifyAccuracy(NaN)).toBe('insuficiente');
  });

  it('zero é crítico, não "sem dados"', () => {
    expect(classifyAccuracy(0)).toBe('critico');
  });

  // Caso real que originou a régua: 86,5% (Garrafas Térmicas) saía VERDE no
  // dashboard — que pintava a partir de 80 — com a legenda "abaixo da meta"
  // logo ao lado, porque o texto comparava com 95.
  it('86,5% não é "meta" — era o valor que saía verde contradizendo a própria legenda', () => {
    expect(classifyAccuracy(86.5)).toBe('atencao');
    expect(classifyAccuracy(82.8)).toBe('atencao');
  });
});

describe('accuracyScale — rótulo e tom cobrem todas as bandas', () => {
  it('toda banda tem rótulo e tom', () => {
    for (const banda of ['meta', 'atencao', 'critico', 'insuficiente'] as const) {
      expect(ACCURACY_BAND_LABEL[banda]).toBeTruthy();
      expect(ACCURACY_BAND_TONE[banda]).toBeTruthy();
    }
  });

  it('só a banda "meta" usa tom positivo', () => {
    const positivas = Object.entries(ACCURACY_BAND_TONE).filter(([, t]) => t === 'positive');
    expect(positivas.map(([b]) => b)).toEqual(['meta']);
  });
});


describe('classifyAccuracy — meta por empresa', () => {
  // A meta de 95% é da AZ, não do produto. Outra empresa pode operar com outra.
  const empresaFolgada = { targetPct: 90, warningFloorPct: 70 };

  it('o mesmo valor muda de banda conforme a meta da empresa', () => {
    expect(classifyAccuracy(92)).toBe('atencao');
    expect(classifyAccuracy(92, empresaFolgada)).toBe('meta');
  });

  it('sem parâmetro continua valendo o default, sem mudar nada de hoje', () => {
    expect(classifyAccuracy(92)).toBe(classifyAccuracy(92, DEFAULT_ACCURACY_TARGETS));
    expect(DEFAULT_ACCURACY_TARGETS.targetPct).toBe(ACCURACY_TARGET_PCT);
    expect(DEFAULT_ACCURACY_TARGETS.warningFloorPct).toBe(ACCURACY_WARNING_FLOOR_PCT);
  });

  it('o piso da empresa também desloca o crítico', () => {
    expect(classifyAccuracy(75)).toBe('critico');
    expect(classifyAccuracy(75, empresaFolgada)).toBe('atencao');
  });
});

describe('validateAccuracyTargets', () => {
  it('o default do produto é válido', () => {
    expect(validateAccuracyTargets(DEFAULT_ACCURACY_TARGETS)).toBeNull();
  });

  it('piso maior ou igual à meta é recusado — deixaria a faixa de atenção vazia', () => {
    expect(validateAccuracyTargets({ targetPct: 90, warningFloorPct: 90 })).toBeTruthy();
    expect(validateAccuracyTargets({ targetPct: 90, warningFloorPct: 95 })).toBeTruthy();
  });

  it('fora de 0 a 100 é recusado', () => {
    expect(validateAccuracyTargets({ targetPct: 101, warningFloorPct: 80 })).toBeTruthy();
    expect(validateAccuracyTargets({ targetPct: 95, warningFloorPct: -1 })).toBeTruthy();
  });

  it('valor não numérico é recusado em vez de virar NaN silencioso', () => {
    expect(validateAccuracyTargets({ targetPct: NaN, warningFloorPct: 80 })).toBeTruthy();
  });

  it('aceita uma meta mais exigente que o default', () => {
    expect(validateAccuracyTargets({ targetPct: 99, warningFloorPct: 95 })).toBeNull();
  });
});
