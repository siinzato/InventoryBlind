// Cadastro de Linhas e Marcas x universo do inventário.
//
// O caso que estes testes travam é o relatado: uma linha criada em Produtos → Linhas e
// Marcas não aparecia em mais lugar nenhum enquanto não tivesse produto, porque o
// universo vinha só dos ITENS do inventário. Aqui a linha vazia passa a existir para as
// telas de listagem — e, principalmente, sem mexer em nenhuma métrica.

import { describe, expect, it } from 'vitest';
import { computeGlobalStats } from '../../blindAIAgentAlgorithm';
import {
  buildCycleLineRows, cycleLinesAsBrandData, withRegisteredTaxonomy,
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

// ---------------------------------------------------------------------------------
// Universo de SELEÇÃO da contagem (`includeParentBrands`). Aqui a pergunta muda: não é
// mais "como cada grupo do inventário vai", e sim "o que existe para eu contar". Toda
// marca ativa precisa ser uma opção — sem que isso some SKU nenhum duas vezes.
// ---------------------------------------------------------------------------------

describe('universo de contagem — cenário A: marca nova, sem produto', () => {
  const NILLKIN: RegisteredBrand = { id: 'nillkin', name: 'Nillkin', active: true };

  it('a marca aparece no seletor com Pendentes: 0', () => {
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(UNIVERSE, [GOCASE, NILLKIN], LINES, { includeParentBrands: true }),
    );
    const marca = rows.find(row => row.label === 'Nillkin');

    expect(marca).toBeDefined();
    expect(marca?.pendingSku).toBe(0);
    expect(marca?.totalSku).toBe(0);
    expect(marca?.concluded).toBe(false);
  });

  it('nenhuma métrica global muda por causa das entidades acrescentadas', () => {
    const antes = computeGlobalStats(cycleLinesAsBrandData(UNIVERSE));
    const depois = computeGlobalStats(cycleLinesAsBrandData(
      withRegisteredTaxonomy(UNIVERSE, [GOCASE, NILLKIN], LINES, { includeParentBrands: true }),
    ));

    expect(depois.totalSku).toBe(antes.totalSku);
    expect(depois.totalDone).toBe(antes.totalDone);
    expect(depois.totalDiv).toBe(antes.totalDiv);
    expect(depois.progresso).toBe(antes.progresso);
    expect(depois.acuracidade).toBe(antes.acuracidade);
  });
});

describe('universo de contagem — cenário B: linha nova, sem produto', () => {
  it('a linha recém-cadastrada já é uma opção, zerada', () => {
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES, { includeParentBrands: true }),
    );
    const copos = rows.find(row => row.label === 'Copos Térmicos');

    expect(copos).toMatchObject({ groupKey: 'copos', lineId: 'copos', totalSku: 0, pendingSku: 0 });
  });
});

describe('universo de contagem — cenários C e D: produtos associados e contagem', () => {
  it('C: associar 3 produtos à linha faz o seletor sair de 0 para 3 pendentes', () => {
    const comProdutos = [...UNIVERSE, summary('copos', 'Copos Térmicos', 3, 0)];
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(comProdutos, [GOCASE], LINES, { includeParentBrands: true }),
    );

    expect(rows.filter(row => row.groupKey === 'copos')).toHaveLength(1);
    expect(rows.find(row => row.groupKey === 'copos')?.pendingSku).toBe(3);
  });

  it('D: contar 1 SKU leva os pendentes de 3 para 2, sem duplicar a entidade', () => {
    const comContagem = [...UNIVERSE, summary('copos', 'Copos Térmicos', 3, 1)];
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(comContagem, [GOCASE], LINES, { includeParentBrands: true }),
    );

    expect(rows.filter(row => row.groupKey === 'copos')).toHaveLength(1);
    expect(rows.find(row => row.groupKey === 'copos')?.pendingSku).toBe(2);
  });
});

describe('universo de contagem — cenário E: marca com linhas, sem dupla contagem', () => {
  it('a marca e as suas linhas coexistem como opções distintas', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES, { includeParentBrands: true });

    expect(rows.some(row => row.groupKey === 'brand:gocase')).toBe(true);
    expect(rows.some(row => row.groupKey === 'capas')).toBe(true);
    expect(rows.some(row => row.groupKey === 'garrafas')).toBe(true);
  });

  it('a marca entra zerada: os SKUs das linhas não são somados de novo nela', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES, { includeParentBrands: true });
    const marca = rows.find(row => row.groupKey === 'brand:gocase');

    expect(marca).toMatchObject({ totalSku: 0, doneSku: 0, divergences: 0, lineId: null });
    // O total do universo continua sendo exatamente o do inventário.
    expect(rows.reduce((acc, row) => acc + row.totalSku, 0)).toBe(349 + 120);
  });

  it('marca que já é grupo real do inventário mantém os números reais — e uma entrada só', () => {
    const comSemLinha = [...UNIVERSE, summary('brand:gocase', 'GoCase', 40, 5)];
    const rows = withRegisteredTaxonomy(comSemLinha, [GOCASE], LINES, { includeParentBrands: true });

    expect(rows.filter(row => row.groupKey === 'brand:gocase')).toHaveLength(1);
    expect(rows.find(row => row.groupKey === 'brand:gocase')?.totalSku).toBe(40);
  });
});

describe('universo de contagem — cenário F: entidades inativas', () => {
  it('marca inativa não vira opção de contagem', () => {
    const arquivada: RegisteredBrand = { id: 'antiga', name: 'Antiga', active: false };
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE, arquivada], LINES, { includeParentBrands: true });

    expect(rows.some(row => row.label === 'Antiga')).toBe(false);
  });

  it('linha inativa não vira opção, mas o histórico dela no ciclo continua visível', () => {
    const inativa = line('descontinuada', 'Descontinuada', false);
    const semHistorico = withRegisteredTaxonomy(UNIVERSE, [GOCASE], [...LINES, inativa], { includeParentBrands: true });
    expect(semHistorico.some(row => row.groupKey === 'descontinuada')).toBe(false);

    const comHistorico = withRegisteredTaxonomy(
      [...UNIVERSE, summary('descontinuada', 'Descontinuada', 12, 12, 1)],
      [GOCASE], [...LINES, inativa], { includeParentBrands: true },
    );
    expect(comHistorico.find(row => row.groupKey === 'descontinuada')).toMatchObject({ totalSku: 12, doneSku: 12 });
  });
});

describe('universo de contagem — identidade por id, nunca por nome', () => {
  it('linhas homônimas de marcas diferentes continuam sendo duas entidades', () => {
    const outra: RegisteredBrand = { id: 'outra', name: 'OutraMarca', active: true };
    const rows = withRegisteredTaxonomy(
      UNIVERSE, [GOCASE, outra],
      [...LINES, line('gocase-essentials', 'Essentials'), line('outra-essentials', 'Essentials', true, 'outra')],
      { includeParentBrands: true },
    );
    const essentials = rows.filter(row => row.label === 'Essentials');

    expect(essentials).toHaveLength(2);
    expect(new Set(essentials.map(row => row.groupKey)).size).toBe(2);
    expect(essentials.map(row => row.brandId).sort()).toEqual(['gocase', 'outra']);
  });
});

describe('universo de contagem — o Ranking não muda de semântica', () => {
  it('sem a opção, marca com linha ativa continua fora — comportamento do Ranking preservado', () => {
    const rows = withRegisteredTaxonomy(UNIVERSE, [GOCASE], LINES);
    expect(rows.some(row => row.groupKey === 'brand:gocase')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------
// Universo reconciliado: zero só pode significar zero de verdade.
//
// O bug corrigido aqui: os produtos ESTAVAM no ciclo, mas com a classificação velha
// (`line_id` nulo). A linha sumia do universo operacional e voltava como entidade
// cadastrada vazia — "Pendentes: 0" em uma linha com produtos. A correção é reconciliar o
// ciclo antes de ler o universo; estes testes travam a consequência: depois de
// reconciliado, o placeholder zerado só sobra para quem realmente não tem produto.
// ---------------------------------------------------------------------------------

/** Itens do ciclo JÁ reconciliados, agrupados como a view agrupa: linha quando existe,
 *  senão a marca. É o contrato que `listLineUniverse` entrega ao App. */
const universoReconciliado = (
  itens: { lineId: string | null; brandId: string; counted: boolean }[],
  rotulos: Record<string, string>,
): CycleLineSummary[] => {
  const por = new Map<string, CycleLineSummary>();
  for (const item of itens) {
    const groupKey = item.lineId ?? `brand:${item.brandId}`;
    const atual = por.get(groupKey) ?? {
      groupKey,
      lineId: item.lineId,
      brandId: item.brandId,
      label: rotulos[groupKey] ?? groupKey,
      totalSku: 0,
      doneSku: 0,
      divergences: 0,
    };
    atual.totalSku += 1;
    if (item.counted) atual.doneSku += 1;
    por.set(groupKey, atual);
  }
  return [...por.values()];
};

const itensDaLinha = (lineId: string, total: number, contados: number, brandId = 'gocase') =>
  Array.from({ length: total }, (_, i) => ({ lineId, brandId, counted: i < contados }));

describe('universo reconciliado — pendências reais', () => {
  it('A: linha com 27 produtos associados e nenhum contado → Pendentes 27', () => {
    const universo = universoReconciliado(itensDaLinha('moove', 27, 0), { moove: 'Moove' });
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(universo, [GOCASE], [line('moove', 'Moove')], { includeParentBrands: true }),
    );
    const moove = rows.find(row => row.groupKey === 'moove');

    expect(moove?.totalSku).toBe(27);
    expect(moove?.pendingSku).toBe(27);
    // E uma entrada só: o cadastro não acrescenta um placeholder por cima.
    expect(rows.filter(row => row.groupKey === 'moove')).toHaveLength(1);
  });

  it('B: 10 dos 27 contados → Pendentes 17', () => {
    const universo = universoReconciliado(itensDaLinha('moove', 27, 10), { moove: 'Moove' });
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy(universo, [GOCASE], [line('moove', 'Moove')], { includeParentBrands: true }),
    );

    expect(rows.find(row => row.groupKey === 'moove')).toMatchObject({ totalSku: 27, doneSku: 10, pendingSku: 17 });
  });

  it('C: linha cadastrada sem nenhum produto → total 0 e Pendentes 0', () => {
    const rows = buildCycleLineRows(
      withRegisteredTaxonomy([], [GOCASE], [line('nova', 'Nova Linha')], { includeParentBrands: true }),
    );

    expect(rows.find(row => row.groupKey === 'nova')).toMatchObject({ totalSku: 0, pendingSku: 0 });
  });

  it('D: marca com 12 produtos sem linha → Pendentes 12 na própria marca', () => {
    const universo = universoReconciliado(
      Array.from({ length: 12 }, () => ({ lineId: null, brandId: 'seanite', counted: false })),
      { 'brand:seanite': 'Seanite' },
    );
    const rows = buildCycleLineRows(withRegisteredTaxonomy(
      universo, [{ id: 'seanite', name: 'Seanite', active: true }], [], { includeParentBrands: true },
    ));

    expect(rows.find(row => row.groupKey === 'brand:seanite')).toMatchObject({ totalSku: 12, pendingSku: 12 });
  });

  it('E: marca com duas linhas — 10 + 20 = 30 no total, nunca 60', () => {
    const universo = universoReconciliado(
      [...itensDaLinha('copos', 10, 0), ...itensDaLinha('garrafas', 20, 0)],
      { copos: 'Copos', garrafas: 'Garrafas' },
    );
    const rows = buildCycleLineRows(withRegisteredTaxonomy(
      universo, [GOCASE], [line('copos', 'Copos'), line('garrafas', 'Garrafas')], { includeParentBrands: true },
    ));

    expect(rows.find(row => row.groupKey === 'copos')?.pendingSku).toBe(10);
    expect(rows.find(row => row.groupKey === 'garrafas')?.pendingSku).toBe(20);
    // A marca-pai existe como opção, mas sem produto solto ela é zero — e o total do
    // universo continua 30. Somar as linhas na marca daria 60.
    expect(rows.find(row => row.groupKey === 'brand:gocase')).toMatchObject({ totalSku: 0, pendingSku: 0 });
    expect(rows.reduce((acc, row) => acc + row.totalSku, 0)).toBe(30);
  });

  it('F: reclassificar 50 produtos para uma linha nova leva o total inteiro junto', () => {
    const antes = universoReconciliado(itensDaLinha('antiga', 50, 0), { antiga: 'Antiga' });
    const depois = universoReconciliado(itensDaLinha('nova', 50, 0), { nova: 'Nova Linha' });
    const cadastro = [line('antiga', 'Antiga'), line('nova', 'Nova Linha')];

    expect(buildCycleLineRows(withRegisteredTaxonomy(antes, [GOCASE], cadastro, { includeParentBrands: true }))
      .find(row => row.groupKey === 'nova')?.pendingSku).toBe(0);
    // Depois da reconciliação o grupo novo recebe o total real — nunca 0.
    expect(buildCycleLineRows(withRegisteredTaxonomy(depois, [GOCASE], cadastro, { includeParentBrands: true }))
      .find(row => row.groupKey === 'nova')?.pendingSku).toBe(50);
  });

  it('H: contagem já feita continua contabilizada depois de acrescentar o cadastro', () => {
    const universo = universoReconciliado(itensDaLinha('moove', 27, 10), { moove: 'Moove' });
    const semCadastro = buildCycleLineRows(universo);
    const comCadastro = buildCycleLineRows(withRegisteredTaxonomy(
      universo, [GOCASE], [line('moove', 'Moove'), line('nova', 'Nova Linha')], { includeParentBrands: true },
    ));

    expect(comCadastro.find(row => row.groupKey === 'moove')?.doneSku)
      .toBe(semCadastro.find(row => row.groupKey === 'moove')?.doneSku);
    expect(comCadastro.find(row => row.groupKey === 'moove')?.doneSku).toBe(10);
  });

  it('zero é sempre verificável: ou não há SKU, ou tudo já foi contado', () => {
    const universo = universoReconciliado(
      [...itensDaLinha('moove', 27, 27), ...itensDaLinha('copos', 10, 3)],
      { moove: 'Moove', copos: 'Copos' },
    );
    const rows = buildCycleLineRows(withRegisteredTaxonomy(
      universo, [GOCASE], [line('moove', 'Moove'), line('copos', 'Copos'), line('vazia', 'Vazia')],
      { includeParentBrands: true },
    ));

    for (const row of rows.filter(r => r.pendingSku === 0)) {
      expect(row.totalSku === 0 || row.doneSku >= row.totalSku).toBe(true);
    }
    expect(rows.find(row => row.groupKey === 'moove')?.pendingSku).toBe(0);
    expect(rows.find(row => row.groupKey === 'vazia')?.totalSku).toBe(0);
    expect(rows.find(row => row.groupKey === 'copos')?.pendingSku).toBe(7);
  });
});
