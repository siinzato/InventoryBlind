// Aceite de Termos e Política — regras puras (sem Supabase, para serem testáveis).

import { PRIVACY_VERSION, TERMS_VERSION } from '../../config/legal';

export interface LegalAcceptance {
  id: string;
  userId: string;
  companyId: string | null;
  termsVersion: string;
  privacyVersion: string;
  /** Sempre do banco. Ver o cabeçalho da migration 066. */
  acceptedAt: string;
}

export interface AcceptedVersions {
  termsVersion: string;
  privacyVersion: string;
}

export const CURRENT_VERSIONS: AcceptedVersions = {
  termsVersion: TERMS_VERSION.version,
  privacyVersion: PRIVACY_VERSION.version,
};

/**
 * Precisa aceitar?
 *
 * Sem aceite nenhum, sim. Com aceite de versão diferente da vigente, sim — é o
 * que faz um usuário antigo voltar a ver a tela quando um documento muda. NÃO é
 * criado aceite retroativo em nenhum caso: ausência de registro significa que
 * aquela pessoa nunca aceitou, e é isso que a tela pede.
 */
export function needsAcceptance(
  latest: LegalAcceptance | null,
  current: AcceptedVersions = CURRENT_VERSIONS
): boolean {
  if (latest == null) return true;
  return (
    latest.termsVersion !== current.termsVersion || latest.privacyVersion !== current.privacyVersion
  );
}

/** Payload da RPC. As versões enviadas são as que a interface de fato
 *  apresentou; o banco recusa versão que não conheça (migration 066). */
export function buildAcceptanceRpcArgs(
  current: AcceptedVersions = CURRENT_VERSIONS
): { p_terms_version: string; p_privacy_version: string } {
  return {
    p_terms_version: current.termsVersion,
    p_privacy_version: current.privacyVersion,
  };
}

export function mapAcceptance(row: Record<string, unknown>): LegalAcceptance {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    companyId: (row.company_id as string | null) ?? null,
    termsVersion: row.terms_version as string,
    privacyVersion: row.privacy_version as string,
    acceptedAt: row.accepted_at as string,
  };
}

export function formatAcceptedAt(acceptedAt: string): string {
  return new Date(acceptedAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
