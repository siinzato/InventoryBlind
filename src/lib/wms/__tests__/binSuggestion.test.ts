// Guardas da sugestão de endereço.
//
// Duas coisas precisam ser verdade aqui, e as duas quebram em silêncio:
//
//   1. A tela NUNCA pode sugerir uma vaga que a RPC recusaria. Sugerir e levar erro na
//      cara do operador é pior que não sugerir nada.
//   2. A tela NUNCA pode inventar restrição que a empresa não cadastrou — não há peso,
//      categoria nem classe de armazenagem neste modelo.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_OCCUPANCY, freeBoxesOf, occupancyByProduct, previewTransfer, rejectionFor, suggestBins,
  type BinOccupancy,
} from '../binSuggestion';
import type { StorageBin } from '../wmsService';

const vaga = (code: string, over: Partial<StorageBin> = {}): StorageBin => ({
  id: code,
  code,
  binType: 'pulmao',
  capacityBoxes: null,
  blocked: false,
  blockedReason: null,
  ...over,
});

const ocup = (over: Partial<BinOccupancy> = {}): BinOccupancy => ({ ...EMPTY_OCCUPANCY, ...over });

const mapa = (entries: Array<[string, BinOccupancy]>) => new Map(entries);

describe('o que a tela recusa é exatamente o que a RPC recusaria', () => {
  it('vaga bloqueada não entra', () => {
    expect(rejectionFor(vaga('PP-A01-N1', { blocked: true }), EMPTY_OCCUPANCY, { boxes: 1, unitsPerBox: 12 }))
      .toBe('bloqueado');
  });

  it('capacidade declarada insuficiente não entra', () => {
    const b = vaga('PP-A01-N1', { capacityBoxes: 10 });
    expect(rejectionFor(b, ocup({ totalBoxes: 8 }), { boxes: 3, unitsPerBox: 12 })).toBe('sem-capacidade');
    expect(rejectionFor(b, ocup({ totalBoxes: 8 }), { boxes: 2, unitsPerBox: 12 })).toBeNull();
  });

  // `wms_bin_putaway` e `wms_bin_transfer` recusam somar caixas de pack diferente.
  it('mesmo SKU com pack diferente não entra', () => {
    const occ = ocup({ totalBoxes: 4, sameSkuBoxes: 4, sameSkuUnitsPerBox: 6, distinctSkus: 1 });
    expect(rejectionFor(vaga('PP-A01-N1'), occ, { boxes: 1, unitsPerBox: 12 })).toBe('pack-diferente');
    expect(rejectionFor(vaga('PP-A01-N1'), occ, { boxes: 1, unitsPerBox: 6 })).toBeNull();
  });

  it('a origem nunca é destino na transferência', () => {
    expect(rejectionFor(vaga('PP-A01-N1'), EMPTY_OCCUPANCY, { boxes: 1, unitsPerBox: 12, excludeCode: 'PP-A01-N1' }))
      .toBe('mesma-origem');
  });

  // Sem capacidade declarada NÃO é motivo de recusa: a RPC também deixa passar.
  // Tratar NULL como zero inventaria um limite que a empresa não declarou.
  it('capacidade não declarada não barra nada', () => {
    expect(rejectionFor(vaga('PP-A01-N1'), ocup({ totalBoxes: 999 }), { boxes: 50, unitsPerBox: 12 })).toBeNull();
    expect(freeBoxesOf(vaga('PP-A01-N1'), ocup({ totalBoxes: 999 }))).toBeNull();
  });

  it('pack ainda não informado não barra por pack', () => {
    const occ = ocup({ totalBoxes: 4, sameSkuBoxes: 4, sameSkuUnitsPerBox: 6, distinctSkus: 1 });
    expect(rejectionFor(vaga('PP-A01-N1'), occ, { boxes: 1, unitsPerBox: null })).toBeNull();
  });
});

describe('ordem das sugestões', () => {
  const bins = [
    vaga('PP-A01-N1', { capacityBoxes: 20 }),
    vaga('PP-A02-N1', { capacityBoxes: 20 }),
    vaga('PP-A03-N3', { capacityBoxes: 20 }),
  ];

  // O pedido foi explícito: priorizar consolidação.
  it('consolidar vence vaga vazia', () => {
    const r = suggestBins({
      bins,
      occupancyByCode: mapa([
        ['PP-A02-N1', ocup({ totalBoxes: 5, sameSkuBoxes: 5, sameSkuUnitsPerBox: 12, distinctSkus: 1 })],
      ]),
      boxes: 2,
      unitsPerBox: 12,
    });
    expect(r[0].bin.code).toBe('PP-A02-N1');
    expect(r[0].consolidates).toBe(true);
    expect(r[0].reasons[0]).toContain('Já tem este SKU');
  });

  // Vaga misturada é o problema que o módulo nasceu para resolver.
  it('vaga vazia vence vaga ocupada por OUTRO SKU', () => {
    const r = suggestBins({
      bins: [vaga('PP-A01-N1', { capacityBoxes: 20 }), vaga('PP-A02-N1', { capacityBoxes: 20 })],
      occupancyByCode: mapa([
        ['PP-A01-N1', ocup({ totalBoxes: 5, distinctSkus: 1 })],
      ]),
      boxes: 2,
      unitsPerBox: 12,
    });
    expect(r[0].bin.code).toBe('PP-A02-N1');
    expect(r[0].reasons[0]).toBe('Vaga vazia');
  });

  it('entre vagas iguais, nível baixo primeiro', () => {
    const r = suggestBins({
      bins: [vaga('PP-A01-N3', { capacityBoxes: 20 }), vaga('PP-A02-N1', { capacityBoxes: 20 })],
      occupancyByCode: mapa([]),
      boxes: 2,
      unitsPerBox: 12,
    });
    expect(r[0].bin.code).toBe('PP-A02-N1');
    expect(r[0].reasons).toContain('Nível baixo, mais fácil de acessar');
  });

  it('empate total resolve pela ordem de caminhada do código', () => {
    const r = suggestBins({
      bins: [vaga('PP-B01-N1'), vaga('PP-A01-N1')],
      occupancyByCode: mapa([]),
      boxes: 1,
      unitsPerBox: 12,
    });
    expect(r.map(s => s.bin.code)).toEqual(['PP-A01-N1', 'PP-B01-N1']);
  });

  it('recusadas não aparecem na lista', () => {
    const r = suggestBins({
      bins: [
        vaga('PP-A01-N1', { blocked: true }),
        vaga('PP-A02-N1', { capacityBoxes: 2 }),
        vaga('PP-A03-N1', { capacityBoxes: 20 }),
      ],
      occupancyByCode: mapa([['PP-A02-N1', ocup({ totalBoxes: 2 })]]),
      boxes: 5,
      unitsPerBox: 12,
    });
    expect(r.map(s => s.bin.code)).toEqual(['PP-A03-N1']);
  });

  it('cada sugestão diz por que foi sugerida', () => {
    const r = suggestBins({
      bins: [vaga('PP-A01-N1', { capacityBoxes: 20 })],
      occupancyByCode: mapa([]),
      boxes: 3,
      unitsPerBox: 12,
    });
    expect(r[0].reasons).toContain('Vaga vazia');
    expect(r[0].reasons).toContain('20 cx livres');
    expect(r[0].freeBoxes).toBe(20);
  });

  it('sem capacidade declarada, a sugestão diz isso em vez de inventar número', () => {
    const r = suggestBins({ bins: [vaga('PP-A01-N1')], occupancyByCode: mapa([]), boxes: 3, unitsPerBox: 12 });
    expect(r[0].freeBoxes).toBeNull();
    expect(r[0].reasons).toContain('Sem capacidade declarada');
  });
});

describe('saldo antes e depois da transferência', () => {
  it('mostra a conta dos dois lados', () => {
    const p = previewTransfer(
      ocup({ totalBoxes: 10, sameSkuBoxes: 10 }),
      ocup({ totalBoxes: 3, sameSkuBoxes: 3 }),
      4,
    );
    expect(p).toEqual({ fromBefore: 10, fromAfter: 6, toBefore: 3, toAfter: 7 });
  });

  it('transferir tudo zera a origem, sem passar de zero', () => {
    const p = previewTransfer(ocup({ sameSkuBoxes: 5 }), EMPTY_OCCUPANCY, 9);
    expect(p.fromAfter).toBe(0);
    expect(p.toAfter).toBe(9);
  });
});

describe('ocupação derivada do saldo existente', () => {
  const placements = [
    { binCode: 'PP-A01-N1', productId: 'p1', boxes: 4, unitsPerBox: 12 },
    { binCode: 'PP-A01-N1', productId: 'p2', boxes: 3, unitsPerBox: 6 },
    { binCode: 'PP-B01-N1', productId: 'p1', boxes: 5, unitsPerBox: 12 },
  ];

  it('soma todos os SKUs da vaga e destaca o SKU em questão', () => {
    const m = occupancyByProduct(placements, 'p1');
    expect(m.get('PP-A01-N1')).toEqual({
      totalBoxes: 7, distinctSkus: 2, sameSkuBoxes: 4, sameSkuUnitsPerBox: 12,
    });
    expect(m.get('PP-B01-N1')?.sameSkuBoxes).toBe(5);
  });

  it('sem produto escolhido, só a ocupação geral', () => {
    const m = occupancyByProduct(placements, null);
    expect(m.get('PP-A01-N1')).toEqual({
      totalBoxes: 7, distinctSkus: 2, sameSkuBoxes: 0, sameSkuUnitsPerBox: null,
    });
  });

  it('vaga sem saldo nenhum não aparece no mapa — e vira EMPTY no consumo', () => {
    const m = occupancyByProduct(placements, 'p1');
    expect(m.has('PP-C01-N1')).toBe(false);
    expect(m.get('PP-C01-N1') ?? EMPTY_OCCUPANCY).toEqual(EMPTY_OCCUPANCY);
  });
});
