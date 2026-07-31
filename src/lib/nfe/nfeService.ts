// NF-e Blind Conference — data service (Supabase access + RPC wrappers).

import { supabase } from '../supabase';
import type {
  CatalogProduct,
  LearnedAssociation,
  NfeInvoice,
  NfeInvoiceItem,
  ParsedNfe,
  CountMode,
  CountSource,
} from './nfeTypes';
import { parseNfeXml } from './nfeXmlParser';
import {
  buildProductLookups,
  collectItemCodes,
  resolveAssociation,
  type LearnedLookup,
} from './nfeAssociation';

export class NfeImportError extends Error {
  existing?: NfeInvoice;
  constructor(message: string, existing?: NfeInvoice) {
    super(message);
    this.existing = existing;
  }
}

const PAGE_SIZE = 1000;

// ── Products catalog (global/shared) ─────────────────────────────────────────

/** Fetches only catalog products related to the codes/EANs referenced in a note. */
async function fetchCandidateProducts(skus: string[], eans: string[]): Promise<CatalogProduct[]> {
  const found = new Map<string, CatalogProduct>();

  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  for (const part of chunk(skus, 200)) {
    if (part.length === 0) break;
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, ean, location')
      .in('sku', part);
    if (error) throw error;
    for (const p of data ?? []) found.set(p.id, p as CatalogProduct);
  }

  for (const part of chunk(eans, 200)) {
    if (part.length === 0) break;
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, ean, location')
      .in('ean', part);
    if (error) throw error;
    for (const p of data ?? []) found.set(p.id, p as CatalogProduct);
  }

  return [...found.values()];
}

/** Fetches the entire catalog once (paginated) for name-similarity suggestions. */
export async function fetchFullCatalog(): Promise<CatalogProduct[]> {
  const all: CatalogProduct[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, ean, location')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as CatalogProduct[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function searchCatalog(term: string, limit = 20): Promise<CatalogProduct[]> {
  const q = term.trim();
  if (q === '') return [];
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sku, ean, location')
    .or(`name.ilike.${pattern},sku.ilike.${pattern},ean.ilike.${pattern}`)
    .order('name', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CatalogProduct[];
}

// ── Learned associations (company-scoped) ────────────────────────────────────

async function fetchLearned(skus: string[], eans: string[]): Promise<LearnedLookup> {
  const bySku = new Map<string, string>();
  const byEan = new Map<string, string>();
  const values = [...skus, ...eans];
  if (values.length === 0) return { bySku, byEan };

  const { data, error } = await supabase
    .from('nfe_learned_associations')
    .select('match_type, match_value, product_id')
    .in('match_value', values);
  if (error) throw error;

  for (const row of (data ?? []) as LearnedAssociation[]) {
    if (row.match_type === 'sku') bySku.set(row.match_value, row.product_id);
    else byEan.set(row.match_value, row.product_id);
  }
  return { bySku, byEan };
}

export async function rememberAssociation(
  matchType: 'sku' | 'ean',
  matchValue: string,
  productId: string,
): Promise<void> {
  const value = matchValue.trim();
  if (value === '') return;
  const { error } = await supabase
    .from('nfe_learned_associations')
    .upsert(
      { match_type: matchType, match_value: value, product_id: productId },
      { onConflict: 'company_id,match_type,match_value' },
    );
  if (error) throw error;
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function findInvoiceByKey(invoiceKey: string): Promise<NfeInvoice | null> {
  const { data, error } = await supabase
    .from('nfe_invoices')
    .select('*')
    .eq('invoice_key', invoiceKey)
    .maybeSingle();
  if (error) throw error;
  return (data as NfeInvoice) ?? null;
}

export interface ImportResult {
  invoice: NfeInvoice;
  parsed: ParsedNfe;
}

/**
 * Parses + persists a new NF-e with its items and auto-resolves associations.
 * Throws NfeImportError (with `existing`) if the note was already imported.
 */
export async function importNfeXml(xml: string): Promise<ImportResult> {
  const parsed = parseNfeXml(xml);

  const existing = await findInvoiceByKey(parsed.invoiceKey);
  if (existing) {
    throw new NfeImportError('Esta NF-e já foi importada.', existing);
  }

  const { data: invData, error: invErr } = await supabase
    .from('nfe_invoices')
    .insert({
      invoice_key: parsed.invoiceKey,
      invoice_number: parsed.invoiceNumber,
      invoice_series: parsed.invoiceSeries,
      issue_date: parsed.issueDate,
      supplier_name: parsed.supplierName,
      supplier_cnpj: parsed.supplierCnpj,
      status: 'not_started',
      total_items: parsed.items.length,
      raw_xml: xml,
    })
    .select('*')
    .single();
  if (invErr) throw invErr;
  const invoice = invData as NfeInvoice;

  const { skus, eans } = collectItemCodes(parsed.items);
  const [candidates, learned] = await Promise.all([
    fetchCandidateProducts(skus, eans),
    fetchLearned(skus, eans),
  ]);
  const { bySku, byEan } = buildProductLookups(candidates);

  const itemRows = parsed.items.map((it) => {
    const link = resolveAssociation(
      { nfeCode: it.nfeCode, eanNormalized: it.eanNormalized },
      bySku,
      byEan,
      learned,
    );
    return {
      invoice_id: invoice.id,
      line_number: it.lineNumber,
      nfe_code: it.nfeCode,
      description: it.description,
      unit: it.unit,
      expected_quantity: it.expectedQuantity,
      unit_value: it.unitValue,
      total_value: it.totalValue,
      nfe_ean: it.ean,
      nfe_ean_normalized: it.eanNormalized,
      product_id: link.productId,
      link_method: link.method,
    };
  });

  const { error: itemsErr } = await supabase.from('nfe_invoice_items').insert(itemRows);
  if (itemsErr) throw itemsErr;

  return { invoice, parsed };
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Fields consumed by the invoice list (NFeConferencePage) and by the views
 * that reuse a list-fetched invoice without a refetch — NFePreparationView,
 * NFeCountingView, and NFeReportView when opening an already-finalized note
 * straight from the list. Intentionally excludes raw_xml (R5: unbounded
 * payload — a single note's XML can be ~100KB, ballooning the list fetch)
 * and write-only audit columns (company_id, created_by, started_by,
 * finished_by, updated_at) that none of those views read from this object.
 */
export const INVOICE_LIST_FIELDS =
  'id, invoice_key, invoice_number, invoice_series, issue_date, supplier_name, supplier_cnpj, status, total_items, started_at, finished_at, created_at' as const;

export async function listInvoices(): Promise<NfeInvoice[]> {
  const { data, error } = await supabase
    .from('nfe_invoices')
    .select(INVOICE_LIST_FIELDS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as NfeInvoice[];
}

export async function getInvoice(id: string): Promise<NfeInvoice | null> {
  const { data, error } = await supabase
    .from('nfe_invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as NfeInvoice) ?? null;
}

export async function getInvoiceItems(invoiceId: string): Promise<NfeInvoiceItem[]> {
  const { data, error } = await supabase
    .from('nfe_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('line_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as NfeInvoiceItem[];
}

// ── Mutations (preparation stage — before real start) ────────────────────────

export async function linkItemToProduct(
  itemId: string,
  productId: string,
  method: 'manual' | 'learned',
): Promise<void> {
  const { error } = await supabase
    .from('nfe_invoice_items')
    .update({ product_id: productId, link_method: method })
    .eq('id', itemId);
  if (error) throw error;
}

// ── RPC wrappers (atomic, server-validated) ──────────────────────────────────

export async function startConference(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('nfe_start_conference', { p_invoice_id: invoiceId });
  if (error) throw error;
}

export async function registerCount(params: {
  itemId: string;
  mode: CountMode;
  quantity: number;
  source: CountSource;
  idempotencyKey: string;
  ean?: string | null;
  sku?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc('nfe_register_count', {
    p_item_id: params.itemId,
    p_mode: params.mode,
    p_quantity: params.quantity,
    p_source: params.source,
    p_idempotency_key: params.idempotencyKey,
    p_ean: params.ean ?? null,
    p_sku: params.sku ?? null,
  });
  if (error) throw error;
  return Number(data);
}

export async function finalizeConference(invoiceId: string): Promise<string> {
  const { data, error } = await supabase.rpc('nfe_finalize_conference', { p_invoice_id: invoiceId });
  if (error) throw error;
  return String(data);
}

export async function reopenConference(invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc('nfe_reopen_conference', { p_invoice_id: invoiceId });
  if (error) throw error;
}
