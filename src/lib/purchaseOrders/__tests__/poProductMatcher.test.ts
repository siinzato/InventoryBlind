import { describe, expect, it } from 'vitest';
import { matchPoItem, buildDetoParaLookup, type PoMatchableItem, type NfeMatchableItem } from '../poProductMatcher';

function poItem(overrides: Partial<PoMatchableItem> = {}): PoMatchableItem {
  return { id: 'po-1', originCode: null, eanNormalized: null, productId: null, description: '', ...overrides };
}
function nfeItem(overrides: Partial<NfeMatchableItem> = {}): NfeMatchableItem {
  return { id: 'nfe-1', nfeCode: null, nfeEanNormalized: null, productId: null, description: '', ...overrides };
}

describe('matchPoItem', () => {
  it('correspondência exata por SKU/cProd', () => {
    const result = matchPoItem(
      poItem({ originCode: 'ABC123' }),
      [nfeItem({ id: 'nfe-1', nfeCode: 'ABC123' }), nfeItem({ id: 'nfe-2', nfeCode: 'XYZ' })],
      buildDetoParaLookup([])
    );
    expect(result.candidates).toEqual([{ nfeItemId: 'nfe-1', method: 'code' }]);
  });

  it('correspondência por EAN/GTIN quando não há código igual', () => {
    const result = matchPoItem(
      poItem({ originCode: 'DIFERENTE', eanNormalized: '7891234567890' }),
      [nfeItem({ id: 'nfe-1', nfeCode: 'OUTRO', nfeEanNormalized: '7891234567890' })],
      buildDetoParaLookup([])
    );
    expect(result.candidates).toEqual([{ nfeItemId: 'nfe-1', method: 'ean' }]);
  });

  it('produto interno já associado tem prioridade sobre código/EAN', () => {
    const result = matchPoItem(
      poItem({ productId: 'prod-1', originCode: 'ABC' }),
      [
        nfeItem({ id: 'nfe-1', nfeCode: 'ABC' }),
        nfeItem({ id: 'nfe-2', productId: 'prod-1' }),
      ],
      buildDetoParaLookup([])
    );
    expect(result.candidates).toEqual([{ nfeItemId: 'nfe-2', method: 'product_id' }]);
  });

  it('De/Para confirmado resolve quando não há código/EAN batendo direto', () => {
    const learned = buildDetoParaLookup([{ matchType: 'code', matchValue: 'CODEXYZ', productId: 'prod-9' }]);
    const result = matchPoItem(
      poItem({ originCode: 'CODEXYZ' }),
      [nfeItem({ id: 'nfe-1', productId: 'prod-9' })],
      learned
    );
    expect(result.candidates).toEqual([{ nfeItemId: 'nfe-1', method: 'learned' }]);
  });

  it('sem nenhuma correspondência, sugere só por descrição, nunca confirma', () => {
    const result = matchPoItem(
      poItem({ originCode: 'NAOBATE', description: 'Parafuso sextavado M8' }),
      [nfeItem({ id: 'nfe-1', nfeCode: 'OUTRO', description: 'Parafuso sextavado M8 zincado' })],
      buildDetoParaLookup([])
    );
    expect(result.candidates).toEqual([]);
    expect(result.nameSuggestion?.nfeItemId).toBe('nfe-1');
  });

  it('descrição sem similaridade suficiente não gera sugestão nem confirmação', () => {
    const result = matchPoItem(
      poItem({ originCode: 'NAOBATE', description: 'Parafuso sextavado M8' }),
      [nfeItem({ id: 'nfe-1', nfeCode: 'OUTRO', description: 'Caixa de papelão ondulado' })],
      buildDetoParaLookup([])
    );
    expect(result.candidates).toEqual([]);
    expect(result.nameSuggestion).toBeNull();
  });

  it('vários itens de NF-e com o mesmo código são todos candidatos (repartição entre notas)', () => {
    const result = matchPoItem(
      poItem({ originCode: 'ABC' }),
      [nfeItem({ id: 'nfe-1', nfeCode: 'ABC' }), nfeItem({ id: 'nfe-2', nfeCode: 'ABC' })],
      buildDetoParaLookup([])
    );
    expect(result.candidates.map(c => c.nfeItemId).sort()).toEqual(['nfe-1', 'nfe-2']);
  });
});

describe('buildDetoParaLookup', () => {
  it('separa por tipo de correspondência (code/ean) sem misturar', () => {
    const lookup = buildDetoParaLookup([
      { matchType: 'code', matchValue: 'A', productId: 'p1' },
      { matchType: 'ean', matchValue: 'A', productId: 'p2' },
    ]);
    expect(lookup.byCode.get('A')).toBe('p1');
    expect(lookup.byEan.get('A')).toBe('p2');
  });
});
