// Regras puras espelhando accept_pending_invitations() (migration 080) — a decisão real de quem
// entra em qual empresa é sempre tomada no servidor (RPC SECURITY DEFINER); este módulo existe para
// que a mesma lógica de "esse convite serve para esse e-mail agora?" seja testável sem banco.

import type { CompanyInvitation } from './invitationTypes';

/** Mesma normalização usada na migration: lower(btrim(email)). Deliberadamente SEM tratar alias
 *  (+tag, pontos de Gmail) — ver o comentário da migration 080 sobre por quê. */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type InvitationRejectionReason =
  | 'not_pending'
  | 'expired'
  | 'wrong_recipient';

export interface InvitationUsability {
  ok: boolean;
  reason?: InvitationRejectionReason;
}

/** Mesma sequência de validação do laço em accept_pending_invitations(): status, expiração,
 *  depois e-mail do destinatário (comparado já normalizado dos dois lados). */
export function isInvitationUsable(
  invitation: Pick<CompanyInvitation, 'status' | 'expiresAt' | 'emailNormalized'>,
  params: { nowISO: string; recipientEmail: string }
): InvitationUsability {
  if (invitation.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (invitation.expiresAt < params.nowISO) return { ok: false, reason: 'expired' };
  if (invitation.emailNormalized !== normalizeInviteEmail(params.recipientEmail)) {
    return { ok: false, reason: 'wrong_recipient' };
  }
  return { ok: true };
}
