// Leitura e gravação da chave de lote/validade, e a lista de vencimentos.
//
// A chave é cobrada nos DOIS lados: aqui ela decide o que a tela mostra, e a RPC
// `nfe_putaway_item` (migration 125) recusa gravar lote ou validade de empresa que
// não ligou a opção. Só na tela, a chave seria uma sugestão — bastaria um cliente
// de API para gravar dado que a empresa decidiu não ter.

import { supabase } from '../supabase';
import {
  DEFAULT_LOT_CONTROL, normalizeLotControl,
  type ExpiryEntry, type LotControlSettings,
} from './lotControlDomain';

const TABELA = 'lot_control_settings';
const COLUNAS = 'lot_enabled, expiry_enabled, expiry_alert_days';

export interface LoadedLotControl {
  settings: LotControlSettings;
  /** `false` quando a empresa nunca configurou — está vendo os padrões. */
  saved: boolean;
}

export async function fetchLotControl(companyId: string): Promise<LoadedLotControl> {
  const { data, error } = await supabase
    .from(TABELA)
    .select(COLUNAS)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { settings: DEFAULT_LOT_CONTROL, saved: false };

  const row = data as { lot_enabled: boolean | null; expiry_enabled: boolean | null; expiry_alert_days: number | null };
  return {
    settings: normalizeLotControl({
      lotEnabled: row.lot_enabled ?? false,
      expiryEnabled: row.expiry_enabled ?? false,
      expiryAlertDays: row.expiry_alert_days ?? DEFAULT_LOT_CONTROL.expiryAlertDays,
    }),
    saved: true,
  };
}

export async function saveLotControl(
  companyId: string,
  settings: LotControlSettings
): Promise<LotControlSettings> {
  const limpa = normalizeLotControl(settings);

  const { error } = await supabase.from(TABELA).upsert(
    {
      company_id: companyId,
      lot_enabled: limpa.lotEnabled,
      expiry_enabled: limpa.expiryEnabled,
      expiry_alert_days: limpa.expiryAlertDays,
    },
    { onConflict: 'company_id' }
  );

  if (error) throw error;
  return limpa;
}

interface ExpiryRow {
  id: string;
  product_id: string;
  bin_code: string;
  lot_number: string | null;
  expiry_date: string;
  units: number;
  created_at: string;
  products: { sku: string; name: string } | null;
  nfe_invoices: { invoice_number: string | null } | null;
}

/** O que tem validade registrada, do mais próximo de vencer para o mais distante.
 *
 *  Lê só as linhas COM validade — o índice parcial do banco é sobre exatamente
 *  essas. Empresa que não usa validade não tem nenhuma, e a consulta volta vazia
 *  em vez de varrer o histórico inteiro de endereçamentos. */
export async function listExpiring(companyId: string, limite = 500): Promise<ExpiryEntry[]> {
  const { data, error } = await supabase
    .from('nfe_putaway_assignments')
    .select('id, product_id, bin_code, lot_number, expiry_date, units, created_at, products(sku, name), nfe_invoices(invoice_number)')
    .eq('company_id', companyId)
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true })
    .limit(limite);

  if (error) throw error;

  return ((data ?? []) as unknown as ExpiryRow[]).map(r => ({
    id: r.id,
    productId: r.product_id,
    sku: r.products?.sku ?? '—',
    productName: r.products?.name ?? 'Produto não encontrado',
    binCode: r.bin_code,
    lotNumber: r.lot_number,
    expiryDate: r.expiry_date,
    units: r.units,
    invoiceNumber: r.nfe_invoices?.invoice_number ?? null,
    receivedAt: r.created_at,
  }));
}
