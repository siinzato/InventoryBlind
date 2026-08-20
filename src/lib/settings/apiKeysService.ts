// Configurações Avançadas > API — CRUD de chaves de API (migration 063).
//
// O valor em texto puro da chave só existe no retorno de createApiKey, uma
// única vez, logo depois da criação — o servidor nunca grava nem devolve o
// valor cru de novo. Toda escrita passa pelas RPCs api_key_create/
// api_key_revoke, que revalidam papel (owner/admin) e resolvem company_id a
// partir do usuário autenticado — nunca de um parâmetro do cliente.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKey {
  plaintext_key: string;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApiKey[];
}

export async function createApiKey(
  name: string,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<CreatedApiKey> {
  const { data, error } = await supabase.rpc('api_key_create', { p_name: name });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const created: CreatedApiKey = {
    id: row.id,
    name,
    key_prefix: row.key_prefix,
    created_at: row.created_at,
    last_used_at: null,
    revoked_at: null,
    plaintext_key: row.plaintext_key,
  };

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'apikey.created',
    resourceType: 'api_key',
    resourceId: created.id,
    description: `Chave de API "${name}" criada.`,
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
