// Configurações Avançadas > Webhooks — CRUD, teste e histórico de entregas
// (migrations 064 e 068). O segredo de assinatura só existe em texto puro no
// retorno de createWebhook/rotateWebhookSecret — nunca é lido de volta. Toda
// escrita passa pelas RPCs company_webhook_*, que revalidam papel/empresa/
// URL/eventos no servidor.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import type { WebhookEvent } from './webhookEvents';

export type { WebhookEvent };

/** Espelha o teto de tentativas de `company_webhook_record_attempt` (068). */
export const WEBHOOK_MAX_ATTEMPTS = 5;

export interface CompanyWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_delivery_at: string | null;
  last_delivery_status: 'delivered' | 'failed' | null;
  last_delivery_http_status: number | null;
}

export interface CompanyWebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: 'pending' | 'delivered' | 'failed' | 'exhausted';
  attempt_count: number;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface WebhookTestResult {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
}

export async function listWebhooks(): Promise<CompanyWebhook[]> {
  const { data, error } = await supabase
    .from('company_webhooks')
    .select('id, name, url, events, is_active, created_at, updated_at, last_delivery_at, last_delivery_status, last_delivery_http_status')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyWebhook[];
}

export async function listWebhookDeliveries(webhookId: string, limit = 25): Promise<CompanyWebhookDelivery[]> {
  const { data, error } = await supabase
    .from('company_webhook_deliveries')
    .select('id, webhook_id, event_type, status, attempt_count, http_status, duration_ms, error_message, created_at, delivered_at')
    .eq('webhook_id', webhookId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CompanyWebhookDelivery[];
}

export async function createWebhook(
  input: { name: string; url: string; events: WebhookEvent[] },
  companyId: string, userId: string, userEmail: string
): Promise<{ id: string; secret: string }> {
  const { data, error } = await supabase.rpc('company_webhook_create', {
    p_name: input.name, p_url: input.url, p_events: input.events,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;

  // Nunca o segredo — só o que identifica qual webhook foi criado.
  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.created',
    resourceType: 'company_webhook',
    resourceId: row.id,
    description: `Webhook "${input.name}" criado.`,
  });

  return { id: row.id, secret: row.secret };
}

export async function updateWebhook(
  id: string,
  input: { name: string; url: string; events: WebhookEvent[]; isActive: boolean },
  companyId: string, userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('company_webhook_update', {
    p_id: id, p_name: input.name, p_url: input.url, p_events: input.events, p_is_active: input.isActive,
  });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.updated',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Webhook "${input.name}" atualizado.`,
  });
}

export async function setWebhookActive(
  id: string, name: string, isActive: boolean,
  companyId: string, userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('company_webhook_set_active', { p_id: id, p_is_active: isActive });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: isActive ? 'webhook.enabled' : 'webhook.disabled',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Webhook "${name}" ${isActive ? 'ativado' : 'desativado'}.`,
  });
}

export async function deleteWebhook(
  id: string, name: string, companyId: string, userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('company_webhook_delete', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.deleted',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Webhook "${name}" removido.`,
  });
}

export async function rotateWebhookSecret(
  id: string, name: string, companyId: string, userId: string, userEmail: string
): Promise<string> {
  const { data, error } = await supabase.rpc('company_webhook_rotate_secret', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.secret_rotated',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Segredo do webhook "${name}" rotacionado.`,
  });

  return data as string;
}

/** Enfileira uma entrega de teste e pede a entrega IMEDIATA à Edge Function,
 *  para que a tela mostre status e tempo de resposta na hora em vez de esperar
 *  o cron. Se a entrega imediata falhar por qualquer motivo de infraestrutura,
 *  a entrega continua na fila e o cron ainda a processa — nada se perde. */
export async function sendWebhookTest(
  id: string, name: string, companyId: string, userId: string, userEmail: string
): Promise<WebhookTestResult> {
  const { data: deliveryId, error } = await supabase.rpc('company_webhook_send_test', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.test_sent',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Disparo de teste enviado para o webhook "${name}".`,
  });

  const { data, error: invokeError } = await supabase.functions.invoke('webhook-dispatch', {
    body: { mode: 'test', delivery_id: deliveryId },
  });

  if (invokeError) {
    return {
      ok: false,
      httpStatus: null,
      durationMs: null,
      error: 'Não foi possível concluir o teste agora. A entrega ficou na fila e será tentada automaticamente.',
    };
  }

  const result = (data ?? {}) as { ok?: boolean; http_status?: number | null; duration_ms?: number | null; error?: string | null };
  return {
    ok: result.ok === true,
    httpStatus: result.http_status ?? null,
    durationMs: result.duration_ms ?? null,
    error: result.error ?? null,
  };
}
