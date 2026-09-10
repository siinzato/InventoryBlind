// Stub de e-mail — não há integração real (sem Edge Functions, sem Resend/SendGrid/etc no projeto).
// Simula o envio e deixa claro para a UI que a integração real pode ser configurada depois.

import { IncentiveType } from './supabase';

export interface EmployeeIncentiveEmailParams {
  employeeName: string;
  employeeEmail: string | null;
  type: IncentiveType;
  subject: string;
  message: string;
  rewardSuggestion: string | null;
}

export interface EmailSendResult {
  status: 'simulated';
  message: string;
}

const TEMPLATE_INTROS: Record<IncentiveType, string> = {
  parabens: 'Parabéns, {{nome}}!',
  agradecimento: 'Obrigado pelo seu trabalho, {{nome}}!',
  meta_atingida: '{{nome}}, você atingiu uma meta importante!',
  destaque: '{{nome}}, você é um destaque do período!',
  evolucao: '{{nome}}, sua evolução tem sido notável!',
  precisao: '{{nome}}, sua precisão está impecável!',
  full_manager: '{{nome}}, ótimo desempenho no Full Manager!',
  inventario: '{{nome}}, excelente trabalho no inventário!',
  personalizado: 'Olá, {{nome}}!',
};

/** Fills the placeholder-based template for a given incentive type — reused by the UI to preview
 *  the message before sending, and by sendEmployeeIncentiveEmail() as the simulated body. */
export function renderIncentiveTemplate(params: EmployeeIncentiveEmailParams): string {
  const intro = TEMPLATE_INTROS[params.type].replace('{{nome}}', params.employeeName);
  const rewardLine = params.rewardSuggestion ? `\n\nSugestão de reconhecimento: ${params.rewardSuggestion}` : '';
  return `${intro}\n\n${params.message}${rewardLine}`;
}

/** No real email provider is wired up yet — this simulates the send (never throws) so the
 *  caller can persist an employee_incentives row with status='simulated' either way. */
export async function sendEmployeeIncentiveEmail(params: EmployeeIncentiveEmailParams): Promise<EmailSendResult> {
  if (import.meta.env.DEV) {
    console.info('[EmailService] Simulando envio de e-mail (sem integração real configurada):', {
      to: params.employeeEmail,
      subject: params.subject,
      body: renderIncentiveTemplate(params),
    });
  }

  return {
    status: 'simulated',
    message: 'Envio de e-mail simulado — integração com um provedor real (ex: Resend, SendGrid) pode ser configurada futuramente.',
  };
}
