import { describe, expect, it } from 'vitest';
import {
  BRAND_LOGO_MAX_SIZE_BYTES,
  brandInitials,
  buildBrandLogoPath,
  buildLineLogoUrlMap,
  canonicalBrandKey,
  isLogoPathOfCompany,
  lineLogoUrl,
  logoPathsToSign,
  resolveBrandLogoUrls,
  validateBrandLogoFile,
  type BrandLogoSource,
} from '../brandLogoAlgorithm';

const AZ = '00000000-0000-0000-0000-000000000001';
const OUTRO = '11111111-1111-1111-1111-111111111111';

const brand = (over: Partial<BrandLogoSource> = {}): BrandLogoSource => ({
  brandId: 'brand-1',
  brandName: 'Nillkin',
  keywords: [],
  logoPath: `${AZ}/brands/brand-1/logo-1.png`,
  ...over,
});

describe('caminho do logo — escopo de workspace', () => {
  it('sempre começa pela pasta do workspace e isola por marca', () => {
    const path = buildBrandLogoPath(AZ, 'brand-1', 'nillkin.png', 1700000000000);
    expect(path).toBe(`${AZ}/brands/brand-1/logo-1700000000000.png`);
    expect(path.startsWith(`${AZ}/`)).toBe(true);
  });

  it('preserva a extensão real e cai em png quando não há uma utilizável', () => {
    expect(buildBrandLogoPath(AZ, 'b', 'marca-esr.webp', 1)).toContain('.webp');
    expect(buildBrandLogoPath(AZ, 'b', 'ringke-logo.jpg', 1)).toContain('.jpg');
    expect(buildBrandLogoPath(AZ, 'b', 'sem-extensao', 1)).toContain('.png');
  });

  it('não reconhece como deste workspace um caminho de outro', () => {
    expect(isLogoPathOfCompany(`${AZ}/brands/b/logo.png`, AZ)).toBe(true);
    expect(isLogoPathOfCompany(`${OUTRO}/brands/b/logo.png`, AZ)).toBe(false);
    expect(isLogoPathOfCompany(null, AZ)).toBe(false);
  });

  it('assina só os caminhos deste workspace, sem repetir', () => {
    const a = brand({ brandId: 'a', logoPath: `${AZ}/brands/a/logo-1.png` });
    const b = brand({ brandId: 'b', logoPath: `${AZ}/brands/a/logo-1.png` });
    const c = brand({ brandId: 'c', logoPath: `${OUTRO}/brands/c/logo-1.png` });
    const d = brand({ brandId: 'd', logoPath: null });

    expect(logoPathsToSign([a, b, c, d], AZ)).toEqual([`${AZ}/brands/a/logo-1.png`]);
  });
});

describe('logo real da marca do workspace atual', () => {
  it('logo cadastrado aparece para a marca e para a linha de mesmo nome', () => {
    const nillkin = brand();
    const signed = { [nillkin.logoPath as string]: 'https://signed/nillkin.png' };

    expect(resolveBrandLogoUrls([nillkin], AZ, signed)).toEqual({ 'brand-1': 'https://signed/nillkin.png' });

    const map = buildLineLogoUrlMap([nillkin], AZ, signed);
    expect(lineLogoUrl('Nillkin', map)).toBe('https://signed/nillkin.png');
    expect(lineLogoUrl('nillkin', map)).toBe('https://signed/nillkin.png');
  });

  it('logo de outro company NÃO aparece, mesmo com o caminho gravado na marca', () => {
    const vazado = brand({ logoPath: `${OUTRO}/brands/brand-1/logo-1.png` });
    const signed = { [vazado.logoPath as string]: 'https://signed/outro.png' };

    expect(resolveBrandLogoUrls([vazado], AZ, signed)).toEqual({});
    expect(lineLogoUrl('Nillkin', buildLineLogoUrlMap([vazado], AZ, signed))).toBeNull();
  });

  it('marca de mesmo nome em outro workspace usa o logo dela, nunca o do primeiro', () => {
    const azNillkin = brand({ brandId: 'az-nillkin', logoPath: `${AZ}/brands/az-nillkin/logo-1.png` });
    const outroNillkin = brand({ brandId: 'outro-nillkin', logoPath: `${OUTRO}/brands/outro-nillkin/logo-1.png` });
    const signed = {
      [azNillkin.logoPath as string]: 'https://signed/az.png',
      [outroNillkin.logoPath as string]: 'https://signed/outro.png',
    };

    expect(lineLogoUrl('Nillkin', buildLineLogoUrlMap([azNillkin, outroNillkin], AZ, signed))).toBe('https://signed/az.png');
    expect(lineLogoUrl('Nillkin', buildLineLogoUrlMap([azNillkin, outroNillkin], OUTRO, signed))).toBe('https://signed/outro.png');
  });

  it('troca de workspace não mantém o asset anterior: o mapa do novo company não tem a chave do antigo', () => {
    const soDoAz = brand({ brandId: 'az-only', brandName: 'Ringke', logoPath: `${AZ}/brands/az-only/logo-1.png` });
    const signed = { [soDoAz.logoPath as string]: 'https://signed/az-ringke.png' };

    const mapaAz = buildLineLogoUrlMap([soDoAz], AZ, signed);
    expect(lineLogoUrl('Ringke', mapaAz)).toBe('https://signed/az-ringke.png');

    // Mesmo dado, outro workspace ativo: nada é reaproveitado.
    const mapaOutro = buildLineLogoUrlMap([soDoAz], OUTRO, signed);
    expect(mapaOutro).toEqual({});
    expect(lineLogoUrl('Ringke', mapaOutro)).toBeNull();
  });

  it('sem logo cadastrado a chave não existe — é o que dispara o fallback', () => {
    const semLogo = brand({ brandId: 'sem-logo', logoPath: null });
    const map = buildLineLogoUrlMap([semLogo], AZ, {});
    expect(map).toEqual({});
    expect(lineLogoUrl('Nillkin', map)).toBeNull();
  });

  it('assinatura que falhou não vira logo exibido', () => {
    const nillkin = brand();
    expect(buildLineLogoUrlMap([nillkin], AZ, { [nillkin.logoPath as string]: null })).toEqual({});
  });

  it('alias cadastrado na própria marca também resolve, e o nome oficial tem prioridade', () => {
    const dux = brand({ brandId: 'dux', brandName: 'DUX', keywords: ['Dux Ducis'], logoPath: `${AZ}/brands/dux/logo-1.png` });
    const outra = brand({ brandId: 'outra', brandName: 'Dux Ducis', keywords: [], logoPath: `${AZ}/brands/outra/logo-2.png` });
    const signed = {
      [dux.logoPath as string]: 'https://signed/dux.png',
      [outra.logoPath as string]: 'https://signed/outra.png',
    };

    const map = buildLineLogoUrlMap([dux, outra], AZ, signed);
    expect(lineLogoUrl('DUX', map)).toBe('https://signed/dux.png');
    // "Dux Ducis" é alias de DUX e nome oficial da outra marca: o nome oficial vence.
    expect(lineLogoUrl('Dux Ducis', map)).toBe('https://signed/outra.png');
  });

  it('nome canônico ignora acento, caixa e pontuação, sem fazer aproximação', () => {
    expect(canonicalBrandKey('Térmicos GC')).toBe('termicos gc');
    expect(canonicalBrandKey('X-Level')).toBe('x level');
    expect(canonicalBrandKey('  ESR  ')).toBe('esr');
    // Nomes diferentes continuam diferentes — nada de fuzzy.
    expect(canonicalBrandKey('GoCase Capas')).not.toBe(canonicalBrandKey('GoCase'));
  });
});

describe('fallback neutro', () => {
  it('usa iniciais do nome, sem substituir o nome da marca', () => {
    expect(brandInitials('Nillkin')).toBe('NI');
    expect(brandInitials('Dux Ducis')).toBe('DD');
    expect(brandInitials('Órion Peças')).toBe('ÓP');
  });

  it('não estoura com nome vazio', () => {
    expect(brandInitials('')).toBe('—');
    expect(brandInitials('   ')).toBe('—');
  });
});

describe('validação do arquivo', () => {
  it('aceita PNG, JPEG e WEBP dentro do limite', () => {
    expect(validateBrandLogoFile({ type: 'image/png', size: 1024 })).toBeNull();
    expect(validateBrandLogoFile({ type: 'image/jpeg', size: 1024 })).toBeNull();
    expect(validateBrandLogoFile({ type: 'image/webp', size: 1024 })).toBeNull();
  });

  it('recusa outro formato e arquivo acima de 5 MB', () => {
    expect(validateBrandLogoFile({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPEG ou WEBP/);
    expect(validateBrandLogoFile({ type: 'image/png', size: BRAND_LOGO_MAX_SIZE_BYTES + 1 })).toMatch(/5 MB/);
  });
});
