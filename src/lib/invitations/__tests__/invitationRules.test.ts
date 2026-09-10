import { describe, expect, it } from 'vitest';
import { normalizeInviteEmail, isInvitationUsable } from '../invitationRules';
import type { CompanyInvitation } from '../invitationTypes';

const NOW = '2026-08-26T12:00:00.000Z';

function invite(overrides: Partial<CompanyInvitation> = {}): Pick<CompanyInvitation, 'status' | 'expiresAt' | 'emailNormalized'> {
  return {
    status: 'pending',
    expiresAt: '2026-09-02T12:00:00.000Z',
    emailNormalized: 'giovanni@azbuy.com.br',
    ...overrides,
  };
}

describe('normalizeInviteEmail', () => {
  it('remove espaços e diferenças de maiúsculas', () => {
    expect(normalizeInviteEmail('  Giovanni@AzBuy.com.br  ')).toBe('giovanni@azbuy.com.br');
  });

  it('não trata alias (+tag) como o mesmo endereço — decisão deliberada de segurança', () => {
    expect(normalizeInviteEmail('giovanni+teste@azbuy.com.br')).not.toBe('giovanni@azbuy.com.br');
  });
});

describe('isInvitationUsable — usuário novo aceitando convite', () => {
  it('convite pendente, não expirado, mesmo e-mail: aceito', () => {
    const result = isInvitationUsable(invite(), { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' });
    expect(result).toEqual({ ok: true });
  });
});

describe('isInvitationUsable — usuário existente aceitando convite', () => {
  it('mesma regra vale para quem já tem conta — a função não distingue novo de existente', () => {
    // A RPC real (accept_pending_invitations) resolve por e-mail, nunca por "profile é novo?" —
    // este teste documenta que a camada de regra segue o mesmo contrato.
    const result = isInvitationUsable(invite(), { nowISO: NOW, recipientEmail: 'GIOVANNI@azbuy.com.br' });
    expect(result).toEqual({ ok: true });
  });

  it('espaço em volta do e-mail do destinatário ainda bate', () => {
    const result = isInvitationUsable(invite(), { nowISO: NOW, recipientEmail: '  giovanni@azbuy.com.br  ' });
    expect(result).toEqual({ ok: true });
  });
});

describe('isInvitationUsable — convite inválido, expirado ou de outro e-mail', () => {
  it('convite já aceito não pode ser reusado', () => {
    const result = isInvitationUsable(invite({ status: 'accepted' }), { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' });
    expect(result).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('convite marcado como expirado é rejeitado mesmo com e-mail certo', () => {
    const result = isInvitationUsable(invite({ status: 'expired' }), { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' });
    expect(result).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('data de expiração no passado é rejeitada mesmo se o status ainda diz pending (corrida com a marcação)', () => {
    const result = isInvitationUsable(
      invite({ expiresAt: '2026-08-01T00:00:00.000Z' }),
      { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' }
    );
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('e-mail de outro destinatário nunca concede acesso a este convite', () => {
    const result = isInvitationUsable(invite(), { nowISO: NOW, recipientEmail: 'outra.pessoa@azbuy.com.br' });
    expect(result).toEqual({ ok: false, reason: 'wrong_recipient' });
  });

  it('convidado não recebe permissão para o workspace de um convite de outra empresa: e-mail bate mas o convite consultado é o errado', () => {
    // Simula a situação real: duas empresas convidam e-mails parecidos. A camada de regra só
    // valida O CONVITE PASSADO A ELA — a seleção de "qual convite pertence a essa empresa" é
    // responsabilidade da query (WHERE email_normalized = ... AND status = 'pending'), não desta
    // função. Aqui garantimos que um e-mail companyA@empresa.com nunca é aceito para o convite de
    // companyB@empresa.com, mesmo que ambos existam.
    const inviteFromCompanyB = invite({ emailNormalized: 'funcionario@empresab.com' });
    const result = isInvitationUsable(inviteFromCompanyB, { nowISO: NOW, recipientEmail: 'funcionario@empresaa.com' });
    expect(result).toEqual({ ok: false, reason: 'wrong_recipient' });
  });
});

describe('isInvitationUsable — reabertura do mesmo convite (idempotência na camada de regra)', () => {
  it('avaliar o mesmo convite pendente duas vezes seguidas produz o mesmo resultado', () => {
    const inv = invite();
    const first = isInvitationUsable(inv, { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' });
    const second = isInvitationUsable(inv, { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' });
    expect(first).toEqual(second);
    expect(first).toEqual({ ok: true });
  });

  it('depois de aceito (status muda para accepted), reprocessar o mesmo convite não concede de novo', () => {
    const pending = invite();
    const accepted = { ...pending, status: 'accepted' as const };
    expect(isInvitationUsable(pending, { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' }).ok).toBe(true);
    expect(isInvitationUsable(accepted, { nowISO: NOW, recipientEmail: 'giovanni@azbuy.com.br' }).ok).toBe(false);
  });
});
