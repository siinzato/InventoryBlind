// Qualidade cadastral do Catálogo de Produtos — completude calculada a partir
// de campos reais (nunca um score fabricado). A validação de EAN reaproveita
// as mesmas regras já usadas no projeto: comprimento GTIN (nfeEanUtils, já
// usado para o mesmo conceito nas conferências de NF-e) + dígito verificador
// GS1 Módulo 10 (barcodeValidation, Laboratório de Códigos de Barras) — nenhum
// algoritmo novo, só as duas peças existentes combinadas para o caso de um
// campo de produto solto (sem symbology fixa de etiqueta).

import { supabase } from '../supabase';
import { normalizeEan } from '../nfe/nfeEanUtils';
import { computeGs1Mod10CheckDigit } from '../barcode/barcodeValidation';

export interface EanValidation {
  present: boolean;
  ok: boolean;
  error: string | null;
}

export function validateProductEan(raw: string | null | undefined): EanValidation {
  if (!raw || !raw.trim()) return { present: false, ok: true, error: null };
  const normalized = normalizeEan(raw);
  if (!normalized) {
    return { present: true, ok: false, error: 'Formato inválido — o GTIN deve ter 8, 12, 13 ou 14 dígitos.' };
  }
  const body = normalized.slice(0, -1);
  const providedCheck = Number(normalized.slice(-1));
  const expectedCheck = computeGs1Mod10CheckDigit(body);
  if (providedCheck !== expectedCheck) {
    return { present: true, ok: false, error: `Dígito verificador inválido — esperado ${expectedCheck}.` };
  }
  return { present: true, ok: true, error: null };
}

export type QualityCategory = 'identificacao' | 'classificacao' | 'logistica' | 'comercial';

export const QUALITY_CATEGORY_LABEL: Record<QualityCategory, string> = {
  identificacao: 'Identificação',
  classificacao: 'Classificação',
  logistica: 'Logística',
  comercial: 'Comercial',
};

export interface QualityIssue {
  key: 'ean_invalido' | 'ean_ausente' | 'marca_ausente' | 'linha_ausente' | 'local_ausente' | 'preco_ausente' | 'abcxyz_ausente';
  label: string;
  category: QualityCategory;
  fields: string[];
  /** Um dos seis rótulos definidos pelo pedido — nunca texto livre. */
  impact: 'Bloqueia integração' | 'Bloqueia conferência' | 'Afeta rastreabilidade' | 'Afeta endereçamento' | 'Afeta planejamento' | 'Informação complementar';
  /** Só EAN com dígito verificador errado é dado realmente inválido — o resto é lacuna comum (grafite). */
  critical: boolean;
}

export interface QualityInputs {
  ean: string | null;
  price: number | null;
  location: string | null;
  brandId: string | null;
  lineId: string | null;
  hasAbcXyz: boolean;
}

export interface QualityResult {
  score: number; // 0-100
  issues: QualityIssue[];
}

const TOTAL_FACTORS = 6; // EAN válido, marca, linha, local, preço, ABC/XYZ

export function evaluateProductQuality(input: QualityInputs): QualityResult {
  const eanCheck = validateProductEan(input.ean);
  const issues: QualityIssue[] = [];
  let met = 0;

  if (eanCheck.present && eanCheck.ok) {
    met += 1;
  } else if (!eanCheck.present) {
    issues.push({ key: 'ean_ausente', label: 'EAN ausente', category: 'identificacao', fields: ['EAN'], impact: 'Bloqueia conferência', critical: false });
  } else {
    issues.push({ key: 'ean_invalido', label: 'EAN inválido', category: 'identificacao', fields: ['EAN'], impact: 'Bloqueia integração', critical: true });
  }

  if (input.brandId) met += 1;
  else issues.push({ key: 'marca_ausente', label: 'Marca não informada', category: 'classificacao', fields: ['Marca'], impact: 'Informação complementar', critical: false });

  if (input.lineId) met += 1;
  else issues.push({ key: 'linha_ausente', label: 'Linha não informada', category: 'classificacao', fields: ['Linha'], impact: 'Informação complementar', critical: false });

  if (input.location && input.location.trim()) met += 1;
  else issues.push({ key: 'local_ausente', label: 'Local não validado', category: 'logistica', fields: ['Local'], impact: 'Afeta endereçamento', critical: false });

  if (input.price != null) met += 1;
  else issues.push({ key: 'preco_ausente', label: 'Preço ausente', category: 'comercial', fields: ['Preço'], impact: 'Afeta planejamento', critical: false });

  if (input.hasAbcXyz) met += 1;
  else issues.push({ key: 'abcxyz_ausente', label: 'ABC/XYZ ausente', category: 'classificacao', fields: ['ABC/XYZ'], impact: 'Afeta planejamento', critical: false });

  return { score: Math.round((met / TOTAL_FACTORS) * 100), issues };
}

export interface LiteCatalogProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  price: number | null;
  location: string | null;
  updatedAt: string;
  brandId: string | null;
  lineId: string | null;
  hasAbcXyz: boolean;
}

export interface CatalogQualitySnapshot {
  products: LiteCatalogProduct[];
  results: Map<string, QualityResult>;
  lastUpdatedAt: string | null;
}

/** Leitura leve (poucas colunas, sem imagens/joins pesados) da empresa inteira —
 *  mesmo padrão já usado por recomputeAbcXyzForCompany/getAbcXyzMatrix para
 *  estatísticas de empresa (a classificação ABC/XYZ também exige olhar todos os
 *  produtos de uma vez). Roda uma vez ao abrir a tela, não a cada tecla digitada. */
export async function fetchCatalogQualitySnapshot(companyId: string): Promise<CatalogQualitySnapshot> {
  const [{ data: productRows, error: productsError }, { data: assocRows, error: assocError }, { data: classRows, error: classError }] = await Promise.all([
    supabase.from('products').select('id, name, sku, ean, price, location, updated_at'),
    supabase.from('product_brand_associations').select('product_id, brand_id, line_id').eq('company_id', companyId),
    supabase.from('product_abc_xyz_classifications').select('product_id').eq('company_id', companyId),
  ]);
  if (productsError) console.error('[CatalogQuality] products', productsError.message);
  if (assocError) console.error('[CatalogQuality] product_brand_associations', assocError.message);
  if (classError) console.error('[CatalogQuality] product_abc_xyz_classifications', classError.message);

  const assocByProduct = new Map((assocRows ?? []).map(r => [r.product_id, r]));
  const classifiedIds = new Set((classRows ?? []).map(r => r.product_id));

  const products: LiteCatalogProduct[] = (productRows ?? []).map(p => ({
    id: p.id, name: p.name, sku: p.sku, ean: p.ean, price: p.price, location: p.location, updatedAt: p.updated_at,
    brandId: assocByProduct.get(p.id)?.brand_id ?? null,
    lineId: assocByProduct.get(p.id)?.line_id ?? null,
    hasAbcXyz: classifiedIds.has(p.id),
  }));

  const results = new Map<string, QualityResult>();
  let lastUpdatedAt: string | null = null;
  for (const p of products) {
    results.set(p.id, evaluateProductQuality({ ean: p.ean, price: p.price, location: p.location, brandId: p.brandId, lineId: p.lineId, hasAbcXyz: p.hasAbcXyz }));
    if (!lastUpdatedAt || p.updatedAt > lastUpdatedAt) lastUpdatedAt = p.updatedAt;
  }

  return { products, results, lastUpdatedAt };
}
