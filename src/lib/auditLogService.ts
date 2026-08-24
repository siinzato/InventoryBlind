import { supabase } from './supabase';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'products.import'
  | 'products.delete'
  | 'inventory.create'
  | 'inventory.reset'
  | 'inventory.count'
  | 'full_operation.create'
  | 'full_operation.complete'
  | 'label.download'
  | 'report.export'
  | 'user.invite'
  | 'user.role_change'
  | 'user.remove'
  | 'erp.token_change'
  | 'erp.connect'
  | 'settings.change'
  | 'access.denied'
  | 'productivity.view_team'
  | 'productivity.report_export'
  | 'productivity.incentive_sent'
  | 'academy.course_started'
  | 'academy.course_completed'
  | 'academy.quiz_attempted'
  | 'academy.certificate_generated'
  | 'academy.pdi_created'
  | 'academy.view_team'
  // Automações (migration 051+). Ações que criam trabalho ou alteram estoque sozinhas
  // pertencem ao mesmo rastro de auditoria do resto do sistema.
  | 'automation.created'
  | 'automation.updated'
  | 'automation.activated'
  | 'automation.deactivated'
  | 'automation.deleted'
  | 'cbc.recompute'
  | 'risk.recompute'
  | 'risk.criticality_override'
  | 'abcxyz.recompute'
  | 'slotting.layout_updated'
  | 'slotting.recommendation_decided'
  | 'slotting.sku_moved'
  | 'rca.divergence_classified'
  | 'rca.five_whys_opened'
  | 'rca.five_whys_answered'
  | 'rca.five_whys_completed'
  | 'rca.settings_updated'
  | 'audit.count_approved'
  | 'audit.statistical_run'
  | 'physical_count.session_started'
  // Gravadas pelo próprio banco, dentro de pc_admin_update_session /
  // pc_admin_delete_session (migration 059) — não por logAuditEvent. Estão aqui
  // porque a tela de auditoria lê `action` por este tipo.
  | 'physical_count.session_updated'
  | 'physical_count.session_deleted'
  | 'physical_count.session_restored'
  | 'physical_count.session_hard_deleted'
  | 'physical_count.session_reopened'
  // NF-e / Entradas (migration 062). Gravadas pelo banco, dentro das RPCs
  // nfe_admin_* e de nfe_reopen_conference. A nota nunca é editada — uma
  // correção de quantidade é um evento novo, não uma reescrita.
  | 'nfe.invoice_archived'
  | 'nfe.invoice_restored'
  | 'nfe.invoice_hard_deleted'
  | 'nfe.count_corrected'
  | 'nfe.conference_reopened'
  | 'physical_count.finalized'
  | 'physical_count.recount_created'
  | 'physical_count.approved'
  | 'physical_count.erp_sync_attempted'
  | 'tools.inventoryfull_download_started'
  // Configurações Avançadas — Chaves de API e Webhooks (migrations 063-065).
  | 'apikey.created'
  | 'apikey.revoked'
  | 'apikey.deleted'
  | 'webhook.created'
  | 'webhook.updated'
  | 'webhook.enabled'
  | 'webhook.disabled'
  | 'webhook.deleted'
  | 'webhook.secret_rotated'
  | 'webhook.test_sent'
  // Resumo de fechamento de linha/marca (migration 073).
  | 'closing_report.generated'
  | 'closing_report.reprocessed'
  | 'closing_category.saved'
  | 'closing_category.deactivated'
  // Ordens de Compra (migration 074).
  | 'po.created'
  | 'po.updated'
  | 'po.imported'
  | 'po.linked'
  | 'po.unlinked'
  | 'po.deto_para_confirmed'
  | 'po.deto_para_deactivated'
  | 'po.allocation_adjusted'
  | 'po.closed'
  | 'po.closed_with_differences'
  | 'po.cancelled'
  | 'po.hard_deleted';

interface LogParams {
  companyId: string;
  userId: string;
  userEmail: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(params: LogParams): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      company_id:    params.companyId,
      user_id:       params.userId,
      user_email:    params.userEmail,
      action:        params.action,
      resource_type: params.resourceType ?? null,
      resource_id:   params.resourceId ?? null,
      description:   params.description ?? null,
      ip_address:    null,
      user_agent:    typeof navigator !== 'undefined' ? navigator.userAgent : null,
      metadata:      params.metadata ?? {},
    });
    if (error) console.warn('[Audit] Failed to log event:', error.message);
  } catch (err) {
    console.warn('[Audit] Unexpected error:', err);
  }
}

export interface AuditLog {
  id: string;
  company_id: string;
  user_id: string;
  user_email: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SecurityLog {
  id: string;
  company_id: string;
  user_id: string | null;
  event_type: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
