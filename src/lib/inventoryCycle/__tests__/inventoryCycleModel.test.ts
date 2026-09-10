// Inventário por SKU: a linha é agrupamento, não um total digitado.
//
// O que estes testes travam é justamente o que o modelo agregado não conseguia garantir:
// Outlet e PET separados porque são linhas diferentes, linha nova aparecendo sozinha,
// marca sem linha agrupando pela marca, e a MESMA fórmula de acuracidade do modelo antigo.

import { describe, expect, it } from 'vitest';
import { computeAccuracy, computeGlobalStats } from '../../blindAIAgentAlgorithm';
import {
  buildCycleLineRows, cycleLinesAsBrandData, cycleTotals, filterItems, groupKeyOf, groupLabelOf,
  itemHasDivergence, lineProgress, mergeCurrentCycleCounts, CURRENT_CYCLE_CARRIES,
  EMPTY_ITEM_FILTERS, UNCLASSIFIED_LABEL,
  type CycleLineSummary, type InventoryItem,
} from '../inventoryCycleModel';

const summary = (
  groupKey: string, label: string, totalSku: number, doneSku: number, divergences = 0,
  lineId: string | null = groupKey.startsWith('brand:') ? null : groupKey,
  brandId: string | null = groupKey.startsWith('brand:') ? groupKey.slice(6) : 'gocase',
): CycleLineSummary => ({ groupKey, lineId, brandId, label, totalSku, doneSku, divergences });

// Espelha o cenário real: Outlet e Linha PET são LINHAS distintas do catálogo, o que o
// agrupamento de contagem antigo ("Linha de Outlet e PET", 402 SKUs) não conseguia separar.
const LINES: CycleLineSummary[] = [
  summary('outlet', 'Outlet', 349, 100, 10),
  summary('pet', 'Linha PET', 24, 24, 0),
  summary('capas', 'Capas', 673, 0, 0),
  summary('ventosa', 'Ventosa', 5, 5, 1),
  summary('brand:ringke', 'Ringke', 491, 0, 0),
];

const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i1', cycleId: 'c1', productId: 'p1', sku: 'SKU-1', productName: 'Produto', location: null,
  brandId: 'gocase', brandName: 'GoCase', lineId: 'outlet', lineName: 'Outlet',
  status: 'pending', expectedQuantity: 10, countedQuantity: null, countedAt: null,
  countedByName: null, observation: null, divergence: false, ...over,
});

describe('agrupamento por linha', () => {
  it('Outlet e Linha PET são linhas separadas, nunca um grupo combinado', () => {
    const rows = buildCycleLineRows(LINES);
    const labels = rows.map(r => r.label);
    expect(labels).toContain('Outlet');
    expect(labels).toContain('Linha PET');
    expect(labels.some(l => /outlet e pet/i.test(l))).toBe(false);

    const outlet = rows.find(r => r.label === 'Outlet')!;
    const pet = rows.find(r => r.label === 'Linha PET')!;
    expect(outlet.totalSku).toBe(349);
    expect(pet.totalSku).toBe(24);
  });

  it('qualquer linha com itens aparece, sem lista fixa no código', () => {
    // Ventosa, Malas, Tampa de Garrafa: linhas que não existem na taxonomia de contagem.
    const rows = buildCycleLineRows([
      ...LINES,
      summary('malas', 'Malas', 19, 0),
      summary('tampas', 'Tampa de Garrafa', 11, 11),
    ]);
    expect(rows.map(r => r.label)).toEqual(expect.arrayContaining(['Ventosa', 'Malas', 'Tampa de Garrafa']));
    expect(rows).toHaveLength(7);
  });

  it('marca sem linhas cadastradas agrupa pela própria marca', () => {
    const ringke = buildCycleLineRows(LINES).find(r => r.label === 'Ringke')!;
    expect(ringke.lineId).toBeNull();
    expect(ringke.brandId).toBe('ringke');
  });

  it('pendentes, progresso e conclusão são derivados do total e dos contados', () => {
    const rows = buildCycleLineRows(LINES);
    const outlet = rows.find(r => r.label === 'Outlet')!;
    expect(outlet.pendingSku).toBe(249);
    expect(outlet.progress).toBeCloseTo((100 / 349) * 100, 6);
    expect(outlet.concluded).toBe(false);

    const pet = rows.find(r => r.label === 'Linha PET')!;
    expect(pet.pendingSku).toBe(0);
    expect(pet.concluded).toBe(true);
  });

  it('ordena por volume e, no empate, por rótulo — sempre igual', () => {
    const rows = buildCycleLineRows([summary('b', 'Bases', 10, 0), summary('a', 'Alfa', 10, 0), summary('c', 'Capas', 90, 0)]);
    expect(rows.map(r => r.label)).toEqual(['Capas', 'Alfa', 'Bases']);
    expect(buildCycleLineRows(LINES)).toEqual(buildCycleLineRows(LINES));
  });

  it('linha sem item nenhum não gera divisão por zero', () => {
    const [row] = buildCycleLineRows([summary('vazia', 'Vazia', 0, 0)]);
    expect(row.progress).toBe(0);
    expect(row.accuracy).toBeNull();
    expect(row.concluded).toBe(false);
    expect(lineProgress(0, 0)).toBe(0);
  });
});

describe('acuracidade: a fórmula não muda nesta tarefa', () => {
  it('cada linha usa exatamente computeAccuracy(contados, divergências)', () => {
    for (const s of LINES) {
      const row = buildCycleLineRows([s])[0];
      expect(row.accuracy).toBe(computeAccuracy(s.doneSku, s.divergences));
    }
  });

  it('linha sem nada contado tem acuracidade indefinida, não 0%', () => {
    expect(buildCycleLineRows([summary('capas', 'Capas', 673, 0)])[0].accuracy).toBeNull();
  });

  it('o total do ciclo soma os itens e usa a mesma fórmula', () => {
    const totals = cycleTotals(LINES);
    expect(totals.totalSku).toBe(349 + 24 + 673 + 5 + 491);
    expect(totals.doneSku).toBe(129);
    expect(totals.pendingSku).toBe(totals.totalSku - 129);
    expect(totals.divergences).toBe(11);
    expect(totals.accuracy).toBe(computeAccuracy(129, 11));
    expect(totals.lines).toBe(5);
  });
});

describe('ponte com o Dashboard', () => {
  it('as linhas alimentam computeGlobalStats sem fórmula duplicada', () => {
    const stats = computeGlobalStats(cycleLinesAsBrandData(LINES));
    const totals = cycleTotals(LINES);

    expect(stats.totalSku).toBe(totals.totalSku);
    expect(stats.totalDone).toBe(totals.doneSku);
    expect(stats.totalDiv).toBe(totals.divergences);
    expect(stats.acuracidade).toBe(totals.accuracy);
    // O rótulo que aparece no Dashboard é o nome da linha atual, não da linha de contagem.
    expect(stats.tabela.map(r => r.brand)).toContain('Outlet');
    expect(stats.tabela.map(r => r.brand)).toContain('Linha PET');
  });

  it('a linha do Dashboard é identificada pela chave de agrupamento, não por índice', () => {
    const rows = cycleLinesAsBrandData(LINES);
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    expect(rows.find(r => r.brand === 'Ringke')!.id).toBe('brand:ringke');
  });
});

describe('item: divergência e agrupamento', () => {
  it('divergência exige item contado, saldo esperado e quantidade diferente', () => {
    expect(itemHasDivergence(item({ status: 'pending', countedQuantity: null }))).toBe(false);
    expect(itemHasDivergence(item({ status: 'counted', countedQuantity: 10 }))).toBe(false);
    expect(itemHasDivergence(item({ status: 'counted', countedQuantity: 7 }))).toBe(true);
    // Produto sem saldo conhecido não vira divergência automática.
    expect(itemHasDivergence(item({ status: 'counted', expectedQuantity: null, countedQuantity: 7 }))).toBe(false);
  });

  it('a chave de agrupamento do item é a mesma da view: linha, senão marca, senão sem classificação', () => {
    expect(groupKeyOf(item())).toBe('outlet');
    expect(groupKeyOf(item({ lineId: null }))).toBe('brand:gocase');
    expect(groupKeyOf(item({ lineId: null, brandId: null }))).toBe('sem-classificacao');
    expect(groupLabelOf(item({ lineName: null }))).toBe('GoCase');
    expect(groupLabelOf(item({ lineName: null, brandName: null }))).toBe(UNCLASSIFIED_LABEL);
  });
});

describe('filtro da lista de contagem', () => {
  const items: InventoryItem[] = [
    item({ id: 'a', sku: 'OUT-1', productName: 'Outlet Necessaire', status: 'pending' }),
    item({ id: 'b', sku: 'OUT-2', productName: 'Outlet Tote', status: 'counted', countedQuantity: 10 }),
    item({ id: 'c', sku: 'PUF-1', productName: 'Capa Puffer', lineId: 'puffer', lineName: 'Puffer', status: 'counted', countedQuantity: 3, divergence: true }),
  ];

  it('sem filtro devolve tudo e não muta a entrada', () => {
    const before = [...items];
    expect(filterItems(items, EMPTY_ITEM_FILTERS)).toHaveLength(3);
    expect(items).toEqual(before);
  });

  it('filtra por linha, por situação e por busca', () => {
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, group: 'puffer' }).map(i => i.id)).toEqual(['c']);
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, status: 'pending' }).map(i => i.id)).toEqual(['a']);
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, status: 'counted' }).map(i => i.id)).toEqual(['b', 'c']);
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, status: 'divergent' }).map(i => i.id)).toEqual(['c']);
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, search: 'puf' }).map(i => i.id)).toEqual(['c']);
    expect(filterItems(items, { ...EMPTY_ITEM_FILTERS, search: 'OUT-2' }).map(i => i.id)).toEqual(['b']);
  });
});

// Recuperação do ciclo em andamento: o trabalho concluído antes da reorganização do
// catálogo continua valendo, e o catálogo novo só acrescenta pendências.
describe('ciclo atual: trabalho concluído + SKUs novos', () => {
  // Números reais do ciclo em andamento.
  const COUNTING_LINES = [
    { brand: 'Nillkin', done_sku: 195, divergences: 110 },
    { brand: 'Térmicos GC', done_sku: 97, divergences: 41 },
    { brand: 'Linha Joy GC', done_sku: 6, divergences: 2 },
    { brand: 'Linha Tote Moon GC', done_sku: 2, divergences: 0 },
    { brand: 'Linha de Outlet e PET', done_sku: 24, divergences: 7 },
    { brand: 'Linha Puffer GC', done_sku: 0, divergences: 0 },
  ];
  const UNIVERSE: CycleLineSummary[] = [
    summary('brand:nillkin', 'Nillkin', 833, 0),
    summary('termicos', 'Térmicos', 9, 0),
    summary('garrafas', 'Garrafas Térmicas', 273, 0),
    summary('copos', 'Copos Térmicos', 53, 0),
    summary('joy', 'Joy', 21, 0),
    summary('tote', 'Tote', 31, 0),
    summary('outlet', 'Outlet', 349, 0),
    summary('pet', 'Linha PET', 24, 0),
    summary('puffer', 'Puffer', 18, 0),
  ];

  const merged = mergeCurrentCycleCounts(UNIVERSE, COUNTING_LINES);
  const line = (label: string) => merged.lines.find(l => l.label === label)!;

  it('linha concluída não é zerada porque o catálogo cresceu', () => {
    expect(line('Nillkin').doneSku).toBe(195);
    expect(line('Nillkin').divergences).toBe(110);
    expect(line('Joy').doneSku).toBe(6);
    expect(line('Tote').doneSku).toBe(2);
  });

  it('o total é o universo atual, então SKU novo entra como pendente', () => {
    const rows = buildCycleLineRows(merged.lines);
    const nillkin = rows.find(r => r.label === 'Nillkin')!;
    expect(nillkin.totalSku).toBe(833);
    expect(nillkin.pendingSku).toBe(638);
    expect(nillkin.progress).toBeCloseTo((195 / 833) * 100, 6);
    // Estava 195/195; com produto novo na linha, não pode seguir dizendo "concluído".
    expect(nillkin.concluded).toBe(false);
  });

  it('nenhum produto novo herda contagem: contados nunca passam do universo', () => {
    const apertado = mergeCurrentCycleCounts(
      [summary('joy', 'Joy', 4, 0)],
      [{ brand: 'Linha Joy GC', done_sku: 6, divergences: 2 }],
    );
    expect(apertado.lines[0].doneSku).toBe(4);
    expect(apertado.lines[0].divergences).toBeLessThanOrEqual(4);
  });

  it('Outlet e Linha PET voltam pendentes, separadas, sem dividir a contagem antiga', () => {
    expect(line('Outlet').doneSku).toBe(0);
    expect(line('Linha PET').doneSku).toBe(0);
    expect(line('Outlet').totalSku).toBe(349);
    expect(line('Linha PET').totalSku).toBe(24);
    expect(merged.lines.some(l => /outlet e pet/i.test(l.label))).toBe(false);
    // O agregado de 24 contados não vira contagem de ninguém.
    expect(merged.carried.some(c => c.doneSku === 24)).toBe(false);
  });

  // Correção da família térmica: a contagem de `Térmicos GC` foi feita com garrafas, copos
  // e taças no mesmo grupo, então ela não vira progresso de nenhuma das linhas novas.
  it('a família térmica recomeça do zero, sem redistribuir a contagem antiga', () => {
    for (const label of ['Térmicos', 'Garrafas Térmicas', 'Copos Térmicos']) {
      expect(line(label).doneSku).toBe(0);
      expect(line(label).divergences).toBe(0);
    }
    expect(line('Térmicos').totalSku).toBe(9);
    expect(line('Garrafas Térmicas').totalSku).toBe(273);
    expect(line('Copos Térmicos').totalSku).toBe(53);
    // Os 97 contados não são divididos entre as linhas novas nem mantidos em Térmicos.
    expect(merged.carried.some(c => c.doneSku === 97)).toBe(false);
  });

  it('linha de contagem sem correspondência declarada não transporta nada', () => {
    expect(line('Puffer').doneSku).toBe(0);
    expect(merged.unresolved).toEqual([]);
  });

  it('acuracidade sai da fórmula de sempre, sobre os contados reais', () => {
    const rows = buildCycleLineRows(merged.lines);
    for (const row of rows) {
      expect(row.accuracy).toBe(computeAccuracy(row.doneSku, row.divergences));
    }
    // Linha só com pendências não recebe acuracidade fictícia.
    expect(rows.find(r => r.label === 'Outlet')!.accuracy).toBeNull();
  });

  it('o total do Dashboard é um só: universo do catálogo, contados do ciclo', () => {
    const stats = computeGlobalStats(cycleLinesAsBrandData(merged.lines));
    expect(stats.totalSku).toBe(833 + 9 + 273 + 53 + 21 + 31 + 349 + 24 + 18);
    expect(stats.totalDone).toBe(195 + 6 + 2);
    expect(stats.totalDiv).toBe(110 + 2 + 0);
    expect(stats.acuracidade).toBe(computeAccuracy(203, 112));
  });

  it('correspondência que não casa dos dois lados é reportada, não adivinhada', () => {
    const semPar = mergeCurrentCycleCounts(
      [summary('joy', 'Joy', 21, 0)],
      [{ brand: 'Linha Joy GC', done_sku: 6, divergences: 2 }],
      [{ countingLine: 'Linha Joy GC', group: 'Linha Que Nao Existe' }],
    );
    expect(semPar.unresolved).toEqual(['Linha Joy GC']);
    expect(semPar.lines[0].doneSku).toBe(0);
  });

  it('rótulo ambíguo no catálogo bloqueia o transporte', () => {
    const ambiguo = mergeCurrentCycleCounts(
      [summary('joy-linha', 'Joy', 21, 0), summary('brand:joy', 'Joy', 5, 0)],
      [{ brand: 'Linha Joy GC', done_sku: 6, divergences: 2 }],
    );
    expect(ambiguo.unresolved).toContain('Linha Joy GC');
    expect(ambiguo.lines.every(l => l.doneSku === 0)).toBe(true);
  });

  it('não muta o universo recebido', () => {
    const antes = JSON.parse(JSON.stringify(UNIVERSE));
    mergeCurrentCycleCounts(UNIVERSE, COUNTING_LINES);
    expect(UNIVERSE).toEqual(antes);
  });

  it('as correspondências declaradas são só as diretas, e Outlet/PET não está entre elas', () => {
    expect(CURRENT_CYCLE_CARRIES.map(c => c.countingLine)).toEqual([
      'Nillkin', 'Linha Joy GC', 'Linha Tote Moon GC',
    ]);
    expect(CURRENT_CYCLE_CARRIES.some(c => /outlet|pet/i.test(c.countingLine))).toBe(false);
  });
});
