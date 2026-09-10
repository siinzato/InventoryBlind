export type FiscalEntityStatus = 'active' | 'archived';

export interface FiscalEntity {
  id: string;
  companyId: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  stateRegistration: string | null;
  isDefault: boolean;
  status: FiscalEntityStatus;
  dataIncomplete: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalEntityInput {
  legalName: string;
  tradeName?: string | null;
  cnpj: string;
  stateRegistration?: string | null;
}

export interface CreateFiscalEntityInput extends FiscalEntityInput {
  setDefault?: boolean;
}

export interface UpdateFiscalEntityInput extends FiscalEntityInput {
  confirmCnpjChange?: boolean;
}

/** Levantada pela RPC fiscal_entities_update quando o CNPJ muda e o chamador
 *  ainda não confirmou — o client deve pedir confirmação e reenviar com
 *  confirmCnpjChange: true. */
export const CNPJ_CHANGE_CONFIRMATION_REQUIRED = 'cnpj_change_confirmation_required';
