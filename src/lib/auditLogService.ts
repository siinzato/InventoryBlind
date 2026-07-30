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
  | 'access.denied';

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
