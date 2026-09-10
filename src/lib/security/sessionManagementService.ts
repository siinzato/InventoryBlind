import { supabase } from '../supabase';

// Camada fina sobre as RPCs admin_list_company_sessions / admin_revoke_session /
// admin_revoke_user_sessions / owner_revoke_company_sessions (migration 093) e a
// Edge Function session-geolocation. Toda validação de permissão, isolamento por
// empresa e regra de usuário multiempresa vive no banco — este módulo só
// mapeia parâmetros/retornos e nunca decide sozinho se uma ação é permitida.

export type SessionRoleFilter = 'all' | 'owner' | 'admin' | 'manager' | 'lead' | 'counter' | 'viewer';
export type SessionStatusFilter = 'all' | 'current' | 'active' | 'expired';

export interface CompanySessionRow {
  sessionId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  refreshedAt: string | null;
  notAfter: string | null;
  isCurrent: boolean;
  /** true quando o usuário não tem exatamente 1 vínculo empresarial ativo —
   *  a UI deve desabilitar as ações de revogação administrativa neste caso. */
  isMultiCompany: boolean;
}

export interface ListSessionsParams {
  search?: string;
  role?: SessionRoleFilter;
  status?: SessionStatusFilter;
  limit?: number;
  offset?: number;
}

export interface ListSessionsResult {
  sessions: CompanySessionRow[];
  totalCount: number;
}

export class SessionManagementError extends Error {}

const DEFAULT_ERROR = 'Não foi possível concluir esta ação agora. Tente novamente.';

function safeMessage(error: { message?: string } | null | undefined): string {
  const msg = error?.message?.trim();
  return msg && msg.length > 0 ? msg : DEFAULT_ERROR;
}

interface RawSessionRow {
  session_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  refreshed_at: string | null;
  not_after: string | null;
  is_current: boolean;
  is_multi_company: boolean;
  total_count: number | string;
}

function mapRow(row: RawSessionRow): CompanySessionRow {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userRole: row.user_role,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    refreshedAt: row.refreshed_at,
    notAfter: row.not_after,
    isCurrent: !!row.is_current,
    isMultiCompany: !!row.is_multi_company,
  };
}

export async function listCompanySessions(params: ListSessionsParams = {}): Promise<ListSessionsResult> {
  const { search, role = 'all', status = 'all', limit = 20, offset = 0 } = params;

  const { data, error } = await supabase.rpc('admin_list_company_sessions', {
    p_search: search?.trim() ? search.trim() : null,
    p_role: role !== 'all' ? role : null,
    p_status: status !== 'all' ? status : null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw new SessionManagementError(safeMessage(error));

  const rows = (data ?? []) as RawSessionRow[];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return { sessions: rows.map(mapRow), totalCount };
}

/** Encerra uma sessão específica. A própria RPC recusa a sessão atual do
 *  operador e usuários multiempresa — ver migration 093. */
export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_session', {
    p_session_id: sessionId,
    p_reason: reason.trim() || null,
  });
  if (error) throw new SessionManagementError(safeMessage(error));
}

/** Encerra todas as sessões de um usuário, preservando a sessão atual do
 *  operador (mesmo quando o alvo é o próprio operador). Retorna a quantidade
 *  efetivamente revogada. */
export async function revokeUserSessions(userId: string, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_revoke_user_sessions', {
    p_user_id: userId,
    p_reason: reason.trim() || null,
  });
  if (error) throw new SessionManagementError(safeMessage(error));
  return Number(data ?? 0);
}

export interface RevokeCompanyResult {
  revokedCount: number;
  skippedCount: number;
}

export const COMPANY_REVOKE_CONFIRMATION = 'ENCERRAR SESSÕES';

/** Ação de emergência, owner-only. Exige o texto de confirmação exato — a
 *  RPC recusa qualquer outro valor. */
export async function revokeCompanySessions(confirmation: string, reason: string): Promise<RevokeCompanyResult> {
  const { data, error } = await supabase.rpc('owner_revoke_company_sessions', {
    p_confirmation: confirmation,
    p_reason: reason.trim() || null,
  });
  if (error) throw new SessionManagementError(safeMessage(error));
  const row = Array.isArray(data) ? data[0] : data;
  return {
    revokedCount: Number(row?.revoked_count ?? 0),
    skippedCount: Number(row?.skipped_count ?? 0),
  };
}

export interface SessionLocation {
  available: boolean;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

/** Resolve localização aproximada via Edge Function (session-geolocation) —
 *  nunca chama o provedor de geolocalização diretamente do navegador, e uma
 *  falha aqui nunca deve impedir a listagem de sessões: em qualquer erro,
 *  cada sessão pedida volta marcada como "indisponível" em vez de propagar. */
export async function resolveSessionLocations(sessionIds: string[]): Promise<Record<string, SessionLocation>> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) return {};

  const unavailable = (): Record<string, SessionLocation> =>
    Object.fromEntries(ids.map(id => [id, { available: false }]));

  try {
    const { data, error } = await supabase.functions.invoke('session-geolocation', {
      body: { session_ids: ids },
    });
    if (error) return unavailable();

    const results = (data?.results ?? {}) as Record<string, {
      available?: boolean; city?: string | null; region?: string | null; country?: string | null; country_code?: string | null;
    }>;

    const out: Record<string, SessionLocation> = {};
    for (const id of ids) {
      const r = results[id];
      out[id] = r
        ? {
            available: !!r.available,
            city: r.city ?? null,
            region: r.region ?? null,
            country: r.country ?? null,
            countryCode: r.country_code ?? null,
          }
        : { available: false };
    }
    return out;
  } catch {
    return unavailable();
  }
}
