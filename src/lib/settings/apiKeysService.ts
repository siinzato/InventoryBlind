// Configurações Avançadas > API — ciclo de vida das chaves (migrations 063 e 067).
//
// O valor em texto puro da chave só existe no retorno de createApiKey, uma
// única vez, logo depois da criação — o servidor nunca grava nem devolve o
// valor cru de novo. Toda escrita passa pelas RPCs api_key_create/
// api_key_revoke/api_key_delete, que revalidam papel (owner/admin) e resolvem
// company_id a partir do usuário autenticado — nunca de um parâmetro do
// cliente.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';

export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKey {
  plaintext_key: string;
}

export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/** Revogada vence expirada: uma chave revogada nunca volta a funcionar, mesmo
 *  que a data de expiração ainda esteja no futuro. */
export function apiKeyStatus(key: ApiKey, now: Date = new Date()): ApiKeyStatus {
  if (key.revoked_at) return 'revoked';
  if (key.expires_at && new Date(key.expires_at) <= now) return 'expired';
  return 'active';
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, description, key_prefix, created_at, expires_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApiKey[];
}

export interface CreateApiKeyInput {
  name: string;
  description?: string | null;
  /** ISO 8601. `null`/ausente = sem expiração. */
  expiresAt?: string | null;
}

export async function createApiKey(
  input: CreateApiKeyInput,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<CreatedApiKey> {
  const { data, error } = await supabase.rpc('api_key_create', {
    p_name: input.name,
    p_description: input.description ?? null,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const created: CreatedApiKey = {
    id: row.id,
    name: input.name,
    description: input.description ?? null,
    key_prefix: row.key_prefix,
    created_at: row.created_at,
    expires_at: row.expires_at ?? null,
    last_used_at: null,
    revoked_at: null,
    plaintext_key: row.plaintext_key,
  };

  // Nunca o valor da chave — só o que identifica qual chave foi criada.
  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'apikey.created',
    resourceType: 'api_key',
    resourceId: created.id,
    description: `Chave de API "${input.name}" criada.`,
  });

  return created;
}

export async function revokeApiKey(
  id: string,
  name: string,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('api_key_revoke', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'apikey.revoked',
    resourceType: 'api_key',
    resourceId: id,
    description: `Chave de API "${name}" revogada.`,
  });
}

/** Só uma chave já revogada pode ser excluída — a RPC recusa qualquer outra. */
export async function deleteApiKey(
  id: string,
  name: string,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('api_key_delete', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'apikey.deleted',
    resourceType: 'api_key',
    resourceId: id,
    description: `Chave de API "${name}" excluída da lista.`,
  });
}
