// Regras puras para o código de convite da empresa (migration 082). A geração e a validação de
// verdade acontecem no servidor (get_or_create_daily_invite_code / join_company_by_invite_code);
// este módulo só normaliza/valida o formato no cliente antes de enviar, para dar feedback
// imediato sem depender de uma ida ao banco.

/** Mesmo alfabeto usado no servidor (sem O/0/I/1) e o mesmo comprimento — só para o formulário
 *  poder avisar "código incompleto" antes de chamar a RPC. */
export const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

/** Maiúsculas, sem espaços — mesma normalização aplicada no servidor (upper(btrim(...))). */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isInviteCodeFormatValid(code: string): boolean {
  const normalized = normalizeInviteCode(code);
  return normalized.length === INVITE_CODE_LENGTH && INVITE_CODE_ALPHABET.test(normalized);
}

/** Mesma máscara gravada em audit_logs pela RPC — só os 2 primeiros e 2 últimos caracteres. */
export function maskInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  if (normalized.length <= 4) return normalized;
  const middle = '•'.repeat(normalized.length - 4);
  return `${normalized.slice(0, 2)}${middle}${normalized.slice(-2)}`;
}
