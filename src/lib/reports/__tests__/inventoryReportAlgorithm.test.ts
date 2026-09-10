import { describe, it, expect } from 'vitest';
import {
  applySourceBalancesToRows,
  buildReportRows,
  compareLocations,
  countLocations,
  distinctLocations,
  formatBalanceCell,
  formatEanCell,
  formatLocationCell,
  paginateReportRows,
  selectByBrandsAndLines,
  selectByLocationRange,
  truncateProductName,
} from '../inventoryReportAlgorithm';
import type { InventoryReportRow, ReportProduct } from '../inventoryReportTypes';

function product(partial: Partial<ReportProduct> & { id: string }): ReportProduct {
  return {
    name: `Produto ${partial.id}`,
    sku: `SKU-${partial.id}`,
    ean: null,
    location: null,
    brandId: null,
    lineId: null,
    ...partial,
  };
}

function row(partial: Partial<InventoryReportRow> & { productId: string }): InventoryReportRow {
  return {
    name: `Produto ${partial.productId}`,
    sku: `SKU-${partial.productId}`,
    ean: null,
    location: null,
    balance: null,
    balanceStatus: 'blank',
    groupLabel: null,
    ...partial,
  };
}

describe('compareLocations — ordenação natural de endereços', () => {
  it('ordena o bloco numérico como número, não como texto', () => {
    const sorted = ['P1-A10-A', 'P1-A2-A', 'P1-A1-A'].sort(compareLocations);
    expect(sorted).toEqual(['P1-A1-A', 'P1-A2-A', 'P1-A10-A']);
  });

  it('trata zeros à esquerda como o mesmo número', () => {
    expect(compareLocations('P1-A002-A', 'P1-A2-A')).toBeGreaterThan(0);
    expect(compareLocations('P1-A002-A', 'P1-A003-A')).toBeLessThan(0);
  });

  it('ignora caixa e espaço em volta', () => {
    expect(compareLocations('p1-h003-b', 'P1-H003-B')).toBe(0);
  });
});

describe('selectByLocationRange — faixa inclusiva', () => {
  const products = [
    product({ id: '1', location: 'P1-A002-A' }),
    product({ id: '2', location: 'P1-A002-C' }),
    product({ id: '3', location: 'P1-A002-P' }),
    product({ id: '4', location: 'P1-A002-Q' }),
    product({ id: '5', location: 'P1-A001-Z' }),
    product({ id: '6', location: null }),
  ];

  it('inclui o endereço inicial e o final (P1-A002-A até P1-A002-P)', () => {
    const selected = selectByLocationRange(products, 'P1-A002-A', 'P1-A002-P');
    expect(selected.map(p => p.id)).toEqual(['1', '2', '3']);
  });

  it('não inclui endereço fora da faixa em nenhuma das pontas', () => {
    const ids = selectByLocationRange(products, 'P1-A002-A', 'P1-A002-P').map(p => p.id);
    expect(ids).not.toContain('4');
    expect(ids).not.toContain('5');
  });

  it('nunca inclui produto sem endereço', () => {
    const selected = selectByLocationRange(products, 'P1-A001-A', 'P1-Z999-Z');
    expect(selected.map(p => p.id)).not.toContain('6');
  });

  it('funciona com os campos invertidos (usuário troca início e fim)', () => {
    const direct = selectByLocationRange(products, 'P1-A002-A', 'P1-A002-P').map(p => p.id);
    const inverted = selectByLocationRange(products, 'P1-A002-P', 'P1-A002-A').map(p => p.id);
    expect(inverted).toEqual(direct);
  });

  it('faixa de um único endereço devolve só ele', () => {
    expect(selectByLocationRange(products, 'P1-A002-C', 'P1-A002-C').map(p => p.id)).toEqual(['2']);
  });
});

describe('distinctLocations', () => {
  it('devolve endereços únicos em ordem natural, sem os vazios', () => {
    const locations = distinctLocations([
      product({ id: '1', location: 'P1-A10-A' }),
      product({ id: '2', location: 'P1-A2-A' }),
      product({ id: '3', location: 'p1-a2-a' }),
      product({ id: '4', location: '   ' }),
      product({ id: '5', location: null }),
    ]);
    expect(locations).toEqual(['P1-A2-A', 'P1-A10-A']);
  });
});

describe('selectByBrandsAndLines', () => {
  const products = [
    product({ id: '1', brandId: 'b1', lineId: 'l1' }),
    product({ id: '2', brandId: 'b1', lineId: null }),
    product({ id: '3', brandId: 'b2', lineId: 'l2' }),
    product({ id: '4', brandId: null, lineId: null, location: null }),
  ];

  it('seleciona por marca', () => {
    expect(selectByBrandsAndLines(products, ['b1'], []).map(p => p.id)).toEqual(['1', '2']);
  });

  it('seleciona por linha', () => {
    expect(selectByBrandsAndLines(products, [], ['l2']).map(p => p.id)).toEqual(['3']);
  });

  it('aceita várias marcas/linhas ao mesmo tempo', () => {
    expect(selectByBrandsAndLines(products, ['b2'], ['l1']).map(p => p.id)).toEqual(['1', '3']);
  });

  it('sem nada selecionado não devolve produto nenhum', () => {
    expect(selectByBrandsAndLines(products, [], [])).toEqual([]);
  });
});

describe('buildReportRows', () => {
  it('ordena por local natural e, dentro do local, por produto', () => {
    const rows = buildReportRows(
      [
        product({ id: '1', name: 'Zebra', location: 'P1-A10-A' }),
        product({ id: '2', name: 'Bolsa', location: 'P1-A2-A' }),
        product({ id: '3', name: 'Abacaxi', location: 'P1-A10-A' }),
      ],
      { mode: 'location' }
    );
    expect(rows.map(r => r.name)).toEqual(['Bolsa', 'Abacaxi', 'Zebra']);
  });

  it('joga produto sem endereço para o fim, sem descartá-lo', () => {
    const rows = buildReportRows(
      [product({ id: '1', location: null }), product({ id: '2', location: 'P1-A1-A' })],
      { mode: 'manual' }
    );
    expect(rows.map(r => r.productId)).toEqual(['2', '1']);
    expect(rows[1].location).toBeNull();
  });

  it('EAN vazio vira null, e o saldo nasce em branco', () => {
    const [only] = buildReportRows([product({ id: '1', ean: '   ' })], { mode: 'manual' });
    expect(only.ean).toBeNull();
    expect(only.balance).toBeNull();
    expect(only.balanceStatus).toBe('blank');
  });

  it('no modo por marca agrupa por linha/marca antes do local', () => {
    const rows = buildReportRows(
      [
        product({ id: '1', lineId: 'l2', location: 'P1-A1-A' }),
        product({ id: '2', lineId: 'l1', location: 'P1-A9-A' }),
        product({ id: '3', lineId: 'l1', location: 'P1-A2-A' }),
      ],
      { mode: 'brand', groupLabelFor: p => (p.lineId === 'l1' ? 'Fitness' : 'Tote') }
    );
    expect(rows.map(r => `${r.groupLabel}/${r.location}`)).toEqual([
      'Fitness/P1-A2-A',
      'Fitness/P1-A9-A',
      'Tote/P1-A1-A',
    ]);
  });
});

describe('células da folha', () => {
  it('EAN ausente vira "-" e endereço ausente vira "Sem endereço"', () => {
    expect(formatEanCell(null)).toBe('-');
    expect(formatEanCell('  ')).toBe('-');
    expect(formatEanCell('7900464109147')).toBe('7900464109147');
    expect(formatLocationCell(null)).toBe('Sem endereço');
  });

  it('saldo zero imprime "0" e saldo ausente imprime vazio', () => {
    expect(formatBalanceCell(row({ productId: '1', balance: '0', balanceStatus: 'matched' }))).toBe('0');
    expect(formatBalanceCell(row({ productId: '2', balance: null, balanceStatus: 'not-found' }))).toBe('');
    expect(formatBalanceCell(row({ productId: '3', balance: null, balanceStatus: 'blank' }))).toBe('');
  });

  it('saldo negativo é preservado como veio', () => {
    expect(formatBalanceCell(row({ productId: '1', balance: '-2', balanceStatus: 'matched' }))).toBe('-2');
  });

  it('linha ambígua nunca imprime número', () => {
    expect(formatBalanceCell(row({ productId: '1', balance: '97', balanceStatus: 'ambiguous' }))).toBe('');
  });
});

describe('applySourceBalancesToRows — saldo vindo da Fonte de Saldo', () => {
  const rows = [
    row({ productId: '1' }),
    row({ productId: '2' }),
    row({ productId: '3' }),
    row({ productId: '4' }),
  ];

  const applied = applySourceBalancesToRows(
    rows,
    new Map([
      ['1', { quantity: 28, ambiguous: false }],
      ['2', { quantity: 0, ambiguous: false }],
      ['3', { quantity: 5, ambiguous: true }],
    ])
  );

  it('saldo da fonte entra na linha e imprime o número', () => {
    expect(applied.rows[0].balance).toBe('28');
    expect(applied.rows[0].balanceStatus).toBe('matched');
    expect(formatBalanceCell(applied.rows[0])).toBe('28');
  });

  it('saldo ZERO da fonte imprime "0", não vazio', () => {
    expect(applied.rows[1].balance).toBe('0');
    expect(formatBalanceCell(applied.rows[1])).toBe('0');
  });

  it('produto com mais de um registro na fonte sai vazio, sem adivinhar', () => {
    expect(applied.rows[2].balance).toBeNull();
    expect(applied.rows[2].balanceStatus).toBe('ambiguous');
    expect(formatBalanceCell(applied.rows[2])).toBe('');
  });

  it('produto sem registro na fonte sai VAZIO — nunca zero', () => {
    expect(applied.rows[3].balance).toBeNull();
    expect(applied.rows[3].balanceStatus).toBe('not-found');
    expect(formatBalanceCell(applied.rows[3])).toBe('');
  });

  it('saldo negativo da fonte é preservado', () => {
    const negative = applySourceBalancesToRows(
      [row({ productId: '1' })],
      new Map([['1', { quantity: -4, ambiguous: false }]])
    );
    expect(formatBalanceCell(negative.rows[0])).toBe('-4');
  });

  it('resume o que foi encontrado, não encontrado e ambíguo', () => {
    expect(applied.summary).toEqual({ total: 4, matched: 2, notFound: 1, ambiguous: 1 });
  });

  it('não altera seleção nem ordem das linhas', () => {
    expect(applied.rows.map(r => r.productId)).toEqual(['1', '2', '3', '4']);
  });
});

describe('countLocations', () => {
  it('conta endereços distintos, ignorando quem não tem endereço', () => {
    expect(
      countLocations([
        row({ productId: '1', location: 'P1-A1-A' }),
        row({ productId: '2', location: 'P1-A1-A' }),
        row({ productId: '3', location: 'P1-A2-A' }),
        row({ productId: '4', location: null }),
      ])
    ).toBe(2);
  });
});

describe('paginateReportRows — A4 paisagem', () => {
  const options = { firstPageRows: 3, nextPageRows: 4 };

  it('a primeira página cabe menos (carrega o cabeçalho da emissão)', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row({ productId: String(i) }));
    expect(paginateReportRows(rows, options).map(p => p.length)).toEqual([3, 4, 2]);
  });

  it('toda linha tem altura fixa: nome longo não come duas linhas da folha', () => {
    const rows = [
      row({ productId: '1', name: 'Capa Anti Impacto Gocase Infinite Black - Galaxy S26 Plus - Azul Transparente' }),
      row({ productId: '2', name: 'curto' }),
      row({ productId: '3', name: 'curto' }),
    ];
    expect(paginateReportRows(rows, options).map(p => p.length)).toEqual([3]);
  });

  it('usa a densidade real da folha por padrão', () => {
    const rows = Array.from({ length: 90 }, (_, i) => row({ productId: String(i) }));
    expect(paginateReportRows(rows).map(p => p.length)).toEqual([41, 44, 5]);
  });

  it('sem linhas devolve uma página vazia (a folha em branco ainda é válida)', () => {
    expect(paginateReportRows([], options)).toEqual([[]]);
  });
});

describe('truncateProductName', () => {
  it('deixa nome curto intacto', () => {
    expect(truncateProductName('Bolsa Tote Puffer', 30)).toBe('Bolsa Tote Puffer');
  });

  it('corta na fronteira de palavra e marca com reticências', () => {
    const out = truncateProductName('Capa Anti Impacto Gocase Infinite Black Galaxy S26 Plus', 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('Capa Anti Impacto Gocase')).toBe(true);
  });

  it('normaliza espaço repetido antes de medir', () => {
    expect(truncateProductName('  Bolsa   Tote  ', 30)).toBe('Bolsa Tote');
  });

  it('sem fronteira de palavra útil, corta no meio da palavra', () => {
    expect(truncateProductName('ABCDEFGHIJKLMNOP', 8)).toBe('ABCDEFG…');
  });
});
