// Parsing/validação decimal para a OC — mesmo padrão de
// nfeAdmin.ts::validateCorrectionQuantity / countManagementUtils.ts::parseCount:
// nunca altera silenciosamente o que o operador digitou, só valida e converte.

/** `null` quando o valor serve; mensagem pronta para a tela quando não. Aceita
 *  vírgula ou ponto decimal. Vazio é inválido para campos obrigatórios — o
 *  chamador decide se o campo é obrigatório. */
export function validateDecimalInput(raw: string, fieldLabel: string, options: { required?: boolean; allowZero?: boolean } = {}): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return options.required ? `Informe ${fieldLabel}.` : null;
  }
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return `${fieldLabel} precisa ser um número válido.`;
  if (value < 0) return `${fieldLabel} não pode ser negativo.`;
  if (value === 0 && options.allowZero === false) return `${fieldLabel} precisa ser maior que zero.`;
  return null;
}

/** `null` quando a string está vazia ou não é um número válido — o chamador decide
 *  o que fazer (campo obrigatório deve ter sido validado antes com validateDecimalInput). */
export function parseDecimalInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export interface RequiredPoItemFields {
  description: string;
  quantity: string;
  unitPrice?: string;
}

export interface PoItemFieldErrors {
  description?: string;
  quantity?: string;
  unitPrice?: string;
}

/** Validação de uma linha de item de OC (cadastro manual ou linha de importação já mapeada). */
export function validatePoItemFields(fields: RequiredPoItemFields): PoItemFieldErrors {
  const errors: PoItemFieldErrors = {};

  if (!fields.description.trim()) errors.description = 'Informe a descrição do item.';

  const quantityError = validateDecimalInput(fields.quantity, 'a quantidade', { required: true, allowZero: false });
  if (quantityError) errors.quantity = quantityError;

  if (fields.unitPrice !== undefined && fields.unitPrice.trim() !== '') {
    const priceError = validateDecimalInput(fields.unitPrice, 'o preço unitário', { required: false });
    if (priceError) errors.unitPrice = priceError;
  }

  return errors;
}
