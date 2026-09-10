// Logo da marca — camada de I/O sobre product_brands (fonte de verdade, company-scoped
// desde a migration 075) e o bucket privado `brand-logos`. Lê e grava SOMENTE dentro do
// workspace recebido: toda query filtra company_id e todo caminho começa pelo company_id,
// que é o que as policies do bucket comparam com get_my_company_id().

import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';
import {
  buildBrandLogoPath,
  buildLineLogoUrlMap,
  logoPathsToSign,
  validateBrandLogoFile,
  type BrandLogoSource,
} from './brandLogoAlgorithm';

const BRAND_LOGO_BUCKET = 'brand-logos';
const SIGNED_URL_TTL_SECONDS = 3600;

interface BrandLogoRow {
  id: string;
  name: string;
  keywords: string[] | null;
  logo_path: string | null;
}

/** Marcas do workspace com o caminho do logo. Tolerante de propósito: se a coluna
 *  `logo_path` ainda não existir no banco (migration 108 não aplicada), devolve lista
 *  vazia em vez de estourar — a tela segue funcionando com o fallback. */
export async function listBrandLogoSources(companyId: string): Promise<BrandLogoSource[]> {
  const { data, error } = await supabase
    .from('product_brands')
    .select('id, name, keywords, logo_path')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('name');

  if (error) {
    console.warn('[brandLogoService] logos de marca indisponíveis:', error.message);
    return [];
  }

  return ((data ?? []) as BrandLogoRow[]).map(row => ({
    brandId: row.id,
    brandName: row.name,
    keywords: row.keywords ?? [],
    logoPath: row.logo_path ?? null,
  }));
}

/** URLs assinadas em lote (uma chamada para todos os caminhos) — nunca uma por marca. */
export async function signBrandLogoPaths(paths: string[]): Promise<Record<string, string | null>> {
  if (paths.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(BRAND_LOGO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);

  if (error || !data) return {};

  const out: Record<string, string | null> = {};
  data.forEach((entry, index) => {
    const path = entry.path ?? paths[index];
    out[path] = entry.error ? null : entry.signedUrl;
  });
  return out;
}

/** Índice nome-canônico -> URL do logo, usado pela página de fechamento para resolver o
 *  logo da linha de contagem dentro do workspace atual. */
export async function loadLineLogoUrlMap(companyId: string): Promise<Record<string, string>> {
  const brands = await listBrandLogoSources(companyId);
  const paths = logoPathsToSign(brands, companyId);
  if (paths.length === 0) return {};
  const signed = await signBrandLogoPaths(paths);
  return buildLineLogoUrlMap(brands, companyId, signed);
}

/** URL assinada de uma única marca — usada pelo formulário de marca (preview do logo
 *  atual). Caminho de outro workspace não é assinado: a policy do bucket recusaria. */
export async function signSingleBrandLogo(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  const signed = await signBrandLogoPaths([logoPath]);
  return signed[logoPath] ?? null;
}

export interface UploadBrandLogoInput {
  companyId: string;
  brandId: string;
  file: File;
  userId: string;
  userEmail: string | null;
}

/** Sobe o logo e guarda o CAMINHO em product_brands.logo_path — mesmo padrão de
 *  uploadWorkspaceLogo (workspaceService.ts). O update filtra company_id além do id:
 *  uma marca de outro workspace nunca é alvo, nem por id trocado. Ao substituir, o
 *  arquivo anterior é removido depois que a coluna já aponta para o novo. */
export async function uploadBrandLogo(input: UploadBrandLogoInput): Promise<string> {
  const { companyId, brandId, file, userId, userEmail } = input;

  const invalid = validateBrandLogoFile(file);
  if (invalid) throw new Error(invalid);

  const { data: current } = await supabase
    .from('product_brands')
    .select('logo_path')
    .eq('id', brandId)
    .eq('company_id', companyId)
    .maybeSingle();
  const previousPath = (current as { logo_path: string | null } | null)?.logo_path ?? null;

  const path = buildBrandLogoPath(companyId, brandId, file.name, Date.now());

  const { error: uploadError } = await supabase.storage
    .from(BRAND_LOGO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from('product_brands')
    .update({ logo_path: path, updated_at: new Date().toISOString() })
    .eq('id', brandId)
    .eq('company_id', companyId);
  if (updateError) throw updateError;

  if (previousPath && previousPath !== path) {
    await supabase.storage.from(BRAND_LOGO_BUCKET).remove([previousPath]);
  }

  await logAuditEvent({
    companyId, userId, userEmail: userEmail ?? '',
    action: 'product_brand.logo_uploaded',
    resourceType: 'product_brands', resourceId: brandId,
  });

  return path;
}

export interface RemoveBrandLogoInput {
  companyId: string;
  brandId: string;
  logoPath: string | null;
  userId: string;
  userEmail: string | null;
}

/** Remove o logo da marca. O arquivo é apagado depois da coluna: se o remove do Storage
 *  falhar, a marca já está sem logo (nunca fica apontando para objeto inexistente). */
export async function removeBrandLogo(input: RemoveBrandLogoInput): Promise<void> {
  const { companyId, brandId, logoPath, userId, userEmail } = input;

  const { error } = await supabase
    .from('product_brands')
    .update({ logo_path: null, updated_at: new Date().toISOString() })
    .eq('id', brandId)
    .eq('company_id', companyId);
  if (error) throw error;

  if (logoPath) {
    await supabase.storage.from(BRAND_LOGO_BUCKET).remove([logoPath]);
  }

  await logAuditEvent({
    companyId, userId, userEmail: userEmail ?? '',
    action: 'product_brand.logo_removed',
    resourceType: 'product_brands', resourceId: brandId,
  });
}
