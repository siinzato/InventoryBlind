import { supabase } from './supabase';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'products.import'
  | 'products.delete'
  | 'products.updated'
  | 'sales_import.completed'
  | 'sales_import.failed'
  | 'top10_config.updated'
  | 'inventory.create'
  | 'inventory.reset'
  | 'inventory.count'
  | 'full_operation.create'
  | 'full_operation.complete'
  | 'label.download'
  | 'report.export'
  | 'user.invite'
  | 'user.invite_accepted'
  | 'company.invite_code_generated'
  | 'company.invite_code_joined'
  | 'company.workspace_created'
  | 'company.profile_updated'
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
  | 'po.hard_deleted'
  // Linhas e Marcas de Produtos (migration 075).
  | 'product_brand.created'
  | 'product_brand.updated'
  | 'product_brand.deactivated'
  | 'product_line.created'
  | 'product_line.updated'
  | 'product_line.deactivated'
  | 'product_brand_association.confirmed'
  | 'product_brand_association.batch_classified'
  // Curva ABC (migration 078).
  | 'abc_curve.published'
  // Logística Reversa — recebimento, conferência, inspeção e destinação (migration 083).
  | 'reverse_logistics.received'
  | 'reverse_logistics.item_registered'
  | 'reverse_logistics.status_changed'
  | 'reverse_logistics.item_inspected'
  | 'reverse_logistics.destination_decided'
  | 'reverse_logistics.cancelled'
  // Logística Reversa — Fase 2: checklists configuráveis, grades, aprovações, assistência
  // técnica/recondicionamento, quarentena, lote (migration 084).
  | 'reverse_logistics.checklist_template_created'
  | 'reverse_logistics.checklist_template_updated'
  | 'reverse_logistics.condition_grade_created'
  | 'reverse_logistics.condition_grade_updated'
  | 'reverse_logistics.destination_rule_created'
  | 'reverse_logistics.destination_rule_updated'
  | 'reverse_logistics.approval_requested'
  | 'reverse_logistics.approval_approved'
  | 'reverse_logistics.approval_rejected'
  | 'reverse_logistics.service_order_created'
  | 'reverse_logistics.service_order_status_changed'
  | 'reverse_logistics.quarantine_hold_created'
  | 'reverse_logistics.quarantine_released'
  | 'reverse_logistics.batch_action_applied'
  // Logística Reversa — sincronização de restock com o Olist Tiny e localização por XML de
  // NF-e (migrations 085/086). A sincronização com o ERP não ganhou uma ação própria: ela
  // é registrada como metadado adicional (erpSyncAdjustmentId) do já existente
  // 'reverse_logistics.destination_decided'.
  | 'reverse_logistics.nfe_xml_return_created'
  // Retiradas Full — planejamento e acompanhamento de retirada de estoque do Full de
  // marketplace (migration 096). Sem conector real do Mercado Livre, o vínculo com a
  // retirada real é sempre um passo manual ('full_withdrawal_linked_ml').
  | 'reverse_logistics.full_withdrawal_created'
  | 'reverse_logistics.full_withdrawal_status_changed'
  | 'reverse_logistics.full_withdrawal_linked_ml'
  // Empresas fiscais (CNPJ) do workspace (migration 087). A maior parte destas ações é
  // gravada pelo próprio banco, dentro das RPCs fiscal_entities_* — 'settings.change'
  // não serviria porque essas mudanças precisam do próprio CNPJ/empresa no metadata,
  // não só de um rótulo genérico de configuração. Vínculo/desvínculo de integração é
  // gravado pelo client (IntegrationsPage), já que a escrita em si é direta via RLS.
  | 'fiscal_entity.created'
  | 'fiscal_entity.updated'
  | 'fiscal_entity.cnpj_changed'
  | 'fiscal_entity.default_changed'
  | 'fiscal_entity.archived'
  | 'fiscal_entity.restored'
  | 'fiscal_entity.integration_linked'
  | 'fiscal_entity.integration_unlinked'
  | 'fiscal_entity.channel_mapping_confirmed'
  // Gerenciamento administrativo de sessões (migration 093). Gravadas pelo próprio
  // banco, dentro das RPCs admin_revoke_session / admin_revoke_user_sessions /
  // owner_revoke_company_sessions — nunca pelo client.
  | 'security.session_revoked'
  | 'security.user_sessions_revoked'
  | 'security.company_sessions_revoked';

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
