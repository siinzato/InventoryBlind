import { describe, expect, it } from 'vitest';
import {
  parseLocalDateTimeInput,
  toLocalDateTimeInputValue,
  formatFriendlyDuration,
  computeCountDuration,
  isFutureBeyondSkew,
  validateManualCountTiming,
} from '../countManagementUtils';

describe('parseLocalDateTimeInput / toLocalDateTimeInputValue', () => {
  it('campo vazio (estado inicial do formulário) não é uma data', () => {
    expect(parseLocalDateTimeInput('')).toBeNull();
  });

  it('faz ida e volta local <-> Date sem perder o instante (precisão de minuto)', () => {
    const original = new Date(2026, 7, 21, 14, 30);
    const inputValue = toLocalDateTimeInputValue(original);
    const parsed = parseLocalDateTimeInput(inputValue);
    expect(parsed?.getTime()).toBe(original.getTime());
  });

  it('o valor do botão "Agora" convertido para UTC e de volta preserva o instante', () => {
    const now = new Date();
    now.setSeconds(0, 0); // datetime-local não tem segundos
    const inputValue = toLocalDateTimeInputValue(now);
    const parsed = parseLocalDateTimeInput(inputValue)!;
    expect(parsed.toISOString()).toBe(now.toISOString());
  });
});

describe('formatFriendlyDuration', () => {
  it('menos de uma hora', () => {
    expect(formatFriendlyDuration(42 * 60000)).toBe('42min');
  });

  it('uma hora ou mais', () => {
    expect(formatFriendlyDuration((2 * 60 + 15) * 60000)).toBe('2h 15min');
  });

  it('mais de um dia', () => {
    expect(formatFriendlyDuration((27 * 60 + 20) * 60000)).toBe('1d 3h 20min');
  });
});

describe('computeCountDuration', () => {
  it('sem uma das datas: "Aguardando início e término", nunca um cronômetro', () => {
    const started = new Date('2026-08-21T14:00:00');
    expect(computeCountDuration(started, null).label).toBe('Aguardando início e término');
    expect(computeCountDuration(null, null).label).toBe('Aguardando início e término');
  });

  it('término anterior ao início não gera duração negativa', () => {
    const started = new Date('2026-08-21T14:00:00');
    const finished = new Date('2026-08-21T13:00:00');
    const result = computeCountDuration(started, finished);
    expect(result.ms).toBeNull();
    expect(result.label).toBe('Término anterior ao início');
  });

  it('calcula término - início corretamente', () => {
    const started = new Date('2026-08-21T14:00:00');
    const finished = new Date('2026-08-21T15:24:00');
    const result = computeCountDuration(started, finished);
    expect(result.ms).toBe(84 * 60000);
    expect(result.label).toBe('1h 24min');
  });
});

describe('isFutureBeyondSkew', () => {
  const now = new Date('2026-08-21T14:00:00Z');

  it('rejeita data claramente no futuro', () => {
    expect(isFutureBeyondSkew(new Date('2026-08-21T15:00:00Z'), now)).toBe(true);
  });

  it('tolera pequena diferença de relógio do dispositivo', () => {
    expect(isFutureBeyondSkew(new Date('2026-08-21T14:00:30Z'), now)).toBe(false);
  });

  it('não rejeita datas no passado', () => {
    expect(isFutureBeyondSkew(new Date('2026-08-21T10:00:00Z'), now)).toBe(false);
  });
});

describe('validateManualCountTiming', () => {
  const now = new Date('2026-08-21T14:00:00Z');

  it('exige início e término — não processa sem os dois', () => {
    const errors = validateManualCountTiming(null, null, now);
    expect(errors.startedAt).toBe('Informe quando a contagem começou.');
    expect(errors.finishedAt).toBe('Informe quando a contagem terminou.');
  });

  it('rejeita término anterior ao início', () => {
    const started = new Date('2026-08-21T12:00:00Z');
    const finished = new Date('2026-08-21T11:00:00Z');
    const errors = validateManualCountTiming(started, finished, now);
    expect(errors.finishedAt).toBe('O término não pode ser anterior ao início.');
  });

  it('rejeita datas futuras além da tolerância de relógio', () => {
    const started = new Date('2026-08-21T20:00:00Z');
    const finished = new Date('2026-08-21T21:00:00Z');
    const errors = validateManualCountTiming(started, finished, now);
    expect(errors.startedAt).toBe('A data informada não pode estar no futuro.');
    expect(errors.finishedAt).toBe('A data informada não pode estar no futuro.');
  });

  it('aceita início e término válidos sem erros', () => {
    const started = new Date('2026-08-21T10:00:00Z');
    const finished = new Date('2026-08-21T11:24:00Z');
    expect(validateManualCountTiming(started, finished, now)).toEqual({});
  });
});
