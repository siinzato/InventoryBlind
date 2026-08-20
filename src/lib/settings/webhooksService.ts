// Configurações Avançadas > Webhooks — CRUD e disparo de teste (migration
// 064). O segredo de assinatura só existe em texto puro no retorno de
// createWebhook/rotateWebhookSecret — nunca é lido de volta. Toda escrita
// passa pelas RPCs company_webhook_*, que revalidam papel/empresa/URL/eventos
// no servidor.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';

export type WebhookEvent = 'physical_count.finalized' | 'physical_count.approved';

export const WEBHOOK_EVENT_OPTIONS: { value: WebhookEvent; label: string }[] = [
  { value: 'physical_count.finalized', label: 'Contagem física finalizada' },
  { value: 'physical_count.approved', label: 'Contagem física aprovada' },
];

export interface CompanyWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanyWebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: 'pending' | 'delivered' | 'failed' | 'exhausted';
  attempt_count: number;
  http_status: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
}

export async function listWebhooks(): Promise<CompanyWebhook[]> {
  const { data, error } = await supabase
    .from('company_webhooks')
    .select('id, name, url, events, is_active, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CompanyWebhook[];
}

export async function listWebhookDeliveries(webhookId: string, limit = 20): Promise<CompanyWebhookDelivery[]> {
  const { data, error } = await supabase
    .from('company_webhook_deliveries')
    .select('id, webhook_id, event_type, status, attempt_count, http_status, error_message, created_at, delivered_at')
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

export async function sendWebhookTest(
  id: string, name: string, companyId: string, userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase.rpc('company_webhook_send_test', { p_id: id });
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail,
    action: 'webhook.test_sent',
    resourceType: 'company_webhook',
    resourceId: id,
    description: `Disparo de teste enviado para o webhook "${name}".`,
  });
}
