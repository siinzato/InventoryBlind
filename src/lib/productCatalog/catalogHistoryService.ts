// Alterações recentes / Histórico do produto — usa exclusivamente dados reais
// já existentes: audit_logs (resource_type='product', mesmo padrão já usado
// por slotting.sku_moved/risk.criticality_override) e import_products_audit
// (trilha real de criação/atualização por importação, com company_id desde a
// migration 013). Nenhum evento é gerado no frontend nem fabricado.

import { supabase } from '../supabase';

export interface CatalogEvent {
  id: string;
  productId: string;
  createdAt: string;
  label: string;
  detail: string | null;
  userEmail: string | null;
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  'products.updated': 'Cadastro editado',
  'products.delete': 'Produto excluído',
  'products.import': 'Importado em lote',
  'product_brand.created': 'Marca associada',
  'product_brand.updated': 'Marca atualizada',
  'product_line.created': 'Linha associada',
  'product_line.updated': 'Linha atualizada',
  'slotting.sku_moved': 'Endereço alterado',
  'risk.criticality_override': 'Criticidade ajustada manualmente',
};

function friendlyAuditLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

interface ImportHistoryEmbed { file_name: string }
interface ImportAuditRow {
  id: string;
  product_id: string;
  sku: string;
  action: string;
  created_at: string;
  import_history: ImportHistoryEmbed | ImportHistoryEmbed[] | null;
}

function importFileName(row: ImportAuditRow): string | null {
  const embed = row.import_history;
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0]?.file_name ?? null) : embed.file_name;
}

function importEventLabel(action: string): string {
  return action === 'insert' ? 'Criado pela importação' : 'Atualizado pela importação';
}

export async function listProductHistory(companyId: string, productId: string): Promise<CatalogEvent[]> {
  const [{ data: auditRows, error: auditError }, { data: importRows, error: importError }] = await Promise.all([
    supabase.from('audit_logs').select('id, action, user_email, created_at, description')
      .eq('company_id', companyId).eq('resource_type', 'product').eq('resource_id', productId)
      .order('created_at', { ascending: false }),
    supabase.from('import_products_audit').select('id, product_id, sku, action, created_at, import_history(file_name)')
      .eq('company_id', companyId).eq('product_id', productId)
      .order('created_at', { ascending: false }),
  ]);
  if (auditError) console.error('[CatalogHistory] audit_logs', auditError.message);
  if (importError) console.error('[CatalogHistory] import_products_audit', importError.message);

  const events: CatalogEvent[] = [];
  for (const r of auditRows ?? []) {
    events.push({ id: `audit-${r.id}`, productId, createdAt: r.created_at, label: friendlyAuditLabel(r.action), detail: r.description, userEmail: r.user_email });
  }
  for (const r of (importRows ?? []) as unknown as ImportAuditRow[]) {
    events.push({ id: `import-${r.id}`, productId, createdAt: r.created_at, label: importEventLabel(r.action), detail: importFileName(r), userEmail: null });
  }
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface RecentCatalogEvent extends CatalogEvent {
  productName: string;
  productSku: string;
}

const RECENT_CHANGES_LIMIT = 50;

export async function listRecentProductChanges(companyId: string): Promise<RecentCatalogEvent[]> {
  const [{ data: auditRows, error: auditError }, { data: importRows, error: importError }] = await Promise.all([
    supabase.from('audit_logs').select('id, action, resource_id, user_email, created_at, description')
      .eq('company_id', companyId).eq('resource_type', 'product')
      .order('created_at', { ascending: false }).limit(RECENT_CHANGES_LIMIT),
    supabase.from('import_products_audit').select('id, product_id, sku, action, created_at, import_history(file_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(RECENT_CHANGES_LIMIT),
  ]);
  if (auditError) console.error('[CatalogHistory] audit_logs', auditError.message);
  if (importError) console.error('[CatalogHistory] import_products_audit', importError.message);

  const importTyped = (importRows ?? []) as unknown as ImportAuditRow[];
  const productIds = new Set<string>();
  for (const r of auditRows ?? []) if (r.resource_id) productIds.add(r.resource_id);
  for (const r of importTyped) productIds.add(r.product_id);

  const productMap = new Map<string, { name: string; sku: string }>();
  if (productIds.size > 0) {
    const { data: products, error: productsError } = await supabase
      .from('products').select('id, name, sku').in('id', Array.from(productIds));
    if (productsError) console.error('[CatalogHistory] products', productsError.message);
    for (const p of products ?? []) productMap.set(p.id, { name: p.name, sku: p.sku });
  }

  const events: RecentCatalogEvent[] = [];
  for (const r of auditRows ?? []) {
    if (!r.resource_id) continue;
    const p = productMap.get(r.resource_id);
    events.push({
      id: `audit-${r.id}`, productId: r.resource_id, createdAt: r.created_at,
      label: friendlyAuditLabel(r.action), detail: r.description, userEmail: r.user_email,
      productName: p?.name ?? '—', productSku: p?.sku ?? '—',
    });
  }
  for (const r of importTyped) {
    const p = productMap.get(r.product_id);
    events.push({
      id: `import-${r.id}`, productId: r.product_id, createdAt: r.created_at,
      label: importEventLabel(r.action), detail: importFileName(r), userEmail: null,
      productName: p?.name ?? r.sku, productSku: p?.sku ?? r.sku,
    });
  }

  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return events.slice(0, RECENT_CHANGES_LIMIT);
}

export interface ProductOrigin {
  imported: boolean;
  importedAt: string | null;
  fileName: string | null;
}

/** Origem real do cadastro (Importação x Cadastro manual) — só existe quando há
 *  um evento de inserção em import_products_audit para o produto. Sem isso, o
 *  produto não tem nenhuma trilha de origem gravada e é tratado como cadastro
 *  manual, que é o que de fato aconteceu. */
export async function getProductOrigins(companyId: string, productIds: string[]): Promise<Map<string, ProductOrigin>> {
  const map = new Map<string, ProductOrigin>();
  if (productIds.length === 0) return map;

  const { data, error } = await supabase
    .from('import_products_audit')
    .select('product_id, created_at, import_history(file_name)')
    .eq('company_id', companyId).eq('action', 'insert').in('product_id', productIds);
  if (error) { console.error('[CatalogHistory] getProductOrigins', error.message); return map; }

  for (const r of (data ?? []) as unknown as ImportAuditRow[]) {
    const existing = map.get(r.product_id);
    if (!existing || (existing.importedAt ?? '') < r.created_at) {
      map.set(r.product_id, { imported: true, importedAt: r.created_at, fileName: importFileName(r) });
    }
  }
  return map;
}
