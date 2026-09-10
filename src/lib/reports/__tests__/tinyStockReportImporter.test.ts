import { describe, it, expect } from 'vitest';
import {
  applyTinyStockToRows,
  buildTinyStockIndex,
  cellToText,
  eanKey,
  skuKey,
  suggestTinyStockMapping,
} from '../tinyStockReportImporter';
import type { TinyStockMapping } from '../tinyStockReportImporter';
import type { InventoryReportRow } from '../inventoryReportTypes';

const MAPPING: TinyStockMapping = { sku: 'SKU', ean: 'EAN', balance: 'Saldo' };

function sheet(rows: Record<string, unknown>[]) {
  return rows.map(data => ({ data }));
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

function apply(sheetRows: Record<string, unknown>[], reportRows: InventoryReportRow[]) {
  return applyTinyStockToRows(reportRows, buildTinyStockIndex(sheet(sheetRows), MAPPING));
}

describe('cellToText — SKU e EAN sempre como texto', () => {
  it('nunca produz notação científica para número grande', () => {
    expect(cellToText(7900464109147)).toBe('7900464109147');
    expect(cellToText(1e21)).toBe('1000000000000000000000');
  });

  it('preserva zeros à esquerda quando o Tiny exporta como texto', () => {
    expect(cellToText('0790046410914')).toBe('0790046410914');
  });

  it('célula vazia é string vazia, não zero', () => {
    expect(cellToText(null)).toBe('');
    expect(cellToText(undefined)).toBe('');
    expect(cellToText('   ')).toBe('');
  });

  it('zero é "0"', () => {
    expect(cellToText(0)).toBe('0');
  });
});

describe('chaves de associação', () => {
  it('SKU ignora caixa mas preserva zeros à esquerda como significativos', () => {
    expect(skuKey(' ccgcm26gs26pl-2 ')).toBe('CCGCM26GS26PL-2');
    expect(skuKey('0123')).not.toBe(skuKey('123'));
  });

  it('EAN considera só dígitos e ignora zeros à esquerda', () => {
    expect(eanKey('0790046410914')).toBe('790046410914');
    expect(eanKey('790046410914')).toBe('790046410914');
    expect(eanKey('abc')).toBeNull();
  });
});

describe('suggestTinyStockMapping', () => {
  it('detecta as três colunas necessárias em cabeçalhos típicos do Tiny', () => {
    const mapping = suggestTinyStockMapping(['Produto', 'Código (SKU)', 'GTIN', 'Saldo atual']);
    expect(mapping.sku).toBe('Código (SKU)');
    expect(mapping.ean).toBe('GTIN');
    expect(mapping.balance).toBe('Saldo atual');
  });
});

describe('associação SKU e EAN', () => {
  it('associa por SKU exato', () => {
    const { rows, summary } = apply(
      [{ SKU: 'SKU-1', EAN: '', Saldo: 97 }],
      [row({ productId: '1' })]
    );
    expect(rows[0].balance).toBe('97');
    expect(rows[0].balanceStatus).toBe('matched');
    expect(summary).toEqual({ total: 1, matched: 1, notFound: 0, ambiguous: 0 });
  });

  it('cai para EAN quando o SKU não está na planilha', () => {
    const { rows } = apply(
      [{ SKU: 'OUTRO', EAN: '7900464109147', Saldo: 28 }],
      [row({ productId: '1', sku: 'NAO-EXISTE', ean: '7900464109147' })]
    );
    expect(rows[0].balance).toBe('28');
    expect(rows[0].balanceStatus).toBe('matched');
  });

  it('não usa o nome do produto para associar', () => {
    const { rows } = apply(
      [{ SKU: 'X', EAN: '', Saldo: 5 }],
      [row({ productId: '1', name: 'X', sku: 'SKU-1' })]
    );
    expect(rows[0].balanceStatus).toBe('not-found');
    expect(rows[0].balance).toBeNull();
  });

  it('SKU duplicado na planilha marca a linha como ambígua e não preenche', () => {
    const { rows, summary } = apply(
      [
        { SKU: 'SKU-1', EAN: '', Saldo: 10 },
        { SKU: 'SKU-1', EAN: '', Saldo: 40 },
      ],
      [row({ productId: '1' })]
    );
    expect(rows[0].balanceStatus).toBe('ambiguous');
    expect(rows[0].balance).toBeNull();
    expect(summary.ambiguous).toBe(1);
  });

  it('EAN duplicado marca a linha como ambígua quando o SKU não resolve', () => {
    const { rows } = apply(
      [
        { SKU: 'A', EAN: '7900464109147', Saldo: 10 },
        { SKU: 'B', EAN: '7900464109147', Saldo: 11 },
      ],
      [row({ productId: '1', sku: 'NAO-EXISTE', ean: '7900464109147' })]
    );
    expect(rows[0].balanceStatus).toBe('ambiguous');
  });

  it('SKU duplicado ainda pode ser resolvido por um EAN não ambíguo', () => {
    const { rows } = apply(
      [
        { SKU: 'SKU-1', EAN: '111', Saldo: 10 },
        { SKU: 'SKU-1', EAN: '222', Saldo: 11 },
      ],
      [row({ productId: '1', ean: '222' })]
    );
    expect(rows[0].balanceStatus).toBe('matched');
    expect(rows[0].balance).toBe('11');
  });

  it('saldo zero é associado como "0", nunca confundido com ausência', () => {
    const { rows, summary } = apply(
      [{ SKU: 'SKU-1', EAN: '', Saldo: 0 }],
      [row({ productId: '1' })]
    );
    expect(rows[0].balance).toBe('0');
    expect(rows[0].balanceStatus).toBe('matched');
    expect(summary.matched).toBe(1);
  });

  it('saldo negativo é preservado como veio da planilha', () => {
    const { rows } = apply([{ SKU: 'SKU-1', EAN: '', Saldo: -2 }], [row({ productId: '1' })]);
    expect(rows[0].balance).toBe('-2');
  });

  it('saldo em branco na planilha não vira zero — a linha fica não encontrada', () => {
    const { rows, summary } = apply(
      [{ SKU: 'SKU-1', EAN: '', Saldo: '' }],
      [row({ productId: '1' })]
    );
    expect(rows[0].balanceStatus).toBe('not-found');
    expect(rows[0].balance).toBeNull();
    expect(summary.notFound).toBe(1);
  });

  it('resume o resultado da importação para a tela', () => {
    const { summary } = apply(
      [
        { SKU: 'SKU-1', EAN: '', Saldo: 1 },
        { SKU: 'SKU-2', EAN: '', Saldo: 2 },
        { SKU: 'SKU-2', EAN: '', Saldo: 3 },
      ],
      [row({ productId: '1' }), row({ productId: '2' }), row({ productId: '3' })]
    );
    expect(summary).toEqual({ total: 3, matched: 1, notFound: 1, ambiguous: 1 });
  });

  it('EAN escrito como número na planilha associa com o EAN texto do cadastro', () => {
    const { rows } = apply(
      [{ SKU: '', EAN: 7900464109147, Saldo: 44 }],
      [row({ productId: '1', sku: '', ean: '7900464109147' })]
    );
    expect(rows[0].balance).toBe('44');
  });
});
