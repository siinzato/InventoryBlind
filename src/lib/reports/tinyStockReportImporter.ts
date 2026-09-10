// Emitir Relatório — associação do saldo da planilha de estoque geral do Tiny
// às linhas da folha. Lógica pura e testável: recebe linhas já lidas pelo
// parser do Comparador de Planilhas (readSpreadsheetGrid/buildParsedSheet) e
// devolve as linhas do relatório com saldo preenchido ou marcado.
//
// Regra dura: o saldo aqui é REFERÊNCIA de impressão. Nada neste arquivo
// escreve no banco, e nenhuma associação é feita por aproximação de nome.

import { detectFuzzyColumnMappings, suggestFuzzyMapping } from '../columnFuzzyMatch';
import type { FuzzyFieldDef } from '../columnFuzzyMatch';
import type { InventoryReportRow } from './inventoryReportTypes';

export type TinyStockField = 'sku' | 'ean' | 'balance';

export const TINY_STOCK_FIELDS: FuzzyFieldDef<TinyStockField>[] = [
  { key: 'sku', aliases: ['sku', 'codigo', 'código', 'cod', 'codigo (sku)', 'referencia', 'referência'] },
  { key: 'ean', aliases: ['ean', 'gtin', 'codigo de barras', 'código de barras', 'ean13', 'ean/gtin'] },
  {
    key: 'balance',
    aliases: [
      'saldo', 'estoque', 'saldo atual', 'estoque atual', 'quantidade', 'qtd',
      'saldo em estoque', 'estoque disponivel', 'estoque disponível', 'disponivel', 'disponível',
    ],
  },
];

export type TinyStockMapping = Record<TinyStockField, string | null>;

/** Sugere o mapeamento das 3 colunas necessárias a partir dos cabeçalhos. */
export function suggestTinyStockMapping(headers: string[]): TinyStockMapping {
  const detected = detectFuzzyColumnMappings(headers, TINY_STOCK_FIELDS);
  return suggestFuzzyMapping(detected, ['sku', 'ean', 'balance']);
}

/**
 * Célula da planilha para texto, sem NUNCA cair em notação científica.
 *
 * O EAN é a razão desta função existir: exportado como número, 7900464109147
 * chega aqui como `number` e `String(n)` só é seguro abaixo de 1e21 — acima
 * disso o JS imprime "1e+21". `toLocaleString('fullwide')` nunca usa expoente.
 * Quando o Tiny exporta como texto, o valor chega intacto (zeros à esquerda
 * incluídos) e é devolvido como veio.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value)
      ? value.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 })
      : String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value).trim();
}

/** Chave de SKU: só caixa e espaço são ignorados. Zeros à esquerda importam —
 *  "0123" e "123" são SKUs diferentes e não devem se associar entre si. */
export function skuKey(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return value === '' ? null : value;
}

/** Chave de EAN: só dígitos, sem zeros à esquerda — é o mesmo código de barras
 *  quer o Tiny exporte como texto "0790..." quer como número 790... */
export function eanKey(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits === '' ? null : digits;
}

/** Uma chave vista mais de uma vez na planilha nunca preenche nada. */
const AMBIGUOUS = Symbol('ambiguous');
type IndexEntry = string | typeof AMBIGUOUS;

export interface TinyStockIndex {
  bySku: Map<string, IndexEntry>;
  byEan: Map<string, IndexEntry>;
  /** Linhas lidas com pelo menos uma chave e um saldo. */
  usableRows: number;
  duplicateSkus: number;
  duplicateEans: number;
}

export interface TinyStockSheetRow {
  data: Record<string, unknown>;
}

/**
 * Indexa a planilha por SKU e por EAN. Chave repetida vira ambígua — mesmo que
 * o saldo seja igual —, porque "SKU duplicado" é exatamente o caso em que não
 * há como saber de quem é o número.
 */
export function buildTinyStockIndex(
  rows: TinyStockSheetRow[],
  mapping: TinyStockMapping
): TinyStockIndex {
  const bySku = new Map<string, IndexEntry>();
  const byEan = new Map<string, IndexEntry>();
  let usableRows = 0;
  let duplicateSkus = 0;
  let duplicateEans = 0;

  for (const row of rows) {
    const balance = mapping.balance ? cellToText(row.data[mapping.balance]) : '';
    // Saldo em branco na planilha não é zero: não temos o dado daquela linha.
    if (balance === '') continue;

    const sku = mapping.sku ? skuKey(cellToText(row.data[mapping.sku])) : null;
    const ean = mapping.ean ? eanKey(cellToText(row.data[mapping.ean])) : null;
    if (!sku && !ean) continue;
    usableRows += 1;

    if (sku) {
      if (bySku.has(sku)) {
        if (bySku.get(sku) !== AMBIGUOUS) duplicateSkus += 1;
        bySku.set(sku, AMBIGUOUS);
      } else {
        bySku.set(sku, balance);
      }
    }
    if (ean) {
      if (byEan.has(ean)) {
        if (byEan.get(ean) !== AMBIGUOUS) duplicateEans += 1;
        byEan.set(ean, AMBIGUOUS);
      } else {
        byEan.set(ean, balance);
      }
    }
  }

  return { bySku, byEan, usableRows, duplicateSkus, duplicateEans };
}

export interface TinyMatchSummary {
  total: number;
  matched: number;
  notFound: number;
  ambiguous: number;
}

/**
 * Aplica o saldo às linhas da folha.
 *
 * Prioridade: SKU exato; EAN exato só quando o SKU não permite associação
 * (ausente na planilha ou duplicado). Nome de produto nunca é usado, e não
 * existe fuzzy: o que não bate exatamente sai vazio e sinalizado.
 */
export function applyTinyStockToRows(
  rows: InventoryReportRow[],
  index: TinyStockIndex
): { rows: InventoryReportRow[]; summary: TinyMatchSummary } {
  let matched = 0;
  let notFound = 0;
  let ambiguous = 0;

  const next = rows.map<InventoryReportRow>(row => {
    const sku = skuKey(row.sku ?? '');
    const ean = eanKey(row.ean ?? '');
    const skuHit = sku ? index.bySku.get(sku) : undefined;

    if (typeof skuHit === 'string') {
      matched += 1;
      return { ...row, balance: skuHit, balanceStatus: 'matched' };
    }

    const eanHit = ean ? index.byEan.get(ean) : undefined;
    if (typeof eanHit === 'string') {
      matched += 1;
      return { ...row, balance: eanHit, balanceStatus: 'matched' };
    }

    // SKU ou EAN duplicado na planilha: identificação ambígua, saldo em branco.
    if (skuHit === AMBIGUOUS || eanHit === AMBIGUOUS) {
      ambiguous += 1;
      return { ...row, balance: null, balanceStatus: 'ambiguous' };
    }

    notFound += 1;
    return { ...row, balance: null, balanceStatus: 'not-found' };
  });

  return { rows: next, summary: { total: rows.length, matched, notFound, ambiguous } };
}
