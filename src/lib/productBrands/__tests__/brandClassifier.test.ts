import { describe, expect, it } from 'vitest';
import { classifyProductTitle, type ClassifierBrand } from '../brandClassifier';

function brand(overrides: Partial<ClassifierBrand> = {}): ClassifierBrand {
  return { id: 'b1', name: 'Nillkin', keywords: [], active: true, lines: [], ...overrides };
}

const AZ_BRANDS: ClassifierBrand[] = [
  brand({ id: 'nillkin', name: 'Nillkin' }),
  brand({ id: 'ringke', name: 'Ringke' }),
  brand({
    id: 'gocase', name: 'GoCase', keywords: ['GC'],
    lines: [
      { id: 'capas', name: 'Capas', active: true, keywords: ['GoCase Capas'] },
      { id: 'mochilas', name: 'Mochilas e Tote Daily', active: true, keywords: ['Linha de Mochilas GC', 'Linha Tote Daily GC'] },
    ],
  }),
  brand({ id: 'az', name: 'AZ' }),
  brand({ id: 'xlevel', name: 'X-Level' }),
  brand({ id: 'dexnor', name: 'Dexnor' }),
  brand({ id: 'dux', name: 'DUX' }),
  brand({ id: 'esr', name: 'ESR' }),
];

describe('classifyProductTitle', () => {
  it('associa cada marca oficial pelo próprio nome', () => {
    expect(classifyProductTitle('Capa Nillkin CamShield para iPhone 15', AZ_BRANDS).brandId).toBe('nillkin');
    expect(classifyProductTitle('Case Ringke Fusion transparente', AZ_BRANDS).brandId).toBe('ringke');
    expect(classifyProductTitle('Suporte AZ para carro', AZ_BRANDS).brandId).toBe('az');
    expect(classifyProductTitle('Case X-Level anti-impacto', AZ_BRANDS).brandId).toBe('xlevel');
    expect(classifyProductTitle('Fone Dexnor bluetooth', AZ_BRANDS).brandId).toBe('dexnor');
    expect(classifyProductTitle('Cabo DUX USB-C', AZ_BRANDS).brandId).toBe('dux');
    expect(classifyProductTitle('Película ESR vidro temperado', AZ_BRANDS).brandId).toBe('esr');
  });

  it('GC associa GoCase via alias', () => {
    expect(classifyProductTitle('Necessaire GC modelo A', AZ_BRANDS).brandId).toBe('gocase');
  });

  it('termos curtos só casam como palavra completa, nunca como parte de outra palavra', () => {
    // "AZ" não deve casar dentro de "AMAZONAS" nem "GC" dentro de "LOGCASE"
    expect(classifyProductTitle('Suporte para AMAZONAS modelo X', AZ_BRANDS).status).toBe('unmatched');
    expect(classifyProductTitle('Capa LOGCASE universal', AZ_BRANDS).status).toBe('unmatched');
  });

  it('tags específicas identificam a linha correta dentro da marca', () => {
    const result = classifyProductTitle('Linha Tote Daily GC bolsa térmica', AZ_BRANDS);
    expect(result.brandId).toBe('gocase');
    expect(result.lineId).toBe('mochilas');
  });

  it('marca exata sem linha correspondente mantém linha não identificada, status auto', () => {
    const result = classifyProductTitle('GoCase acessório qualquer', AZ_BRANDS);
    expect(result.status).toBe('auto');
    expect(result.brandId).toBe('gocase');
    expect(result.lineId).toBeNull();
  });

  it('conflito entre marcas vai para revisão, nunca escolhe silenciosamente', () => {
    const conflicting: ClassifierBrand[] = [brand({ id: 'a', name: 'Alfa' }), brand({ id: 'b', name: 'Beta', keywords: ['Alfa'] })];
    const result = classifyProductTitle('Produto Alfa modelo 1', conflicting);
    expect(result.status).toBe('needs_review');
    expect(result.brandCandidates.map(c => c.brandId).sort()).toEqual(['a', 'b']);
  });

  it('nova marca cadastrada em tempo de execução funciona sem alteração de código', () => {
    const withNewBrand = [...AZ_BRANDS, brand({ id: 'new', name: 'Marca Nova Sem Codigo' })];
    expect(classifyProductTitle('Case Marca Nova Sem Codigo modelo Z', withNewBrand).brandId).toBe('new');
  });

  it('marca inativa nunca é sugerida', () => {
    const withInactive = [brand({ id: 'x', name: 'Inativa', active: false })];
    expect(classifyProductTitle('Produto Inativa modelo 1', withInactive).status).toBe('unmatched');
  });

  it('sem nenhuma correspondência fica não identificado, texto original nunca é alterado', () => {
    const title = 'Produto Genérico Sem Marca';
    const result = classifyProductTitle(title, AZ_BRANDS);
    expect(result.status).toBe('unmatched');
    expect(title).toBe('Produto Genérico Sem Marca');
  });
});
