import { describe, expect, it } from 'vitest';
import { normalizeInviteCode, isInviteCodeFormatValid, maskInviteCode, INVITE_CODE_LENGTH } from '../inviteCodeRules';

describe('normalizeInviteCode', () => {
  it('maiúsculas e sem espaços em volta', () => {
    expect(normalizeInviteCode('  ab3dfghj  ')).toBe('AB3DFGHJ');
  });
});

describe('isInviteCodeFormatValid', () => {
  it('código de 8 caracteres do alfabeto sem ambíguos é válido', () => {
    expect(isInviteCodeFormatValid('AB3DFGHJ')).toBe(true);
    expect(INVITE_CODE_LENGTH).toBe(8);
  });

  it('aceita minúsculas e normaliza antes de validar', () => {
    expect(isInviteCodeFormatValid('ab3dfghj')).toBe(true);
  });

  it('rejeita comprimento errado', () => {
    expect(isInviteCodeFormatValid('AB3DF')).toBe(false);
    expect(isInviteCodeFormatValid('AB3DFGHJK')).toBe(false);
  });

  it('rejeita caracteres ambíguos (O, 0, I, 1) — nunca fazem parte do alfabeto gerado', () => {
    expect(isInviteCodeFormatValid('AB3DFGHO')).toBe(false);
    expect(isInviteCodeFormatValid('AB3DFGH0')).toBe(false);
    expect(isInviteCodeFormatValid('AB3DFGHI')).toBe(false);
    expect(isInviteCodeFormatValid('AB3DFGH1')).toBe(false);
  });

  it('rejeita vazio', () => {
    expect(isInviteCodeFormatValid('')).toBe(false);
  });
});

describe('maskInviteCode', () => {
  it('mostra só os 2 primeiros e 2 últimos caracteres — mesma máscara gravada em audit_logs', () => {
    expect(maskInviteCode('ab3dfghj')).toBe('AB••••HJ');
  });

  it('código muito curto não é mascarado (mostra tudo, nada a esconder com <=4 chars)', () => {
    expect(maskInviteCode('AB3D')).toBe('AB3D');
  });
});
