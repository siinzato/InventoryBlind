import { supabase } from '../supabase';
import { normalizeCnpj } from './cnpjUtils';
import type {
  FiscalEntity,
  CreateFiscalEntityInput,
  UpdateFiscalEntityInput,
} from './fiscalEntityTypes';

interface FiscalEntityRow {
  id: string;
  company_id: string;
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  state_registration: string | null;
  is_default: boolean;
  status: 'active' | 'archived';
  data_incomplete: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: FiscalEntityRow): FiscalEntity {
  return {
    id: row.id,
    companyId: row.company_id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    cnpj: row.cnpj,
    stateRegistration: row.state_registration,
    isDefault: row.is_default,
    status: row.status,
    dataIncomplete: row.data_incomplete,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listFiscalEntities(companyId: string): Promise<FiscalEntity[]> {
  const { data, error } = await supabase
    .from('fiscal_entities')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as FiscalEntityRow[]).map(fromRow);
}

export async function createFiscalEntity(input: CreateFiscalEntityInput): Promise<FiscalEntity> {
  const { data, error } = await supabase.rpc('fiscal_entities_create', {
    p_legal_name: input.legalName,
    p_trade_name: input.tradeName ?? null,
    p_cnpj: normalizeCnpj(input.cnpj),
    p_state_registration: input.stateRegistration ?? null,
    p_set_default: !!input.setDefault,
  });
  if (error) throw error;
  return fromRow(data as FiscalEntityRow);
}

export async function updateFiscalEntity(id: string, input: UpdateFiscalEntityInput): Promise<FiscalEntity> {
  const { data, error } = await supabase.rpc('fiscal_entities_update', {
    p_entity_id: id,
    p_legal_name: input.legalName,
    p_trade_name: input.tradeName ?? null,
    p_cnpj: normalizeCnpj(input.cnpj),
    p_state_registration: input.stateRegistration ?? null,
    p_confirm_cnpj_change: !!input.confirmCnpjChange,
  });
  if (error) throw error;
  return fromRow(data as FiscalEntityRow);
}

export async function setDefaultFiscalEntity(id: string): Promise<FiscalEntity> {
  const { data, error } = await supabase.rpc('fiscal_entities_set_default', { p_entity_id: id });
  if (error) throw error;
  return fromRow(data as FiscalEntityRow);
}

export async function archiveFiscalEntity(id: string): Promise<FiscalEntity> {
  const { data, error } = await supabase.rpc('fiscal_entities_archive', { p_entity_id: id });
  if (error) throw error;
  return fromRow(data as FiscalEntityRow);
}

export async function restoreFiscalEntity(id: string): Promise<FiscalEntity> {
  const { data, error } = await supabase.rpc('fiscal_entities_restore', { p_entity_id: id });
  if (error) throw error;
  return fromRow(data as FiscalEntityRow);
}

/** Localiza a empresa fiscal de um workspace por CNPJ exato — nunca por
 *  razão social ou nome fantasia. Retorna null quando não há correspondência
 *  (ausência de match não é um erro). Reservado para uso futuro pelo
 *  processamento de XML de NF-e. */
export async function findFiscalEntityByCnpj(companyId: string, cnpj: string): Promise<FiscalEntity | null> {
  const { data, error } = await supabase.rpc('fiscal_entities_find_by_cnpj', {
    p_company_id: companyId,
    p_cnpj: normalizeCnpj(cnpj),
  });
  if (error) throw error;
  if (!data) return null;
  return fromRow(data as FiscalEntityRow);
}
