// Guardas dos indicadores gerenciais.
//
// Indicador errado é pior que indicador ausente: ninguém confere um número que parece
// plausível. O que mais importa aqui é a separação entre ocupação por ENDEREÇO e
// ocupação por CAPACIDADE, e a recusa em inventar denominador.

import { describe, expect, it } from 'vitest';
import {
  agingRows, boxesByBucket, byBin, byDay, byOperator, capacitySummary,
  movementSummary, occupancySummary, skuFootprint, toCsv, csvOccupancy, csvMovements,
  type AnalyticsMovement,
} from '../pulmaoAnalytics';
import type { StockPlacement } from '../stockInsights';
import type { StorageBin } from '../wmsService';

const AGORA = new Date('2026-10-30T12:00:00Z').getTime();
const diasAtras = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

const vaga = (code: string, over: Partial<StorageBin> = {}): StorageBin => ({
  id: code, code, binType: 'pulmao', capacityBoxes: null, blocked: false, blockedReason: null, ...over,
});

const saldo = (binCode: string, over: Partial<StockPlacement> = {}): StockPlacement => ({
  productId: 'p1', sku: 'SKU-1', productName: 'Capa X', ean: null,
  binId: binCode, binCode, binBlocked: false, binCapacityBoxes: null,
  boxes: 5, unitsPerBox: 10, units: 50, firstStoredAt: diasAtras(3), ...over,
});

const mov = (over: Partial<AnalyticsMovement> = {}): AnalyticsMovement => ({
  id: 'm1', movementType: 'entrada', productId: 'p1', sku: 'SKU-1',
  productName: 'Capa X', fromCode: null, toCode: 'PP-A01-N1', boxes: 5,
  createdAt: diasAtras(1), createdBy: 'u1', operatorName: 'Ana', ...over,
});

describe('ocupação por endereço', () => {
  const bins = [vaga('PP-A01-N1'), vaga('PP-A02-N1'), vaga('PP-A03-N1', { blocked: true }), vaga('PP-A04-N1')];

  it('conta ocupados, livres e bloqueados', () => {
    const r = occupancySummary(bins, [saldo('PP-A01-N1')]);
    expect(r).toEqual({ total: 4, occupied: 1, free: 3, blocked: 1, occupiedRatio: 0.25 });
  });

  // Bloqueio não é ocupação: vaga bloqueada e vazia continua sem mercadoria dentro.
  it('bloqueado vazio continua contando como livre', () => {
    const r = occupancySummary(bins, []);
    expect(r.occupied).toBe(0);
    expect(r.free).toBe(4);
    expect(r.blocked).toBe(1);
  });

  it('sem endereços não divide por zero', () => {
    expect(occupancySummary([], []).occupiedRatio).toBe(0);
  });
});

describe('ocupação por capacidade é outra coisa — e pode não existir', () => {
  // O caso real de hoje: 71 vagas, nenhuma com capacidade declarada.
  it('sem nenhuma capacidade declarada, devolve null em vez de 0% ou 100%', () => {
    expect(capacitySummary([vaga('PP-A01-N1'), vaga('PP-A02-N1')], [saldo('PP-A01-N1')])).toBeNull();
  });

  // O denominador é só das vagas que declararam — somar as outras como zero inventaria
  // um limite, e ignorá-las no numerador mas não no denominador mentiria para baixo.
  it('o denominador é só das vagas que declararam', () => {
    const bins = [vaga('PP-A01-N1', { capacityBoxes: 10 }), vaga('PP-A02-N1')];
    const r = capacitySummary(bins, [saldo('PP-A01-N1', { boxes: 4 }), saldo('PP-A02-N1', { boxes: 99 })]);
    expect(r).toEqual({ declaredBins: 1, totalBoxes: 10, usedBoxes: 4, freeBoxes: 6, usedRatio: 0.4 });
  });

  it('acima da capacidade não devolve disponível negativo', () => {
    const r = capacitySummary([vaga('PP-A01-N1', { capacityBoxes: 5 })], [saldo('PP-A01-N1', { boxes: 8 })]);
    expect(r?.freeBoxes).toBe(0);
  });
});

describe('movimentação', () => {
  const movs = [
    mov({ id: 'a', movementType: 'entrada', boxes: 10 }),
    mov({ id: 'b', movementType: 'saida', boxes: 3, fromCode: 'PP-A01-N1', toCode: null }),
    mov({ id: 'c', movementType: 'transferencia', boxes: 2, fromCode: 'PP-A01-N1', toCode: 'PP-B01-N1' }),
  ];

  it('separa documentos de volume', () => {
    expect(movementSummary(movs)).toEqual({
      entradas: 1, saidas: 1, transferencias: 1, total: 3,
      boxesIn: 10, boxesOut: 3, boxesMoved: 2,
    });
  });

  // Transferência toca dois endereços, e os dois se mexeram.
  it('endereço mais movimentado conta origem E destino', () => {
    const r = byBin(movs);
    expect(r[0]).toMatchObject({ key: 'PP-A01-N1', count: 3 });
    expect(r.find(t => t.key === 'PP-B01-N1')?.count).toBe(1);
  });

  it('agrupa por operador e usa o nome, não o identificador', () => {
    const r = byOperator([
      mov({ createdBy: 'u1', operatorName: 'Ana' }),
      mov({ createdBy: 'u1', operatorName: 'Ana' }),
      mov({ createdBy: 'u2', operatorName: 'Bruno' }),
    ]);
    expect(r[0]).toMatchObject({ label: 'Ana', count: 2 });
    expect(r[1]).toMatchObject({ label: 'Bruno', count: 1 });
  });

  it('autor sem nome visível não vira uuid na tela', () => {
    const r = byOperator([mov({ createdBy: 'u9', operatorName: null })]);
    expect(r[0].label).toBe('—');
    expect(r[0].label).not.toContain('u9');
  });

  // Dia vazio sumindo da série faria a cadência parecer constante.
  it('a série por dia inclui os dias sem movimento', () => {
    const serie = byDay([mov({ createdAt: '2026-10-29T10:00:00Z' })], '2026-10-27T00:00:00Z', '2026-10-30T00:00:00Z');
    expect(serie.map(d => d.count)).toEqual([0, 0, 1, 0]);
    expect(serie).toHaveLength(4);
  });
});

describe('permanência', () => {
  const placements = [
    saldo('PP-A01-N1', { boxes: 10, units: 100, firstStoredAt: diasAtras(40) }),
    saldo('PP-B01-N1', { boxes: 2, units: 20, firstStoredAt: diasAtras(2), productId: 'p2', sku: 'SKU-2' }),
  ];

  it('lista o mais parado primeiro', () => {
    const r = agingRows(placements, AGORA);
    expect(r[0]).toMatchObject({ binCode: 'PP-A01-N1', days: 40, bucket: '30+' });
  });

  // Caixas, não linhas: duas posições de 1 caixa não pesam como uma de 40.
  it('a faixa soma CAIXAS, não contagem de posições', () => {
    expect(boxesByBucket(placements, AGORA)).toEqual({ '0-7': 2, '8-15': 0, '16-30': 0, '30+': 10 });
  });

  it('quem mais ocupa espaço vem primeiro, com o SKU somado entre vagas', () => {
    const r = skuFootprint([
      saldo('PP-A01-N1', { boxes: 4, units: 40 }),
      saldo('PP-B01-N1', { boxes: 6, units: 60 }),
      saldo('PP-C01-N1', { boxes: 3, units: 30, productId: 'p2', sku: 'SKU-2' }),
    ], AGORA);
    expect(r[0]).toMatchObject({ sku: 'SKU-1', boxes: 10, units: 100, bins: 2 });
    expect(r[1]).toMatchObject({ sku: 'SKU-2', boxes: 3, bins: 1 });
  });

  it('o SKU carrega a idade da posição mais antiga', () => {
    const r = skuFootprint([
      saldo('PP-A01-N1', { firstStoredAt: diasAtras(40) }),
      saldo('PP-B01-N1', { firstStoredAt: diasAtras(1) }),
    ], AGORA);
    expect(r[0].oldestDays).toBe(40);
  });
});

describe('pulmão vazio não quebra nada', () => {
  it('todos os indicadores respondem com zero ou null', () => {
    expect(occupancySummary([], [])).toMatchObject({ total: 0, occupied: 0 });
    expect(capacitySummary([], [])).toBeNull();
    expect(movementSummary([]).total).toBe(0);
    expect(byOperator([])).toEqual([]);
    expect(byBin([])).toEqual([]);
    expect(agingRows([], AGORA)).toEqual([]);
    expect(skuFootprint([], AGORA)).toEqual([]);
    expect(boxesByBucket([], AGORA)).toEqual({ '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 });
  });
});

describe('CSV que o Excel brasileiro abre certo', () => {
  // Vírgula como separador quebra o Excel pt-BR, que a usa como decimal.
  it('separa por ponto e vírgula', () => {
    expect(toCsv(['A', 'B'], [[1, 2]])).toBe('A;B\r\n1;2');
  });

  // Sem isso, um nome com `;` desloca todas as colunas seguintes — e ninguém percebe.
  it('escapa ponto e vírgula, aspas e quebra de linha', () => {
    expect(toCsv(['A'], [['x;y']])).toContain('"x;y"');
    expect(toCsv(['A'], [['diz "oi"']])).toContain('"diz ""oi"""');
    expect(toCsv(['A'], [['linha\nquebrada']])).toContain('"linha\nquebrada"');
  });

  it('nulo vira vazio, não "null"', () => {
    expect(toCsv(['A'], [[null]])).toBe('A\r\n');
  });

  it('ocupação exporta todas as vagas, inclusive as vazias', () => {
    const csv = csvOccupancy([vaga('PP-A01-N1'), vaga('PP-A02-N1', { blocked: true })], [saldo('PP-A01-N1')]);
    const linhas = csv.split('\r\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toContain('Ocupado');
    expect(linhas[2]).toContain('Bloqueado');
    expect(linhas[1]).toContain('nao declarada');
  });

  it('movimentos exportam origem e destino separados', () => {
    const csv = csvMovements([mov({ movementType: 'transferencia', fromCode: 'PP-A01-N1', toCode: 'PP-B01-N1' })]);
    expect(csv).toContain('PP-A01-N1;PP-B01-N1');
  });
});
