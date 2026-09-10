// Envio de incentivo ao colaborador — grava histórico, simula e-mail (emailService.ts), registra auditoria.

import { supabase, IncentiveType, EmployeeIncentive } from './supabase';
import { sendEmployeeIncentiveEmail } from './emailService';
import { logAuditEvent } from './auditLogService';

export interface SendIncentiveParams {
  companyId: string;
  sentByUserId: string;
  sentByEmail: string;
  employeeUserId: string;
  employeeName: string;
  employeeEmail: string | null;
  type: IncentiveType;
  subject: string;
  message: string;
  rewardSuggestion: string | null;
  ccManager: boolean;
}

export async function sendEmployeeIncentive(params: SendIncentiveParams): Promise<EmployeeIncentive | null> {
  const emailResult = await sendEmployeeIncentiveEmail({
    employeeName: params.employeeName,
    employeeEmail: params.employeeEmail,
    type: params.type,
    subject: params.subject,
    message: params.message,
    rewardSuggestion: params.rewardSuggestion,
  });

  const { data, error } = await supabase
    .from('employee_incentives')
    .insert({
      company_id: params.companyId,
      employee_user_id: params.employeeUserId,
      sent_by: params.sentByUserId,
      type: params.type,
      subject: params.subject,
      message: params.message,
      reward_suggestion: params.rewardSuggestion,
      cc_manager: params.ccManager,
      status: emailResult.status,
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving employee incentive:', error);
    return null;
  }

  await logAuditEvent({
    companyId: params.companyId,
    userId: params.sentByUserId,
    userEmail: params.sentByEmail,
    action: 'productivity.incentive_sent',
    resourceType: 'employee_incentive',
    resourceId: data.id,
    metadata: { employeeUserId: params.employeeUserId, type: params.type },
  });

  return data as EmployeeIncentive;
}

export async function listIncentivesForEmployee(employeeUserId: string, companyId: string): Promise<EmployeeIncentive[]> {
  const { data, error } = await supabase
    .from('employee_incentives')
    .select('*')
    .eq('employee_user_id', employeeUserId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading incentives:', error);
    return [];
  }
  return (data ?? []) as EmployeeIncentive[];
}
