// Fonte de Saldo "Tiny — Estoque diário" — contrato do arquivo e planejamento
// da associação. Fixtures sintéticas, nenhum dado real e nenhum banco.

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  TINY_STOCK_SHEET_COLUMNS,
  TINY_STOCK_SHEET_PROVIDER_KEY,
  TINY_STOCK_SHEET_SOURCE_NAME,
  countSheetRecords,
  findContractHeaderRow,
  headerRowMatchesContract,
  normalizeHeader,
  parseTinyStockSheetGrid,
} from '../tinyStockSheetContract';
import { planStockSheetImport } from '../tinyStockSheetPlan';
import type { TinyStockSheetRecord } from '../tinyStockSheetContract';
import type { EntityLink } from '../../types';
import type { MatchCandidate } from '../../matching';

const HEADER = [...TINY_STOCK_SHEET_COLUMNS];

function sheet(rows: unknown[][]): unknown[][] {
  return [HEADER, ...rows];
}

function parsed(rows: unknown[][]): TinyStockSheetRecord[] {
  const result = parseTinyStockSheetGrid(sheet(rows));
  if (!result.ok) throw new Error(`esperava contrato válido, veio: ${result.error}`);
  return result.records;
}

function link(partial: Partial<EntityLink> & { externalId: string }): EntityLink {
  return {
    id: `link-${partial.externalId}`,
    connectionId: 'conn-1',
    entityType: 'product',
    internalId: null,
    externalSku: null,
    externalEan: null,
    externalName: null,
    matchSource: null,
    lastSyncedAt: null,
    ...partial,
  };
}

describe('identidade da fonte', () => {
  it('nome e provider key são os esperados', () => {
    expect(TINY_STOCK_SHEET_SOURCE_NAME).toBe('Tiny — Estoque diário');
    expect(TINY_STOCK_SHEET_PROVIDER_KEY).toBe('tiny_stock_sheet');
  });

  it('o contrato tem exatamente as seis colunas do relatório do Tiny, nesta ordem', () => {
    expect(HEADER).toEqual([
      'ID',
      'Produto',
      'Código(SKU)',
      'GTIN/EAN',
      'Localização',
      'Saldo em Estoque',
    ]);
  });
});

describe('contrato do cabeçalho — estrito', () => {
  it('aceita o cabeçalho exato', () => {
    expect(parseTinyStockSheetGrid(sheet([])).ok).toBe(true);
  });

  it('aceita whitespace acidental nas extremidades do nome da coluna', () => {
    const grid = [['  ID ', 'Produto', 'Código(SKU)', 'GTIN/EAN', 'Localização', ' Saldo em Estoque']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(true);
  });

  it('recusa coluna obrigatória ausente', () => {
    const grid = [['ID', 'Produto', 'Código(SKU)', 'GTIN/EAN', 'Localização']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('recusa coluna renomeada', () => {
    const grid = [['ID', 'Produto', 'Codigo (SKU)', 'GTIN/EAN', 'Localização', 'Saldo em Estoque']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('recusa ordem diferente', () => {
    const grid = [['ID', 'Código(SKU)', 'Produto', 'GTIN/EAN', 'Localização', 'Saldo em Estoque']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('recusa coluna adicional no meio do conjunto esperado', () => {
    const grid = [
      ['ID', 'Produto', 'Marca', 'Código(SKU)', 'GTIN/EAN', 'Localização', 'Saldo em Estoque'],
    ];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('recusa coluna adicional antes das seis', () => {
    const grid = [['Empresa', ...HEADER]];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('recusa coluna adicional depois das seis', () => {
    const grid = [[...HEADER, 'Custo']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(false);
  });

  it('tolera célula vazia sobrando à direita (coluna fantasma de planilha)', () => {
    const grid = [[...HEADER, undefined, '   ']];
    expect(parseTinyStockSheetGrid(grid).ok).toBe(true);
  });

  it('acha o cabeçalho quando há linha de título acima dele', () => {
    const grid = [['Relatório de estoque'], [], HEADER, ['1', 'Capa', 'SKU-1', '', '', '5']];
    const result = parseTinyStockSheetGrid(grid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headerRowIndex).toBe(2);
      expect(result.records).toHaveLength(1);
    }
  });

  it('recusa arquivo sem o cabeçalho, dizendo o que foi encontrado', () => {
    const result = parseTinyStockSheetGrid([['Produto', 'Quantidade'], ['Capa', '3']]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Produto | Quantidade');
      expect(result.error).toContain('Saldo em Estoque');
    }
  });

  it('contrato inválido não produz registro nenhum (nada a importar)', () => {
    const result = parseTinyStockSheetGrid([['Produto'], ['Capa']]);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('normalização do nome da coluna — forma sim, semântica não', () => {
  it('mesma coluna escrita de formas diferentes tem a mesma forma canônica', () => {
    const canonical = normalizeHeader('Saldo em Estoque');
    expect(normalizeHeader(' Saldo em Estoque ')).toBe(canonical);
    expect(normalizeHeader('Saldo em estoque')).toBe(canonical);
    expect(normalizeHeader('SALDO EM ESTOQUE')).toBe(canonical);
    expect(normalizeHeader('Saldo  em   Estoque')).toBe(canonical);
    expect(normalizeHeader('Saldo\nem\tEstoque')).toBe(canonical);
    expect(normalizeHeader('Saldo em Estoque')).toBe(canonical);
  });

  it('espaço encostado em parêntese ou barra é cosmético', () => {
    expect(normalizeHeader('Código (SKU)')).toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('código ( sku )')).toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('GTIN / EAN')).toBe(normalizeHeader('GTIN/EAN'));
  });

  it('não remove acento nem pontuação: nome diferente continua diferente', () => {
    expect(normalizeHeader('Localizacao')).not.toBe(normalizeHeader('Localização'));
    expect(normalizeHeader('Codigo(SKU)')).not.toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('Código')).not.toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('SKU')).not.toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('Cod Produto')).not.toBe(normalizeHeader('Código(SKU)'));
    expect(normalizeHeader('GTIN EAN')).not.toBe(normalizeHeader('GTIN/EAN'));
  });

  it('formas Unicode diferentes do mesmo acento são a mesma coluna', () => {
    // "Localização" com cedilha e tilde combinantes (NFD) versus pré-composta.
    const decomposed = 'Localização'.normalize('NFD');
    expect(decomposed).not.toBe('Localização');
    expect(normalizeHeader(decomposed)).toBe(normalizeHeader('Localização'));
  });
});

describe('cabeçalho real do Tiny — só a forma varia', () => {
  // Este é literalmente o cabeçalho que o arquivo do Tiny traz e que estava
  // sendo recusado: "Saldo em estoque", com "estoque" minúsculo.
  const TINY_REAL = ['ID', 'Produto', 'Código(SKU)', 'GTIN/EAN', 'Localização', 'Saldo em estoque'];

  it('aceita o cabeçalho do arquivo real e segue para os registros', () => {
    const result = parseTinyStockSheetGrid([
      TINY_REAL,
      ['1001', 'Capa Anti Impacto', 'CCAZ-1', '0070341856000', 'P1-A002-A', 7],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headerRowIndex).toBe(0);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].quantity).toBe(7);
    expect(result.records[0].ean).toBe('0070341856000');
    expect(result.records[0].issue).toBeNull();
  });

  it('aceita o cabeçalho exato que a tela estava recusando', () => {
    // Copiado da mensagem de erro reproduzida na tela: duas diferenças de
    // formatação contra a documentação — o espaço em "Código (SKU)" e o
    // "estoque" minúsculo.
    const recusado = [
      'ID',
      'Produto',
      'Código (SKU)',
      'GTIN/EAN',
      'Localização',
      'Saldo em estoque',
    ];
    expect(headerRowMatchesContract(recusado)).toBe(true);

    const result = parseTinyStockSheetGrid([
      recusado,
      ['1001', 'Capa Anti Impacto', 'CCAZ-1', '0070341856000', 'P1-A002-A', 7],
      ['1002', 'Película Vidro', '0123', 7900464109147, 'P1-A003-B', 0],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records.map(r => r.issue)).toEqual([null, null]);
    expect(result.records.map(r => r.quantity)).toEqual([7, 0]);
    expect(result.records[1].sku).toBe('0123');
  });

  const accepted: [string, string[]][] = [
    ['tudo em caixa alta', TINY_REAL.map(label => label.toUpperCase())],
    ['tudo em caixa baixa', TINY_REAL.map(label => label.toLowerCase())],
    ['espaços extras nas extremidades', TINY_REAL.map(label => `  ${label}  `)],
    ['múltiplos espaços internos', [...TINY_REAL.slice(0, 5), 'Saldo  em   estoque']],
    ['quebra de linha e tab no lugar do espaço', [...TINY_REAL.slice(0, 5), 'Saldo\nem\testoque']],
    ['espaço não separável interno', [...TINY_REAL.slice(0, 5), 'Saldo em estoque']],
  ];

  for (const [label, header] of accepted) {
    it(`aceita: ${label}`, () => {
      expect(headerRowMatchesContract(header)).toBe(true);
    });
  }

  const rejected: [string, string[]][] = [
    ['"Saldo" sozinho', [...TINY_REAL.slice(0, 5), 'Saldo']],
    ['"Estoque" sozinho', [...TINY_REAL.slice(0, 5), 'Estoque']],
    ['"Saldo Atual"', [...TINY_REAL.slice(0, 5), 'Saldo Atual']],
    ['"Quantidade"', [...TINY_REAL.slice(0, 5), 'Quantidade']],
    ['"Saldo Disponível"', [...TINY_REAL.slice(0, 5), 'Saldo Disponível']],
    ['"SKU" no lugar de "Código(SKU)"', ['ID', 'Produto', 'SKU', ...TINY_REAL.slice(3)]],
    ['"Código" no lugar de "Código(SKU)"', ['ID', 'Produto', 'Código', ...TINY_REAL.slice(3)]],
    ['"Cod Produto" no lugar de "Código(SKU)"', ['ID', 'Produto', 'Cod Produto', ...TINY_REAL.slice(3)]],
    ['coluna ausente', TINY_REAL.slice(0, 5)],
    ['ordem incorreta', ['Produto', 'ID', ...TINY_REAL.slice(2)]],
    ['coluna extra no fim', [...TINY_REAL, 'Custo']],
  ];

  for (const [label, header] of rejected) {
    it(`recusa: ${label}`, () => {
      expect(headerRowMatchesContract(header)).toBe(false);
    });
  }
});

describe('tipos — identificadores são texto, saldo é número', () => {
  it('EAN com zero à esquerda é preservado', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', '0070341856000', 'P1-A002-A', '7']]);
    expect(record.ean).toBe('0070341856000');
  });

  it('EAN exportado como número nunca vira notação científica', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', 7900464109147, 'P1-A002-A', 7]]);
    expect(record.ean).toBe('7900464109147');
  });

  it('SKU com zero à esquerda é preservado e não é convertido para número', () => {
    const [record] = parsed([['1', 'Capa', '0123', '', '', '2']]);
    expect(record.sku).toBe('0123');
  });

  it('saldo zero real é zero', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', '', '', 0]]);
    expect(record.quantity).toBe(0);
    expect(record.issue).toBeNull();
  });

  it('célula de saldo vazia NÃO vira zero', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', '', '', '']]);
    expect(record.quantity).toBeNull();
    expect(record.issue).toBe('missing-balance');
  });

  it('saldo inválido NÃO vira zero', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', '', '', 'sem estoque']]);
    expect(record.quantity).toBeNull();
    expect(record.issue).toBe('invalid-balance');
  });

  it('saldo negativo é preservado', () => {
    const [record] = parsed([['1', 'Capa', 'CCAZ-1', '', '', -3]]);
    expect(record.quantity).toBe(-3);
  });

  it('linha sem ID do Tiny é recusada (não há chave idempotente)', () => {
    const [record] = parsed([['', 'Capa', 'CCAZ-1', '', '', '4']]);
    expect(record.issue).toBe('missing-id');
  });

  it('ID repetido no mesmo arquivo recusa as duas linhas', () => {
    const records = parsed([
      ['77', 'Capa A', 'A-1', '', '', '4'],
      ['77', 'Capa B', 'B-1', '', '', '9'],
    ]);
    expect(records.map(r => r.issue)).toEqual(['duplicate-id', 'duplicate-id']);
  });

  it('linha totalmente vazia é ignorada, não recusada', () => {
    const records = parsed([['1', 'Capa', 'A-1', '', '', '4'], [], [undefined, '  ']]);
    expect(records).toHaveLength(1);
  });

  it('countSheetRecords separa utilizáveis, sem saldo e recusadas', () => {
    const records = parsed([
      ['1', 'A', 'A-1', '', '', '4'],
      ['2', 'B', 'B-1', '', '', ''],
      ['', 'C', 'C-1', '', '', '1'],
    ]);
    expect(countSheetRecords(records)).toEqual({
      total: 3,
      usable: 1,
      missingBalance: 1,
      rejected: 1,
    });
  });
});

describe('arquivo real do Tiny — .xlsx e .xls', () => {
  const AOA = [
    HEADER,
    ['1001', 'Capa Anti Impacto', 'CCAZ-1', '0070341856000', 'P1-A002-A', 0],
    ['1002', 'Película Vidro', 'PVAZ-2', 7900464109147, 'P1-A003-B', 12],
  ];

  for (const bookType of ['xlsx', 'xls'] as const) {
    it(`lê o contrato a partir de um arquivo .${bookType}`, () => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(AOA), 'Estoque');
      const buffer = XLSX.write(book, { bookType, type: 'array' }) as ArrayBuffer;

      // Mesma leitura que src/lib/spreadsheet-comparator/fileParser.ts faz.
      const reread = XLSX.read(buffer, { type: 'array', raw: true });
      const grid = XLSX.utils.sheet_to_json<unknown[]>(reread.Sheets[reread.SheetNames[0]], {
        header: 1,
        raw: true,
        defval: undefined,
      });

      const result = parseTinyStockSheetGrid(grid);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.records).toHaveLength(2);
      expect(result.records[0].ean).toBe('0070341856000');
      expect(result.records[0].quantity).toBe(0);
      expect(result.records[1].ean).toBe('7900464109147');
      expect(result.records[1].quantity).toBe(12);
    });
  }

  it('com várias abas, só a aba do contrato é usada', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['Resumo'], ['Total', 2]]),
      'Resumo'
    );
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(AOA), 'Estoque');
    const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const reread = XLSX.read(buffer, { type: 'array', raw: true });

    const matching = reread.SheetNames.filter(name => {
      const grid = XLSX.utils.sheet_to_json<unknown[]>(reread.Sheets[name], {
        header: 1,
        raw: true,
        defval: undefined,
      });
      return findContractHeaderRow(grid) >= 0;
    });

    expect(matching).toEqual(['Estoque']);
  });
});

describe('associação — regra canônica do domínio de integrações', () => {
  const candidates: MatchCandidate[] = [
    { internalId: 'p1', sku: 'CCAZ-1', ean: '7900464109147' },
    { internalId: 'p2', sku: 'PVAZ-2', ean: null },
    { internalId: 'p3', sku: 'DUP', ean: null },
    { internalId: 'p4', sku: 'DUP', ean: null },
  ];

  it('associa por SKU exato', () => {
    const plan = planStockSheetImport({
      records: parsed([['1', 'Capa', 'CCAZ-1', '', '', '5']]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.decisions[0].outcome).toBe('linked');
    expect(plan.decisions[0].internalId).toBe('p1');
    expect(plan.decisions[0].matchSource).toBe('sku');
  });

  it('associa por EAN quando o SKU da planilha não bate', () => {
    const plan = planStockSheetImport({
      records: parsed([['1', 'Capa', 'OUTRO-SKU', '7900464109147', '', '5']]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.decisions[0].internalId).toBe('p1');
    expect(plan.decisions[0].matchSource).toBe('ean');
  });

  it('nome de produto nunca associa', () => {
    const plan = planStockSheetImport({
      records: parsed([['1', 'Capa Anti Impacto', '', '', '', '5']]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.decisions[0].outcome).toBe('unlinked');
    expect(plan.decisions[0].internalId).toBeNull();
  });

  it('empate entre dois produtos do workspace nunca associa', () => {
    const plan = planStockSheetImport({
      records: parsed([['1', 'Item', 'DUP', '', '', '5']]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.decisions[0].outcome).toBe('ambiguous');
    expect(plan.decisions[0].internalId).toBeNull();
    expect(plan.counters.ambiguous).toBe(1);
  });

  it('chave repetida na própria planilha nunca associa', () => {
    const plan = planStockSheetImport({
      records: parsed([
        ['1', 'Item A', 'CCAZ-1', '', '', '5'],
        ['2', 'Item B', 'CCAZ-1', '', '', '9'],
      ]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.decisions.map(d => d.outcome)).toEqual(['ambiguous', 'ambiguous']);
  });

  it('link existente pelo ID do Tiny vence, mesmo se o SKU mudou na fonte', () => {
    const plan = planStockSheetImport({
      records: parsed([['1', 'Capa', 'SKU-RENOMEADO', '', '', '5']]),
      existingLinks: new Map([['1', link({ externalId: '1', internalId: 'p2' })]]),
      candidates,
    });
    expect(plan.decisions[0].internalId).toBe('p2');
    expect(plan.decisions[0].matchSource).toBe('external_id');
    expect(plan.decisions[0].isNewLink).toBe(false);
  });

  it('linha sem saldo não entra no snapshot e linha recusada conta como falha', () => {
    const plan = planStockSheetImport({
      records: parsed([
        ['1', 'A', 'CCAZ-1', '', '', '5'],
        ['2', 'B', 'PVAZ-2', '', '', ''],
        ['', 'C', 'X', '', '', '1'],
      ]),
      existingLinks: new Map(),
      candidates,
    });
    expect(plan.counters).toMatchObject({
      processed: 3,
      created: 1,
      updated: 0,
      skipped: 1,
      failed: 1,
      linked: 1,
    });
  });

  it('reimportar o mesmo arquivo é idempotente: mesma decisão, nada de novo', () => {
    const records = parsed([
      ['1', 'A', 'CCAZ-1', '', '', '5'],
      ['2', 'B', 'PVAZ-2', '', '', '7'],
    ]);
    const first = planStockSheetImport({ records, existingLinks: new Map(), candidates });
    expect(first.counters.created).toBe(2);
    expect(first.counters.updated).toBe(0);

    const afterFirst = new Map(
      first.decisions.map(decision => [
        decision.record.externalId,
        link({
          externalId: decision.record.externalId,
          internalId: decision.internalId,
          matchSource: decision.matchSource,
        }),
      ])
    );

    const second = planStockSheetImport({ records, existingLinks: afterFirst, candidates });
    expect(second.counters.created).toBe(0);
    expect(second.counters.updated).toBe(2);
    expect(second.decisions.map(d => d.internalId)).toEqual(first.decisions.map(d => d.internalId));
  });

  it('saldo novo do mesmo produto substitui o anterior — nunca soma', () => {
    const candidatesOne: MatchCandidate[] = [{ internalId: 'p1', sku: 'CCAZ-1', ean: null }];
    const links = new Map([
      ['1', link({ externalId: '1', internalId: 'p1', matchSource: 'sku' })],
    ]);

    const day1 = planStockSheetImport({
      records: parsed([['1', 'A', 'CCAZ-1', '', '', '10']]),
      existingLinks: links,
      candidates: candidatesOne,
    });
    const day2 = planStockSheetImport({
      records: parsed([['1', 'A', 'CCAZ-1', '', '', '12']]),
      existingLinks: links,
      candidates: candidatesOne,
    });

    // Mesmo produto, mesmo id externo: o snapshot do dia 2 é 12, não 22.
    expect(day1.decisions[0].record.quantity).toBe(10);
    expect(day2.decisions[0].record.quantity).toBe(12);
    expect(day2.decisions[0].internalId).toBe(day1.decisions[0].internalId);
  });
});
