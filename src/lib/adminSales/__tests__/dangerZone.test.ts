import { describe, expect, it } from 'vitest';
import { canAccessDangerZone, validateDangerZoneForm, RESET_CONFIRMATION_PHRASE } from '../dangerZone';

describe('canAccessDangerZone', () => {
  it('permite owner e admin', () => {
    expect(canAccessDangerZone('owner')).toBe(true);
    expect(canAccessDangerZone('admin')).toBe(true);
  });

  it('nega manager, lead, counter, viewer e ausência de papel', () => {
    expect(canAccessDangerZone('manager')).toBe(false);
    expect(canAccessDangerZone('lead')).toBe(false);
    expect(canAccessDangerZone('counter')).toBe(false);
    expect(canAccessDangerZone('viewer')).toBe(false);
    expect(canAccessDangerZone(null)).toBe(false);
    expect(canAccessDangerZone(undefined)).toBe(false);
  });
});

describe('validateDangerZoneForm', () => {
  const base = { name: 'Inventário Agosto', reason: 'Fechamento mensal do ciclo', confirmationPhrase: RESET_CONFIRMATION_PHRASE };

  it('aceita quando nome, justificativa (>=5 chars) e frase de confirmação exata estão corretos', () => {
    expect(validateDangerZoneForm(base).valid).toBe(true);
  });

  it('rejeita frase de confirmação incorreta', () => {
    const result = validateDangerZoneForm({ ...base, confirmationPhrase: 'confirmar' });
    expect(result.valid).toBe(false);
    expect(result.errors.confirmationPhrase).toBeDefined();
  });

  it('aceita a frase de confirmação independente de maiúsculas/minúsculas e espaços nas pontas', () => {
    const result = validateDangerZoneForm({ ...base, confirmationPhrase: `  ${RESET_CONFIRMATION_PHRASE.toLowerCase()}  ` });
    expect(result.valid).toBe(true);
  });

  it('rejeita justificativa vazia ou curta demais', () => {
    expect(validateDangerZoneForm({ ...base, reason: '' }).errors.reason).toBeDefined();
    expect(validateDangerZoneForm({ ...base, reason: 'ok' }).errors.reason).toBeDefined();
  });

  it('rejeita nome vazio', () => {
    expect(validateDangerZoneForm({ ...base, name: '  ' }).errors.name).toBeDefined();
  });
});
