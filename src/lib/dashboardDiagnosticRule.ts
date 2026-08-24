// Regra única de elegibilidade do aviso de diagnóstico no dashboard — nenhuma
// condição duplicada no componente visual. Pura: mesma entrada, mesma saída.
//
// O convite só aparece quando pelo menos UMA condição de contexto é verdadeira —
// nunca por padrão, então um workspace maduro num plano completo (ex.: AZ) sem
// nenhum gatilho não recebe o aviso.

/** Workspace "recém-criado": até este número de dias após a criação. Constante
 *  central — mudar aqui muda a regra em todo lugar que a usa. */
export const NEW_WORKSPACE_DAYS = 14;

/** "Poucos SKUs": mesmo corte já usado como primeira faixa do próprio
 *  questionário do diagnóstico ("até 500" em operationDiagnostic.ts), reaproveitado
 *  aqui em vez de inventar um segundo número. */
export const LOW_SKU_THRESHOLD = 500;

export interface DiagnosticEligibilityInput {
  /** Diagnóstico já respondido — nunca reaparece depois disso. */
  diagnosticCompleted: boolean;
  /** ISO de criação do workspace, ou null se desconhecido (nunca dispara por essa condição). */
  companyCreatedAt: string | null;
  /** Total de SKUs do workspace, ou null se desconhecido (nunca dispara por essa condição). */
  productCount: number | null;
  /** Sinal de tentativa recente de acessar função bloqueada por outro plano. */
  hasBlockedFeatureInterest: boolean;
  now?: Date;
}

export interface DiagnosticEligibility {
  eligible: boolean;
  /** Motivo(s) que tornaram elegível — vazio quando `eligible` é false. */
  reasons: ('new_workspace' | 'low_sku_count' | 'blocked_feature_interest')[];
}

export function evaluateDiagnosticEligibility(input: DiagnosticEligibilityInput): DiagnosticEligibility {
  if (input.diagnosticCompleted) return { eligible: false, reasons: [] };

  const now = input.now ?? new Date();
  const reasons: DiagnosticEligibility['reasons'] = [];

  if (input.companyCreatedAt != null) {
    const ageMs = now.getTime() - new Date(input.companyCreatedAt).getTime();
    if (ageMs >= 0 && ageMs < NEW_WORKSPACE_DAYS * 24 * 60 * 60 * 1000) reasons.push('new_workspace');
  }

  if (input.productCount != null && input.productCount < LOW_SKU_THRESHOLD) reasons.push('low_sku_count');

  if (input.hasBlockedFeatureInterest) reasons.push('blocked_feature_interest');

  return { eligible: reasons.length > 0, reasons };
}
