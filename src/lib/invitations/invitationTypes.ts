// Tipos do domínio de convite de funcionário. A tabela/RPCs reais vivem na migration 080
// (company_invitations / create_company_invitation / accept_pending_invitations) — este arquivo só
// espelha o formato para uso puro (sem banco) em invitationRules.ts e em quem consumir o retorno
// das RPCs no frontend.

export type InvitationStatus = 'pending' | 'accepted' | 'expired';

export type InvitationRole = 'admin' | 'manager' | 'counter' | 'viewer';

export interface CompanyInvitation {
  id: string;
  companyId: string;
  email: string;
  emailNormalized: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string; // ISO
}
