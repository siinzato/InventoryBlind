// Guardas da consulta por SKU e da antiguidade.
//
// O que importa aqui não é o cálculo de dias — é a honestidade do número. O modelo não
// tem camadas de lote, então a permanência é um TETO depois de certas combinações de
// movimento. Estes testes travam exatamente quando ela deixa de ser exata.

import { describe, expect, it } from 'vitest';
import {
  bucketOf, certaintyOf, countByBucket, daysSince, summarize,
  type PlacementMovement, type StockPlacement,
} from '../stockInsights';

const AGORA = new Date('2026-10-30T12:00:00Z').getTime();
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

const posicao = (over: Partial<StockPlacement> = {}): StockPlacement => ({
  productId: 'p1',
  sku: 'SKU-1',
  productName: 'Capa X',
  ean: null,
  binId: 'b1',
  binCode: 'PP-A01-N1',
  binBlocked: false,
  binCapacityBoxes: null,
  boxes: 10,
  unitsPerBox: 12,
  units: 120,
  firstStoredAt: diasAtras(20),
  ...over,
});

const mov = (over: Partial<PlacementMovement> = {}): PlacementMovement => ({
  productId: 'p1',
  fromBinId: null,
  toBinId: 'b1',
  createdAt: diasAtras(20),
  ...over,
});

describe('faixas de permanência', () => {
  it('as bordas caem na faixa certa', () => {
    expect(bucketOf(0)).toBe('0-7');
    expect(bucketOf(7)).toBe('0-7');
    expect(bucketOf(8)).toBe('8-15');
    expect(bucketOf(15)).toBe('8-15');
    expect(bucketOf(16)).toBe('16-30');
    expect(bucketOf(30)).toBe('16-30');
    expect(bucketOf(31)).toBe('30+');
  });

  it('data futura não vira idade negativa', () => {
    expect(daysSince(new Date(AGORA + 86_400_000).toISOString(), AGORA)).toBe(0);
  });
});

describe('a data é exata ou é um teto?', () => {
  // Uma entrada só: todas as caixas têm a mesma data. Retirar parte não muda a idade
  // do que sobrou.
  it('entrada única com retirada parcial continua EXATA', () => {
    const p = posicao();
    const movimentos = [
      mov({ createdAt: diasAtras(20) }),
      mov({ fromBinId: 'b1', toBinId: null, createdAt: diasAtras(5) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('exata');
  });

  // Nada saiu: a caixa mais antiga tem que estar lá.
  it('duas entradas sem nenhuma saída continua EXATA', () => {
    const p = posicao();
    const movimentos = [
      mov({ createdAt: diasAtras(20) }),
      mov({ createdAt: diasAtras(3) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('exata');
  });

  // O caso que obriga a ressalva: entrou em duas datas e saiu parte. As caixas que
  // ficaram podem ser todas da data nova — ninguém sabe.
  it('duas entradas E uma saída vira LIMITE superior', () => {
    const p = posicao();
    const movimentos = [
      mov({ createdAt: diasAtras(20) }),
      mov({ createdAt: diasAtras(10) }),
      mov({ fromBinId: 'b1', toBinId: null, createdAt: diasAtras(2) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('limite');
  });

  // Retirada que zera apaga a linha e a próxima entrada começa relógio novo, então
  // movimento anterior ao `first_stored_at` é de outra ocupação e não conta.
  it('movimento anterior ao início da ocupação atual é ignorado', () => {
    const p = posicao({ firstStoredAt: diasAtras(5) });
    const movimentos = [
      mov({ createdAt: diasAtras(40) }),
      mov({ fromBinId: 'b1', toBinId: null, createdAt: diasAtras(30) }),
      mov({ createdAt: diasAtras(5) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('exata');
  });

  it('movimento de outro produto no mesmo endereço não contamina', () => {
    const p = posicao();
    const movimentos = [
      mov({ createdAt: diasAtras(20) }),
      mov({ productId: 'p2', createdAt: diasAtras(10) }),
      mov({ productId: 'p2', fromBinId: 'b1', toBinId: null, createdAt: diasAtras(2) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('exata');
  });

  it('movimento de outro endereço do mesmo produto não contamina', () => {
    const p = posicao();
    const movimentos = [
      mov({ createdAt: diasAtras(20) }),
      mov({ toBinId: 'b2', createdAt: diasAtras(10) }),
      mov({ fromBinId: 'b2', toBinId: null, createdAt: diasAtras(2) }),
    ];
    expect(certaintyOf(p, movimentos)).toBe('exata');
  });
});

describe('um SKU em vários endereços', () => {
  const placements = [
    posicao({ binId: 'b1', binCode: 'PP-A01-N1', boxes: 10, unitsPerBox: 12, units: 120, firstStoredAt: diasAtras(40) }),
    posicao({ binId: 'b2', binCode: 'PP-B02-N1', boxes: 3,  unitsPerBox: 6,  units: 18,  firstStoredAt: diasAtras(2) }),
  ];

  it('soma caixas e unidades, e conta endereços', () => {
    const [r] = summarize(placements, [], AGORA);
    expect(r.totalBoxes).toBe(13);
    expect(r.totalUnits).toBe(138);
    expect(r.binCount).toBe(2);
  });

  // "Não somar caixas e unidades como se fossem a mesma medida": com packs diferentes,
  // 13 caixas não é uma medida única, e a tela precisa saber disso.
  it('denuncia pack diferente entre endereços', () => {
    const [r] = summarize(placements, [], AGORA);
    expect(r.packSizes).toEqual([6, 12]);
  });

  it('a idade do SKU é a da posição mais antiga, com a certeza DELA', () => {
    const movimentos = [
      // b1: duas entradas e uma saída -> limite
      mov({ toBinId: 'b1', createdAt: diasAtras(40) }),
      mov({ toBinId: 'b1', createdAt: diasAtras(20) }),
      mov({ fromBinId: 'b1', toBinId: null, createdAt: diasAtras(10) }),
      // b2: entrada única -> exata
      mov({ toBinId: 'b2', createdAt: diasAtras(2) }),
    ];
    const [r] = summarize(placements, movimentos, AGORA);
    expect(r.oldestDays).toBe(40);
    expect(r.bucket).toBe('30+');
    // Não herda a certeza da posição nova e recente.
    expect(r.oldestCertainty).toBe('limite');
  });

  it('posições vêm da mais antiga para a mais nova', () => {
    const [r] = summarize(placements, [], AGORA);
    expect(r.placements.map(p => p.binCode)).toEqual(['PP-A01-N1', 'PP-B02-N1']);
  });

  it('aponta onde o SKU está mais concentrado', () => {
    const [r] = summarize(placements, [], AGORA);
    expect(r.topConcentration?.binCode).toBe('PP-A01-N1');
    expect(r.topConcentration?.share).toBeCloseTo(10 / 13);
  });

  it('a última movimentação vem do histórico, não do saldo', () => {
    const [r] = summarize(placements, [mov({ createdAt: diasAtras(1) })], AGORA);
    expect(r.lastMovementAt).toBe(diasAtras(1));
    expect(summarize(placements, [], AGORA)[0].lastMovementAt).toBeNull();
  });
});

describe('capacidade: só onde foi declarada', () => {
  it('sem capacidade declarada não inventa proporção', () => {
    const [r] = summarize([posicao({ binCapacityBoxes: null })], [], AGORA);
    expect(r.capacityUse).toBeNull();
  });

  it('ignora as vagas sem capacidade ao calcular a proporção', () => {
    const [r] = summarize([
      posicao({ binId: 'b1', binCode: 'PP-A01-N1', boxes: 6, binCapacityBoxes: 10 }),
      posicao({ binId: 'b2', binCode: 'PP-B01-N1', boxes: 9, binCapacityBoxes: null }),
    ], [], AGORA);
    expect(r.capacityUse).toEqual({ declaredBoxes: 10, usedBoxes: 6, ratio: 0.6, bins: 1 });
  });
});

describe('contagem por faixa', () => {
  it('toda faixa aparece, inclusive a vazia', () => {
    const resumos = summarize([
      posicao({ productId: 'p1', sku: 'A', firstStoredAt: diasAtras(1) }),
      posicao({ productId: 'p2', sku: 'B', firstStoredAt: diasAtras(40) }),
    ], [], AGORA);
    expect(countByBucket(resumos)).toEqual({ '0-7': 1, '8-15': 0, '16-30': 0, '30+': 1 });
  });

  it('mais parado primeiro', () => {
    const resumos = summarize([
      posicao({ productId: 'p1', sku: 'NOVO', firstStoredAt: diasAtras(1) }),
      posicao({ productId: 'p2', sku: 'VELHO', firstStoredAt: diasAtras(60) }),
    ], [], AGORA);
    expect(resumos.map(r => r.sku)).toEqual(['VELHO', 'NOVO']);
  });
});
