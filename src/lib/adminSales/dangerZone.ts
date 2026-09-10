// Zona de Perigo — regras puras compartilhadas pela tela e pelos testes.
// A barreira de verdade é a RPC admin_reset_inventory (SECURITY DEFINER, migration 077);
// isto só decide o que a tela mostra/exige, para não oferecer um botão que o banco recusaria.

import { canAdministerRecords, validateAdminReason } from '../admin/recordAdmin';

export const RESET_CONFIRMATION_PHRASE = 'ARQUIVAR E RESETAR';

export function canAccessDangerZone(role: string | null | undefined): boolean {
  return canAdministerRecords(role);
}

export interface DangerZoneFormInput {
  name: string;
  reason: string;
  confirmationPhrase: string;
}

export interface DangerZoneValidationResult {
  valid: boolean;
  errors: { name?: string; reason?: string; confirmationPhrase?: string };
}

export function validateDangerZoneForm(input: DangerZoneFormInput): DangerZoneValidationResult {
  const errors: DangerZoneValidationResult['errors'] = {};

  if (!input.name.trim()) {
    errors.name = 'Informe o nome do inventário a ser arquivado.';
  }

  const reasonError = validateAdminReason(input.reason);
  if (reasonError) errors.reason = reasonError;

  if (input.confirmationPhrase.trim().toUpperCase() !== RESET_CONFIRMATION_PHRASE) {
    errors.confirmationPhrase = `Digite exatamente "${RESET_CONFIRMATION_PHRASE}" para confirmar.`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
