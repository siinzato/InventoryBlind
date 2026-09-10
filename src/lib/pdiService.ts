// I.B Academy — PDI (Plano de Desenvolvimento Individual). Planos são autorados pela
// liderança (RLS restringe insert/update a owner/admin/manager/lead); o colaborador só
// marca seus próprios passos como concluídos.

import { supabase, PdiPlan, PdiStep } from './supabase';
import { logAuditEvent } from './auditLogService';

export type PdiPlanWithSteps = PdiPlan & { steps: PdiStep[] };

async function attachSteps(plans: PdiPlan[]): Promise<PdiPlanWithSteps[]> {
  if (plans.length === 0) return [];
  const { data: steps, error } = await supabase
    .from('pdi_steps').select('*').in('pdi_plan_id', plans.map(p => p.id)).order('order_index');
  if (error) console.error('Error loading PDI steps:', error);

  const stepsByPlan = new Map<string, PdiStep[]>();
  for (const step of (steps ?? []) as PdiStep[]) {
    const list = stepsByPlan.get(step.pdi_plan_id) ?? [];
    list.push(step);
    stepsByPlan.set(step.pdi_plan_id, list);
  }
  return plans.map(p => ({ ...p, steps: stepsByPlan.get(p.id) ?? [] }));
}

export async function getMyPDI(userId: string, companyId: string): Promise<PdiPlanWithSteps[]> {
  const { data, error } = await supabase
    .from('pdi_plans').select('*').eq('employee_user_id', userId).eq('company_id', companyId).order('created_at', { ascending: false });
  if (error) { console.error('Error loading PDI plans:', error); return []; }
  return attachSteps((data ?? []) as PdiPlan[]);
}

export async function getEmployeePDI(employeeUserId: string, companyId: string): Promise<PdiPlanWithSteps[]> {
  return getMyPDI(employeeUserId, companyId);
}

export async function createPDIPlan(
  companyId: string,
  creatorUserId: string,
  creatorEmail: string,
  employeeUserId: string,
  goalTitle: string,
  goalDescription: string,
  steps: { title: string; courseId?: string }[]
): Promise<PdiPlanWithSteps | null> {
  const { data: plan, error: planError } = await supabase
    .from('pdi_plans')
    .insert({ company_id: companyId, employee_user_id: employeeUserId, created_by: creatorUserId, goal_title: goalTitle, goal_description: goalDescription || null })
    .select()
    .maybeSingle();

  if (planError || !plan) { console.error('Error creating PDI plan:', planError); return null; }

  const stepRows = steps.map((s, i) => ({
    company_id: companyId, pdi_plan_id: plan.id, title: s.title, course_id: s.courseId ?? null, order_index: i,
  }));

  const { data: insertedSteps, error: stepsError } = stepRows.length > 0
    ? await supabase.from('pdi_steps').insert(stepRows).select()
    : { data: [], error: null };

  if (stepsError) console.error('Error creating PDI steps:', stepsError);

  await logAuditEvent({ companyId, userId: creatorUserId, userEmail: creatorEmail, action: 'academy.pdi_created', resourceType: 'pdi_plan', resourceId: plan.id });

  return { ...(plan as PdiPlan), steps: (insertedSteps ?? []) as PdiStep[] };
}

export async function toggleStepComplete(stepId: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from('pdi_steps')
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq('id', stepId);
  if (error) console.error('Error updating PDI step:', error);
}

export function computePDIProgressPct(steps: PdiStep[]): number {
  if (steps.length === 0) return 0;
  return Math.round((steps.filter(s => s.completed).length / steps.length) * 100);
}
