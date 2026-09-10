// Logo da marca — regras puras (sem I/O), no mesmo split algorithm/service do resto do
// projeto. Duas garantias vivem aqui:
//
// 1. ESCOPO POR WORKSPACE: o caminho do logo no Storage começa sempre pelo company_id
//    (é o que as policies do bucket comparam com get_my_company_id()), e toda resolução
//    path -> URL descarta caminho que não pertença ao workspace atual. Não existe
//    catálogo de logo por nome de marca: marcas homônimas em workspaces diferentes são
//    entidades diferentes.
//
// 2. PONTE POR NOME, LOCAL E EXPLÍCITA: a página "Resultados por Linha" lista linhas de
//    contagem (inventory_brands), que não têm FK para o cadastro de marcas
//    (product_brands). Enquanto essa FK não existir, a ponte é o nome canônico da marca
//    — comparação exata, feita SOMENTE entre registros do MESMO company_id, e aceitando
//    também os aliases que o próprio usuário cadastrou em product_brands.keywords. Sem
//    fuzzy, sem similaridade, sem busca em outro workspace: não achou, cai no fallback.

/** Tipos aceitos no upload. WEBP entra além de PNG/JPEG porque logo de marca costuma
 *  chegar nesse formato. */
export const BRAND_LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Mesmo teto do logo do workspace (workspaceService.ts) — nada de limite novo. */
export const BRAND_LOGO_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** Uma marca do cadastro do workspace atual, do ponto de vista do logo. */
export interface BrandLogoSource {
  brandId: string;
  brandName: string;
  /** Aliases já cadastrados na marca (product_brands.keywords). */
  keywords: string[];
  logoPath: string | null;
}

/** Mensagem de erro pronta para exibir, ou null quando o arquivo serve. */
export function validateBrandLogoFile(file: { type: string; size: number }): string | null {
  if (!BRAND_LOGO_ALLOWED_TYPES.includes(file.type)) {
    return 'Envie uma imagem PNG, JPEG ou WEBP.';
  }
  if (file.size > BRAND_LOGO_MAX_SIZE_BYTES) {
    return 'A imagem deve ter no máximo 5 MB.';
  }
  return null;
}

function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'png';
}

/** Caminho no bucket privado: `<company_id>/brands/<brand_id>/logo-<ts>.<ext>`. A primeira
 *  pasta é o company_id porque é ela que as policies comparam com get_my_company_id() —
 *  o escopo de workspace é garantido pelo caminho, não pela UI. */
export function buildBrandLogoPath(companyId: string, brandId: string, fileName: string, nowMs: number): string {
  return `${companyId}/brands/${brandId}/logo-${nowMs}.${extensionOf(fileName)}`;
}

/** Um caminho só pertence a este workspace se estiver dentro da pasta dele. Guarda de
 *  leitura: mesmo que um caminho de outra empresa acabe gravado numa marca (import,
 *  restore, engano manual), ele não vira logo exibido. */
export function isLogoPathOfCompany(logoPath: string | null | undefined, companyId: string): boolean {
  if (!logoPath || !companyId) return false;
  return logoPath.startsWith(`${companyId}/`);
}

/** Chave canônica do nome de uma marca/linha: sem acento, sem pontuação, minúscula,
 *  espaços colapsados. Serve só para casar nome de linha de contagem com nome/alias de
 *  marca DENTRO do mesmo workspace. */
export function canonicalBrandKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Caminhos que precisam de URL assinada — só os do workspace atual, sem repetição. */
export function logoPathsToSign(brands: BrandLogoSource[], companyId: string): string[] {
  const seen = new Set<string>();
  for (const brand of brands) {
    if (isLogoPathOfCompany(brand.logoPath, companyId)) seen.add(brand.logoPath as string);
  }
  return [...seen];
}

/** brandId -> URL exibível, só das marcas deste workspace com logo real. */
export function resolveBrandLogoUrls(
  brands: BrandLogoSource[],
  companyId: string,
  signedUrlByPath: Record<string, string | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const brand of brands) {
    if (!isLogoPathOfCompany(brand.logoPath, companyId)) continue;
    const url = signedUrlByPath[brand.logoPath as string];
    if (url) out[brand.brandId] = url;
  }
  return out;
}

/** Nome canônico (da marca e de cada alias) -> URL do logo. É o índice que a página de
 *  fechamento usa para achar o logo da linha de contagem sem FK. O nome oficial vence o
 *  alias quando os dois existirem, e nenhuma chave é criada para marca sem logo — a
 *  ausência da chave é exatamente o que dispara o fallback de iniciais. */
export function buildLineLogoUrlMap(
  brands: BrandLogoSource[],
  companyId: string,
  signedUrlByPath: Record<string, string | null>,
): Record<string, string> {
  const byBrandId = resolveBrandLogoUrls(brands, companyId, signedUrlByPath);
  const out: Record<string, string> = {};

  // Aliases primeiro, nomes oficiais depois: assim um nome oficial sobrescreve um alias
  // homônimo de outra marca em vez de perder para ele.
  for (const brand of brands) {
    const url = byBrandId[brand.brandId];
    if (!url) continue;
    for (const keyword of brand.keywords) {
      const key = canonicalBrandKey(keyword);
      if (key) out[key] = url;
    }
  }
  for (const brand of brands) {
    const url = byBrandId[brand.brandId];
    if (!url) continue;
    const key = canonicalBrandKey(brand.brandName);
    if (key) out[key] = url;
  }

  return out;
}

/** Logo de uma linha de contagem pelo nome, dentro do índice do workspace atual. */
export function lineLogoUrl(lineName: string, logoByKey: Record<string, string>): string | null {
  return logoByKey[canonicalBrandKey(lineName)] ?? null;
}

/** Iniciais para o fallback neutro (marca sem logo cadastrado). Até 2 caracteres; o nome
 *  da marca continua sendo exibido ao lado, nunca substituído pelo selo. */
export function brandInitials(brandName: string): string {
  const words = brandName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('pt-BR');
  return (words[0][0] + words[1][0]).toLocaleUpperCase('pt-BR');
}
