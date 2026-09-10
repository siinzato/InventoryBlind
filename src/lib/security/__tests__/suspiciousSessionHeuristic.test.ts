import { describe, expect, it } from 'vitest';
import { evaluateSuspiciousSessions, type HeuristicSessionInput } from '../suspiciousSessionHeuristic';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('evaluateSuspiciousSessions', () => {
  it('marca as duas sessões quando o mesmo usuário tem sessões recentes em países diferentes', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'BR' },
      { sessionId: 's2', userId: 'u1', lastActivityMs: NOW - 2 * HOUR, countryCode: 'US' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result.find(r => r.sessionId === 's1')?.suspicious).toBe(true);
    expect(result.find(r => r.sessionId === 's2')?.suspicious).toBe(true);
    expect(result.find(r => r.sessionId === 's1')?.reason).toMatch(/países diferentes/);
  });

  it('não marca quando as sessões do mesmo usuário estão no mesmo país', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'BR' },
      { sessionId: 's2', userId: 'u1', lastActivityMs: NOW - 2 * HOUR, countryCode: 'BR' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result.every(r => !r.suspicious)).toBe(true);
  });

  it('não marca quando a sessão de outro país está fora da janela de tempo', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'BR' },
      { sessionId: 's2', userId: 'u1', lastActivityMs: NOW - 30 * 24 * HOUR, countryCode: 'US' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result.find(r => r.sessionId === 's1')?.suspicious).toBe(false);
    expect(result.find(r => r.sessionId === 's2')?.suspicious).toBe(false);
  });

  it('nunca marca como suspeita só por país ausente — ausência de dado não é evidência', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: null },
      { sessionId: 's2', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: null },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result.every(r => !r.suspicious && r.reason === null)).toBe(true);
  });

  it('sessões de usuários diferentes em países diferentes não se cruzam', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'BR' },
      { sessionId: 's2', userId: 'u2', lastActivityMs: NOW - HOUR, countryCode: 'US' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result.every(r => !r.suspicious)).toBe(true);
  });

  it('sinal objetivo do provedor marca a sessão isoladamente, mesmo sem outra sessão do usuário', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW, countryCode: 'BR', objectiveSignal: 'Proxy conhecido detectado pelo provedor.' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result[0].suspicious).toBe(true);
    expect(result[0].reason).toBe('Proxy conhecido detectado pelo provedor.');
  });

  it('nunca revoga nada sozinha — é uma função pura que só classifica', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'BR' },
      { sessionId: 's2', userId: 'u1', lastActivityMs: NOW - HOUR, countryCode: 'US' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result).toHaveLength(2);
    for (const r of result) {
      expect(typeof r.suspicious).toBe('boolean');
    }
  });

  it('uma única sessão por usuário nunca é suspeita por país (não há o que comparar)', () => {
    const sessions: HeuristicSessionInput[] = [
      { sessionId: 's1', userId: 'u1', lastActivityMs: NOW, countryCode: 'BR' },
    ];
    const result = evaluateSuspiciousSessions(sessions, NOW);
    expect(result[0].suspicious).toBe(false);
  });
});
