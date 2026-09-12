// Cadastro de Linhas e Marcas x universo do inventário.
//
// O caso que estes testes travam é o relatado: uma linha criada em Produtos → Linhas e
// Marcas não aparecia em mais lugar nenhum enquanto não tivesse produto, porque o
// universo vinha só dos ITENS do inventário. Aqui a linha vazia passa a existir para as
// telas de listagem — e, principalmente, sem mexer em nenhuma métrica.

import { describe, expect, it } from 'vitest';
import { computeGlobalStats } from '../../blindAIAgentAlgorithm';
import {
  cycleLinesAsBrandData, withRegisteredTaxonomy,
  type CycleLineSummary, type RegisteredBrand, type RegisteredLine,
} from '../inventoryCycleModel';

const GOCASE: RegisteredBrand = { id: 'gocase', name: 'GoCase', active: true };

const line = (id: string, name: string, active = true, brandId = 'gocase'): RegisteredLine =>
  ({ id, brandId, name, active });

const summary = (
  groupKey: string, label: string, totalSku: number, doneSku: number, divergences = 0,
): CycleLineSummary => ({
  groupKey,
  lineId: groupKey.startsWith('brand:') ? null : groupKey,
  brandId: groupKey.startsWith('brand:') ? groupKey.slice(6) : 'gocase',
  label,
  totalSku,
  doneSku,
  divergences,
});

// Universo do inventário ativo: duas linhas com produto, uma delas já contada.
const UNIVERSE: CycleLineSummary[] = [
  summary('capas', 'Capas', 349, 100, 10),
  summary('garrafas', 'Garrafas Térmicas', 120, 120, 4),
];

const LINES: RegisteredLine[] = [
  line('capas', 'Capas'),
  line('garrafas', 'Garrafas Térmicas'),
  line('copos', 'Copos Térmicos'),
];

describe('withRegisteredTaxonomy — cenário A: linha criada sem nenhum produto', () => {
  it('a linha nova passa a existir no universo, com estado vazio', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES);
    const copos = rows.find(row => row.label === 'Copos Térmicos');

    expect(copos).toBeDefined();
    expect(copos).toMatchObject({ groupKey: 'copos', lineId: 'copos', brandId: 'gocase', totalSku: 0, doneSku: 0, divergences: 0 });
  });

  it('a linha vazia não altera nenhuma métrica global', () => {
    const antes = computeGlobalStats(cycleLinesAsBrandData(UNIVERSE));
    const depois = computeGlobalStats(cycleLinesAsBrandData(withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES)));

    expect(depois.totalSku).toBe(antes.totalSku);
    expect(depois.totalDone).toBe(antes.totalDone);
    expect(depois.totalDiv).toBe(antes.totalDiv);
    expect(depois.progresso).toBe(antes.progresso);
    expect(depois.acuracidade).toBe(antes.acuracidade);
  });

  it('a linha vazia não entra em melhores nem piores — sem amostra, sem acuracidade', () => {
    const stats = computeGlobalStats(cycleLinesAsBrandData(withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES)));
    const copos = stats.tabela.find(row => row.brand === 'Copos Térmicos');

    expect(copos?.accuracy).toBeNull();
    expect(copos?.progress).toBe(0);
    expect(stats.melhores.some(entry => entry.nome === 'Copos Térmicos')).toBe(false);
    expect(stats.piores.some(entry => entry.nome === 'Copos Térmicos')).toBe(false);
  });
});

describe('withRegisteredTaxonomy — cenário B: produtos associados à linha', () => {
  it('com produto no inventário, os números reais vencem — nada é somado por cima', () => {
    const comProdutos = [...UNIVERSE, summary('copos', 'Copos Térmicos', 3, 0)];
    const rows = withRegisteredTaxonomy(comProdutos, [GOCASE], LINES);

    expect(rows.filter(row => row.lineId === 'copos')).toHaveLength(1);
    expect(rows.find(row => row.lineId === 'copos')?.totalSku).toBe(3);
  });

  it('cenário C: 1 de 3 contados vira progresso real da linha', () => {
    const comContagem = [...UNIVERSE, summary('copos', 'Copos Térmicos', 3, 1)];
    const stats = computeGlobalStats(cycleLinesAsBrandData(withRegisteredTaxonomy(comContagem, [GOCASE], LINES)));
    const copos = stats.tabela.find(row => row.brand === 'Copos Térmicos');

    expect(copos?.totalSku).toBe(3);
    expect(copos?.doneSku).toBe(1);
    expect(copos?.progress).toBeCloseTo(100 / 3, 5);
  });
});

describe('withRegisteredTaxonomy — marcas', () => {
  it('marca sem nenhuma linha ativa entra pela própria marca, na convenção da view', () => {
    const nova: RegisteredBrand = { id: 'nillkin', name: 'Nillkin', active: true };
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE, nova], LINES);

    expect(rows.find(row => row.label === 'Nillkin')).toMatchObject({ groupKey: 'brand:nillkin', lineId: null, brandId: 'nillkin', totalSku: 0 });
  });

  it('marca que já tem linha ativa não aparece duplicada como marca', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES);
    expect(rows.some(row => row.groupKey === 'brand:gocase')).toBe(false);
  });
});

describe('withRegisteredTaxonomy — desativação e idempotência', () => {
  it('linha inativa não é acrescentada ao universo', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], [...LINES, line('descontinuada', 'Descontinuada', false)]);
    expect(rows.some(row => row.label === 'Descontinuada')).toBe(false);
  });

  it('linha inativa que ainda tem histórico no inventário continua visível, com seus números', () => {
    const comHistorico = [...UNIVERSE, summary('descontinuada', 'Descontinuada', 12, 12, 1)];
    const rows = withRegisteredTaxonomy(comHistorico, [GOCASE], [...LINES, line('descontinuada', 'Descontinuada', false)]);
    const row = rows.find(entry => entry.groupKey === 'descontinuada');

    expect(row).toMatchObject({ totalSku: 12, doneSku: 12, divergences: 1 });
  });

  it('aplicar duas vezes não duplica entidade nenhuma', () => {
    const uma = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES);
    const duas = withRegisteredTaxonomy(uma, [GOCASE], LINES);

    expect(duas).toHaveLength(uma.length);
    expect(new Set(duas.map(row => row.groupKey)).size).toBe(duas.length);
  });

  it('não muta o universo recebido', () => {
    const original = [...UNIVERSE];
    withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES);
    expect(UNIVERSE).toEqual(original);
  });
});
