// Garantias do logo de marca que não são função pura — mesmo mecanismo de
// migrationGuards.test.ts (import.meta.glob raw). Não substitui teste de componente (o
// projeto não tem essa infra); trava as decisões que, se regredirem, quebram isolamento
// entre workspaces ou apagam dado do usuário.

import { describe, expect, it } from 'vitest';
import { buildBrandLogoPath } from '../brandLogoAlgorithm';

const RAW = import.meta.glob(
  [
    '/src/lib/productBrands/productBrandService.ts',
    '/src/lib/productBrands/brandClassifier.ts',
    '/src/lib/brandLogos/brandLogoService.ts',
    '/src/components/brandLogos/BrandMark.tsx',
    '/src/components/productBrands/BrandLineFormModal.tsx',
    '/src/components/productBrands/ProductBrandsPage.tsx',
    '/supabase/migrations/20260908160000_108_product_brand_logos.sql',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const src = (fragment: string): string => {
  const key = Object.keys(RAW).find(p => p.endsWith(fragment));
  return key ? RAW[key] : '';
};

const SERVICE = src('productBrands/productBrandService.ts');
const CLASSIFIER = src('productBrands/brandClassifier.ts');
const LOGO_SERVICE = src('brandLogos/brandLogoService.ts');
const MARK = src('brandLogos/BrandMark.tsx');
const FORM = src('productBrands/BrandLineFormModal.tsx');
const PAGE = src('productBrands/ProductBrandsPage.tsx');
const MIGRATION = src('108_product_brand_logos.sql');

describe('fonte de verdade', () => {
  it('todos os arquivos lidos existem', () => {
    for (const [name, content] of Object.entries({ SERVICE, CLASSIFIER, LOGO_SERVICE, MARK, FORM, PAGE, MIGRATION })) {
      expect(content.length, name).toBeGreaterThan(0);
    }
  });

  it('a migration é aditiva: só a coluna, e nada em product_lines', () => {
    expect(MIGRATION).toContain('ALTER TABLE product_brands ADD COLUMN IF NOT EXISTS logo_path text;');
    expect(MIGRATION).not.toMatch(/ALTER TABLE product_lines/);
    expect(MIGRATION).not.toMatch(/DROP|DELETE FROM|TRUNCATE/i);
  });

  it('ProductBrand expõe logoPath e brandFromRow mapeia logo_path', () => {
    expect(SERVICE).toContain('logoPath: string | null');
    expect(SERVICE).toContain('logo_path: string | null');
    expect(SERVICE).toContain('logoPath: row.logo_path ?? null');
  });

  it('listBrands continua company-scoped', () => {
    expect(SERVICE).toContain("from('product_brands').select('*').eq('company_id', companyId)");
  });

  it('product_lines não ganha logo próprio', () => {
    const lineInterface = SERVICE.slice(SERVICE.indexOf('export interface ProductLine'), SERVICE.indexOf('export interface ProductBrandAssociation'));
    expect(lineInterface).not.toContain('logoPath');
    expect(SERVICE).not.toMatch(/from\('product_lines'\)[\s\S]{0,200}logo_path/);
  });

  it('o classificador de produtos não foi tocado pelo logo', () => {
    expect(CLASSIFIER).not.toContain('logo');
  });
});

describe('caminho e escopo do asset', () => {
  it('o caminho carrega companyId e brandId, nessa ordem', () => {
    const companyId = '00000000-0000-0000-0000-000000000001';
    const brandId = '6a1439dc-23f9-41b7-ad11-7ee9c210596f';
    const path = buildBrandLogoPath(companyId, brandId, 'nillkin.png', 1700000000000);

    expect(path.startsWith(`${companyId}/`)).toBe(true);
    expect(path).toContain(`/brands/${brandId}/`);
    // O nome do arquivo é gerado, não é o do usuário — nome não isola tenant.
    expect(path).not.toContain('nillkin');
  });

  it('toda escrita do logo filtra company_id junto do id da marca', () => {
    const writes = LOGO_SERVICE.match(/\.eq\('id', brandId\)\s*\n\s*\.eq\('company_id', companyId\)/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });

  it('o banco guarda caminho, nunca URL assinada', () => {
    expect(LOGO_SERVICE).toContain('logo_path: path');
    expect(LOGO_SERVICE).not.toMatch(/logo_path:\s*signedUrl/);
    expect(SERVICE).not.toContain('signedUrl');
  });

  it('não existe catálogo de logo por nome de marca em lugar nenhum', () => {
    for (const content of [SERVICE, LOGO_SERVICE, MARK, FORM, PAGE]) {
      expect(content).not.toMatch(/brandLogos\s*[:=]\s*\{/);
      expect(content).not.toMatch(/logoByBrandName/);
      // Nome de marca como CHAVE de objeto (o catálogo proibido). Menção em comentário
      // não é catálogo; o que não pode existir é `{ Nillkin: '...' }`.
      expect(content).not.toMatch(/["']?(Nillkin|Ringke|GoCase|Dexnor|X-Level|ESR)["']?\s*:\s*['"`/]/);
    }
  });
});

describe('exibição', () => {
  it('logo real vira <img> com object-contain; iniciais só como fallback', () => {
    expect(MARK).toContain('object-contain');
    expect(MARK).not.toContain('object-cover');
    expect(MARK).toContain('if (url && !failed)');
    expect(MARK).toContain('brandInitials(name)');
  });

  it('imagem que falha ao carregar cai no fallback', () => {
    expect(MARK).toContain('onError={() => setFailed(true)}');
    // URL nova reabilita a tentativa (troca de logo/de workspace).
    expect(MARK).toContain('useEffect(() => { setFailed(false); }, [url]);');
  });

  it('a listagem resolve os logos em lote e monta um Map por brandId', () => {
    expect(PAGE).toContain('logoPathsToSign(logoSources, companyId)');
    expect(PAGE).toContain('signBrandLogoPaths(paths)');
    expect(PAGE).toContain('resolveBrandLogoUrls(logoSources, companyId, signed)');
    expect(PAGE).toContain('url={logoUrls[brand.id]}');
  });

  it('troca de workspace limpa marcas e URLs antes de recarregar', () => {
    const effect = PAGE.slice(PAGE.indexOf('useEffect(() => {'), PAGE.indexOf('}, [companyId]);'));
    expect(effect).toContain('setBrands([])');
    expect(effect).toContain('setLogoUrls({})');
  });
});

describe('formulário da marca', () => {
  it('a área de logo existe apenas para marca, nunca para linha', () => {
    // O rótulo do campo aparece logo dentro de um guard de modo 'brand'.
    expect(FORM).toMatch(/\{mode === 'brand' && \([\s\S]{0,400}Logo da marca/);
    expect(FORM).toContain('Selecionar imagem');
    expect(FORM).toContain('Substituir logo');
  });

  it('marca nova é criada primeiro; o upload usa o id devolvido', () => {
    const createIdx = FORM.indexOf('await createBrand(');
    const uploadIdx = FORM.indexOf('await uploadBrandLogo(');
    expect(createIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(createIdx);
    expect(FORM).toContain('brandIdForLogo = (await createBrand(');
  });

  it('falha no logo não desfaz nem apaga a marca — só avisa', () => {
    expect(FORM).toContain('A marca foi salva, mas o logo não pôde ser enviado');
    expect(FORM).not.toMatch(/deleteBrand|setBrandActive\(.*false/);
  });

  it('marca sem logo salva normalmente (upload só com arquivo escolhido)', () => {
    expect(FORM).toContain('if (pendingFile) {');
  });

  it('preview local antes de salvar, com revogação da URL', () => {
    expect(FORM).toContain('URL.createObjectURL(pendingFile)');
    expect(FORM).toContain('URL.revokeObjectURL(url)');
  });
});

describe('substituição e remoção', () => {
  it('o arquivo antigo só é removido depois de a coluna apontar para o novo', () => {
    const updateIdx = LOGO_SERVICE.indexOf("update({ logo_path: path");
    const removeIdx = LOGO_SERVICE.indexOf('remove([previousPath])');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(updateIdx);
    // E o upload do novo vem antes de tudo isso.
    expect(LOGO_SERVICE.indexOf('.upload(path, file')).toBeLessThan(updateIdx);
  });

  it('remover logo zera logo_path e apaga o asset, sem tocar na marca', () => {
    const removeFn = LOGO_SERVICE.slice(LOGO_SERVICE.indexOf('export async function removeBrandLogo'));
    expect(removeFn).toContain('logo_path: null');
    expect(removeFn).toContain('remove([logoPath])');
    expect(removeFn).not.toContain('active');
  });

  it('as duas ações são auditadas com o id da marca', () => {
    expect(LOGO_SERVICE).toContain("action: 'product_brand.logo_uploaded'");
    expect(LOGO_SERVICE).toContain("action: 'product_brand.logo_removed'");
    expect(LOGO_SERVICE).toContain('resourceId: brandId');
  });
});
