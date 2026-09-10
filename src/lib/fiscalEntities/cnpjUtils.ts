// CNPJ (pure). Mesma checagem de dígitos verificadores usada pela função SQL
// is_valid_cnpj (migration 087) — este módulo só existe para dar feedback
// imediato na interface; a autoridade de validação é sempre o backend.

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 14);
}

export function isValidCnpjChecksum(raw: string): boolean {
  const digits = normalizeCnpj(raw);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const nums = digits.split('').map(Number);

  const sum1 = WEIGHTS_1.reduce((acc, w, i) => acc + w * nums[i], 0);
  let d1 = 11 - (sum1 % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== nums[12]) return false;

  const sum2 = WEIGHTS_2.reduce((acc, w, i) => acc + w * nums[i], 0);
  let d2 = 11 - (sum2 % 11);
  if (d2 >= 10) d2 = 0;
  if (d2 !== nums[13]) return false;

  return true;
}

export function formatCnpj(raw: string): string {
  const digits = normalizeCnpj(raw);
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

/** Máscara progressiva para uso em onChange de um input controlado. */
export function maskCnpjInput(raw: string): string {
  const digits = normalizeCnpj(raw);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '.' + digits.slice(2, 5);
  if (digits.length > 5) out += '.' + digits.slice(5, 8);
  if (digits.length > 8) out += '/' + digits.slice(8, 12);
  if (digits.length > 12) out += '-' + digits.slice(12, 14);
  return out;
}
