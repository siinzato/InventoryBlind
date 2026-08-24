// Linhas e Marcas — camada de I/O. Nunca escreve em products além da associação
// (product_brand_associations); marca/linha nunca são apagadas fisicamente, só
// desativadas (active=false) — preservando o histórico de quem já está vinculado.

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import { classifyProductTitle, type ClassifierBrand } from './brandClassifier';

export interface ProductBrand {
  id: string; companyId: string; name: string; code: string | null; keywords: string[];
  primaryResponsibleId: string | null; additionalResponsibleIds: string[]; active: boolean;
  createdAt: string; updatedAt: string;
}
export interface ProductLine {
  id: string; companyId: string; brandId: string; name: string; keywords: string[];
  primaryResponsibleId: string | null; additionalResponsibleIds: string[]; active: boolean;
  createdAt: string; updatedAt: string;
}
export interface ProductBrandAssociation {
  id: string; companyId: string; productId: string; brandId: string | null; lineId: string | null;
  matchStatus: 'auto' | 'manual' | 'needs_review' | 'unmatched';
  matchedKeyword: string | null;
  candidateMatches: { type: 'brand' | 'line'; id: string; name: string }[];
  confirmedBy: string | null; confirmedAt: string | null; createdAt: string; updatedAt: string;
}

interface BrandRow {
  id: string; company_id: string; name: string; code: string | null; keywords: string[];
  primary_responsible_id: string | null; additional_responsible_ids: string[]; active: boolean;
  created_at: string; updated_at: string;
}
interface LineRow {
  id: string; company_id: string; brand_id: string; name: string; keywords: string[];
  primary_responsible_id: string | null; additional_responsible_ids: string[]; active: boolean;
  created_at: string; updated_at: string;
}
interface AssociationRow {
  id: string; company_id: string; product_id: string; brand_id: string | null; line_id: string | null;
  match_status: ProductBrandAssociation['matchStatus']; matched_keyword: string | null;
  candidate_matches: ProductBrandAssociation['candidateMatches']; confirmed_by: string | null;
  confirmed_at: string | null; created_at: string; updated_at: string;
}

function brandFromRow(row: BrandRow): ProductBrand {
  return {
    id: row.id, companyId: row.company_id, name: row.name, code: row.code, keywords: row.keywords ?? [],
    primaryResponsibleId: row.primary_responsible_id, additionalResponsibleIds: row.additional_responsible_ids ?? [],
    active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function lineFromRow(row: LineRow): ProductLine {
  return {
    id: row.id, companyId: row.company_id, brandId: row.brand_id, name: row.name, keywords: row.keywords ?? [],
    primaryResponsibleId: row.primary_responsible_id, additionalResponsibleIds: row.additional_responsible_ids ?? [],
    active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function associationFromRow(row: AssociationRow): ProductBrandAssociation {
  return {
    id: row.id, companyId: row.company_id, productId: row.product_id, brandId: row.brand_id, lineId: row.line_id,
    matchStatus: row.match_status, matchedKeyword: row.matched_keyword, candidateMatches: row.candidate_matches ?? [],
    confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listBrands(companyId: string): Promise<ProductBrand[]> {
  const { data, error } = await supabase.from('product_brands').select('*').eq('company_id', companyId).order('name');
  if (error) throw error;
  return (data ?? []).map(brandFromRow);
}

export async function listLines(companyId: string): Promise<ProductLine[]> {
  const { data, error } = await supabase.from('product_lines').select('*').eq('company_id', companyId).order('name');
  if (error) throw error;
  return (data ?? []).map(lineFromRow);
}

export interface BrandInput {
  name: string; code?: string | null; keywords: string[]; primaryResponsibleId?: string | null; additionalResponsibleIds?: string[];
}

export async function createBrand(companyId: string, input: BrandInput, userId: string, userEmail: string): Promise<ProductBrand> {
  const { data, error } = await supabase
    .from('product_brands')
    .insert({
      company_id: companyId, name: input.name.trim(), code: input.code?.trim() || null, keywords: input.keywords,
      primary_responsible_id: input.primaryResponsibleId ?? null, additional_responsible_ids: input.additionalResponsibleIds ?? [],
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao criar a marca.');
  await logAuditEvent({ companyId, userId, userEmail, action: 'product_brand.created', resourceType: 'product_brands', resourceId: data.id, metadata: { name: input.name } });
  return brandFromRow(data);
}

export async function updateBrand(companyId: string, id: string, input: Partial<BrandInput>, userId: string, userEmail: string): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.code !== undefined) payload.code = input.code?.trim() || null;
  if (input.keywords !== undefined) payload.keywords = input.keywords;
  if (input.primaryResponsibleId !== undefined) payload.primary_responsible_id = input.primaryResponsibleId;
  if (input.additionalResponsibleIds !== undefined) payload.additional_responsible_ids = input.additionalResponsibleIds;

  const { error } = await supabase.from('product_brands').update(payload).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'product_brand.updated', resourceType: 'product_brands', resourceId: id });
}

/** Nunca apaga fisicamente — desativar é a única forma suportada de "remover" uma marca já usada. */
export async function setBrandActive(companyId: string, id: string, active: boolean, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('product_brands').update({ active, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: active ? 'product_brand.updated' : 'product_brand.deactivated', resourceType: 'product_brands', resourceId: id });
}

export interface LineInput {
  brandId: string; name: string; keywords: string[]; primaryResponsibleId?: string | null; additionalResponsibleIds?: string[];
}

export async function createLine(companyId: string, input: LineInput, userId: string, userEmail: string): Promise<ProductLine> {
  const { data, error } = await supabase
    .from('product_lines')
    .insert({
      company_id: companyId, brand_id: input.brandId, name: input.name.trim(), keywords: input.keywords,
      primary_responsible_id: input.primaryResponsibleId ?? null, additional_responsible_ids: input.additionalResponsibleIds ?? [],
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('Falha ao criar a linha.');
  await logAuditEvent({ companyId, userId, userEmail, action: 'product_line.created', resourceType: 'product_lines', resourceId: data.id, metadata: { name: input.name, brandId: input.brandId } });
  return lineFromRow(data);
}

export async function updateLine(companyId: string, id: string, input: Partial<Omit<LineInput, 'brandId'>>, userId: string, userEmail: string): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.keywords !== undefined) payload.keywords = input.keywords;
  if (input.primaryResponsibleId !== undefined) payload.primary_responsible_id = input.primaryResponsibleId;
  if (input.additionalResponsibleIds !== undefined) payload.additional_responsible_ids = input.additionalResponsibleIds;

  const { error } = await supabase.from('product_lines').update(payload).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: 'product_line.updated', resourceType: 'product_lines', resourceId: id });
}

export async function setLineActive(companyId: string, id: string, active: boolean, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('product_lines').update({ active, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
  await logAuditEvent({ companyId, userId, userEmail, action: active ? 'product_line.updated' : 'product_line.deactivated', resourceType: 'product_lines', resourceId: id });
}

/** Responsáveis efetivos de uma linha: os próprios, ou os da marca quando a linha não tiver nenhum. */
export function effectiveLineResponsibles(line: ProductLine, brand: ProductBrand): { primaryResponsibleId: string | null; additionalResponsibleIds: string[] } {
  if (line.primaryResponsibleId || line.additionalResponsibleIds.length > 0) {
    return { primaryResponsibleId: line.primaryResponsibleId, additionalResponsibleIds: line.additionalResponsibleIds };
  }
  return { primaryResponsibleId: brand.primaryResponsibleId, additionalResponsibleIds: brand.additionalResponsibleIds };
}

export async function countProductsForBrand(brandId: string): Promise<number> {
  const { count, error } = await supabase.from('product_brand_associations').select('id', { count: 'exact', head: true }).eq('brand_id', brandId);
  if (error) throw error;
  return count ?? 0;
}

export async function countProductsForLine(lineId: string): Promise<number> {
  const { count, error } = await supabase.from('product_brand_associations').select('id', { count: 'exact', head: true }).eq('line_id', lineId);
  if (error) throw error;
  return count ?? 0;
}

/** Produtos com marca definida mas sem linha — usado pelo contador "Produtos sem linha". */
export async function countProductsWithoutLineForBrand(brandId: string): Promise<number> {
  const { count, error } = await supabase
    .from('product_brand_associations')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .is('line_id', null);
  if (error) throw error;
  return count ?? 0;
}

export async function countReviewQueue(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('product_brand_associations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('match_status', 'needs_review');
  if (error) throw error;
  return count ?? 0;
}

/** Nomes de marca/linha por id, para a tela de produtos exibir sem precisar
 *  embutir um segundo nível de join a cada linha da listagem. */
export async function getBrandLineNameMaps(companyId: string): Promise<{ brandNames: Map<string, string>; lineNames: Map<string, string> }> {
  const [brands, lines] = await Promise.all([listBrands(companyId), listLines(companyId)]);
  return {
    brandNames: new Map(brands.map(b => [b.id, b.name])),
    lineNames: new Map(lines.map(l => [l.id, l.name])),
  };
}

/** Altera a marca/linha de um ou vários produtos de uma vez — só a associação,
 *  nunca o produto em si. Mesmo caminho de `confirmProductAssociation`, em lote. */
export async function bulkAssignProductAssociation(
  companyId: string, productIds: string[], brandId: string | null, lineId: string | null, userId: string, userEmail: string
): Promise<void> {
  if (productIds.length === 0) return;
  const { error } = await supabase.from('product_brand_associations').upsert(
    productIds.map(productId => ({
      company_id: companyId, product_id: productId, brand_id: brandId, line_id: lineId,
      match_status: 'manual' as const, matched_keyword: null, candidate_matches: [],
      confirmed_by: userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })),
    { onConflict: 'product_id' }
  );
  if (error) throw error;
  await logAuditEvent({
    companyId, userId, userEmail, action: 'product_brand_association.confirmed', resourceType: 'product_brand_associations',
    metadata: { bulk: true, count: productIds.length, brandId, lineId },
  });
}

export async function listReviewQueue(companyId: string, limit = 100): Promise<ProductBrandAssociation[]> {
  const { data, error } = await supabase
    .from('product_brand_associations')
    .select('*')
    .eq('company_id', companyId)
    .eq('match_status', 'needs_review')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(associationFromRow);
}

async function buildClassifierBrands(companyId: string): Promise<ClassifierBrand[]> {
  const [brands, lines] = await Promise.all([listBrands(companyId), listLines(companyId)]);
  const linesByBrand = new Map<string, ProductLine[]>();
  for (const line of lines) {
    const list = linesByBrand.get(line.brandId) ?? [];
    list.push(line);
    linesByBrand.set(line.brandId, list);
  }
  return brands.map(b => ({
    id: b.id, name: b.name, keywords: b.keywords, active: b.active,
    lines: (linesByBrand.get(b.id) ?? []).map(l => ({ id: l.id, name: l.name, keywords: l.keywords, active: l.active })),
  }));
}

/** Confirma manualmente uma associação (usada tanto pela fila de revisão quanto
 *  pelo detalhe do produto). `addKeyword`, quando informado, é acrescentado às
 *  palavras-chave da marca ou linha escolhida, para melhorar associações futuras —
 *  nunca sobrescreve as palavras-chave existentes. */
export async function confirmProductAssociation(
  companyId: string,
  input: { productId: string; brandId: string | null; lineId: string | null; addKeyword?: { level: 'brand' | 'line'; text: string } },
  userId: string, userEmail: string
): Promise<void> {
  const { error } = await supabase
    .from('product_brand_associations')
    .upsert(
      {
        company_id: companyId, product_id: input.productId, brand_id: input.brandId, line_id: input.lineId,
        match_status: 'manual', matched_keyword: null, candidate_matches: [], confirmed_by: userId, confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' }
    );
  if (error) throw error;

  if (input.addKeyword?.text.trim()) {
    const keyword = input.addKeyword.text.trim();
    if (input.addKeyword.level === 'brand' && input.brandId) {
      const { data: brand } = await supabase.from('product_brands').select('keywords').eq('id', input.brandId).single();
      const keywords = Array.from(new Set([...(brand?.keywords ?? []), keyword]));
      await supabase.from('product_brands').update({ keywords, updated_at: new Date().toISOString() }).eq('id', input.brandId);
    } else if (input.addKeyword.level === 'line' && input.lineId) {
      const { data: line } = await supabase.from('product_lines').select('keywords').eq('id', input.lineId).single();
      const keywords = Array.from(new Set([...(line?.keywords ?? []), keyword]));
      await supabase.from('product_lines').update({ keywords, updated_at: new Date().toISOString() }).eq('id', input.lineId);
    }
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'product_brand_association.confirmed', resourceType: 'product_brand_associations',
    resourceId: input.productId, metadata: { brandId: input.brandId, lineId: input.lineId },
  });
}

export interface ClassifyBatchResult { classified: number; needsReview: number; unmatched: number }

/**
 * Classifica os produtos da empresa chamadora contra as marcas/linhas ATIVAS dela
 * mesma — nunca lê nem grava em outro tenant. Roda em lotes para não carregar o
 * catálogo inteiro de uma vez. Idempotente: recalcula a mesma linha por produto
 * (UNIQUE product_id), nunca duplica.
 */
export async function classifyCompanyProducts(companyId: string, userId: string, userEmail: string, batchSize = 500): Promise<ClassifyBatchResult> {
  const classifierBrands = await buildClassifierBrands(companyId);
  const result: ClassifyBatchResult = { classified: 0, needsReview: 0, unmatched: 0 };
  if (classifierBrands.length === 0) return result;

  const brandNameById = new Map(classifierBrands.map(b => [b.id, b.name]));
  const lineNameById = new Map(classifierBrands.flatMap(b => b.lines.map(l => [l.id, l.name] as const)));

  let from = 0;
  for (;;) {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name')
      .eq('company_id', companyId)
      .range(from, from + batchSize - 1);
    if (error) throw error;
    if (!products || products.length === 0) break;

    const upsertRows = products.map(product => {
      const classification = classifyProductTitle(product.name, classifierBrands);
      if (classification.status === 'auto') result.classified += 1;
      else if (classification.status === 'needs_review') result.needsReview += 1;
      else result.unmatched += 1;

      const candidateMatches = [
        ...classification.brandCandidates.map(c => ({ type: 'brand' as const, id: c.brandId, name: brandNameById.get(c.brandId) ?? c.brandName })),
        ...classification.lineCandidates.map(c => ({ type: 'line' as const, id: c.lineId, name: lineNameById.get(c.lineId) ?? c.lineName })),
      ];

      return {
        company_id: companyId, product_id: product.id, brand_id: classification.brandId, line_id: classification.lineId,
        match_status: classification.status, matched_keyword: classification.matchedKeyword, candidate_matches: candidateMatches,
        updated_at: new Date().toISOString(),
      };
    });

    const { error: upsertError } = await supabase.from('product_brand_associations').upsert(upsertRows, { onConflict: 'product_id' });
    if (upsertError) throw upsertError;

    if (products.length < batchSize) break;
    from += batchSize;
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'product_brand_association.batch_classified', resourceType: 'product_brand_associations',
    metadata: { ...result },
  });

  return result;
}
