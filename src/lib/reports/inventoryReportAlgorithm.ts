// Emitir Relatório — lógica pura: ordenação natural de endereços, faixa
// inclusiva, seleção, montagem e paginação das linhas. Nada de React, nada de
// Supabase: tudo aqui é testável isoladamente.

import type {
  InventoryReportRow,
  ReportProduct,
  ReportSelectionMode,
} from './inventoryReportTypes';

/** Endereço vazio ou só com espaço não é endereço. */
export function normalizeLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  return trimmed === '' ? null : trimmed;
}

/** Quebra em blocos alternados de dígitos e não-dígitos: "P1-A002-A" vira
 *  ["P", "1", "-A", "002", "-A"]. É o que permite comparar número como número. */
function tokenizeLocation(location: string): string[] {
  return location.match(/\d+|\D+/g) ?? [];
}

/**
 * Ordenação natural/alfanumérica de endereços de warehouse.
 *
 * Comparação puramente lexicográfica erra em endereçamento: "P1-A10" viria
 * antes de "P1-A2" porque compara "1" com "2" caractere a caractere. Aqui os
 * blocos numéricos são comparados como número, então A2 vem antes de A10 e a
 * faixa A002 ate A010 contém A005 mesmo com quantidades diferentes de zeros
 * à esquerda.
 *
 * Devolve menor, igual ou maior que zero (contrato de Array.prototype.sort).
 */
export function compareLocations(a: string, b: string): number {
  const left = tokenizeLocation(a.toUpperCase());
  const right = tokenizeLocation(b.toUpperCase());
  const len = Math.min(left.length, right.length);

  for (let i = 0; i < len; i++) {
    const lt = left[i];
    const rt = right[i];
    const lNum = /^\d+$/.test(lt);
    const rNum = /^\d+$/.test(rt);

    if (lNum && rNum) {
      const diff = Number(lt) - Number(rt);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      // Mesmo valor com zeros à esquerda diferentes ("02" e "2"): mantém
      // determinismo sem inventar precedência semântica.
      if (lt.length !== rt.length) return lt.length - rt.length;
      continue;
    }
    // Bloco numérico ordena antes de texto, para "A1" e "AA" nunca alternarem.
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (lt !== rt) return lt < rt ? -1 : 1;
  }

  return left.length - right.length;
}

/** Endereços distintos dos produtos, em ordem natural. Produto sem endereço não entra. */
export function distinctLocations(products: ReportProduct[]): string[] {
  const set = new Set<string>();
  for (const product of products) {
    const location = normalizeLocation(product.location);
    if (location) set.add(location);
  }
  return [...set].sort(compareLocations);
}

/**
 * Faixa INCLUSIVA de endereços, em ordem natural — o inicial e o final entram.
 * Se o usuário inverter os campos, a faixa é a mesma (não devolve vazio).
 * Produto sem endereço nunca entra numa seleção por endereço.
 */
export function selectByLocationRange(
  products: ReportProduct[],
  from: string,
  to: string
): ReportProduct[] {
  const start = normalizeLocation(from);
  const end = normalizeLocation(to);
  if (!start && !end) return [];

  const lower = start ?? end!;
  const upper = end ?? start!;
  const [min, max] = compareLocations(lower, upper) <= 0 ? [lower, upper] : [upper, lower];

  return products.filter(product => {
    const location = normalizeLocation(product.location);
    if (!location) return false;
    return compareLocations(location, min) >= 0 && compareLocations(location, max) <= 0;
  });
}

/** Seleção por linha/marca: o produto entra se sua associação bate com qualquer
 *  marca ou linha escolhida. Produto sem endereço PODE entrar. */
export function selectByBrandsAndLines(
  products: ReportProduct[],
  brandIds: string[],
  lineIds: string[]
): ReportProduct[] {
  const brands = new Set(brandIds);
  const lines = new Set(lineIds);
  if (brands.size === 0 && lines.size === 0) return [];
  return products.filter(
    product =>
      (product.lineId !== null && lines.has(product.lineId)) ||
      (product.brandId !== null && brands.has(product.brandId))
  );
}

/** Busca da seleção manual — produto, SKU, EAN ou local, sem diferenciar caixa. */
export function matchesProductSearch(product: ReportProduct, term: string): boolean {
  const query = term.trim().toLowerCase();
  if (query === '') return true;
  const haystack = [product.name, product.sku, product.ean ?? '', product.location ?? '']
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

/** Ordem padrão da folha: LOCAL (natural) e, dentro do local, Produto e SKU.
 *  Produto sem endereço vai para o fim — o operador percorre o estoque por
 *  endereço, e o que não tem endereço não está no percurso. */
export function sortReportRows<T extends { location: string | null; name: string; sku: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const la = normalizeLocation(a.location);
    const lb = normalizeLocation(b.location);
    if (la && lb) {
      const byLocation = compareLocations(la, lb);
      if (byLocation !== 0) return byLocation;
    } else if (la !== lb) {
      return la ? -1 : 1;
    }
    const byName = a.name.localeCompare(b.name, 'pt-BR');
    if (byName !== 0) return byName;
    return a.sku.localeCompare(b.sku, 'pt-BR');
  });
}

/** Relatório por marca mantém agrupamento coerente: Marca/Linha, depois Local,
 *  depois Produto. Sem rótulo de grupo vai para o fim. */
export function sortReportRowsGrouped(rows: InventoryReportRow[]): InventoryReportRow[] {
  const groups = new Map<string, InventoryReportRow[]>();
  for (const row of rows) {
    const key = row.groupLabel ?? '￿';
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .flatMap(key => sortReportRows(groups.get(key) ?? []));
}

export interface BuildRowsOptions {
  mode: ReportSelectionMode;
  /** Rótulo de agrupamento do produto (nome da linha ou da marca), só no modo por marca. */
  groupLabelFor?: (product: ReportProduct) => string | null;
}

/** Monta as linhas da folha a partir dos produtos selecionados. O saldo nasce
 *  vazio — a fonte do saldo é aplicada depois, num passo separado. */
export function buildReportRows(
  products: ReportProduct[],
  { mode, groupLabelFor }: BuildRowsOptions
): InventoryReportRow[] {
  const rows: InventoryReportRow[] = products.map(product => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    ean: product.ean && product.ean.trim() !== '' ? product.ean.trim() : null,
    location: normalizeLocation(product.location),
    balance: null,
    balanceStatus: 'blank',
    groupLabel: mode === 'brand' ? (groupLabelFor?.(product) ?? null) : null,
  }));
  return mode === 'brand' ? sortReportRowsGrouped(rows) : sortReportRows(rows);
}

/** Quantos endereços distintos a emissão cobre (produto sem endereço não conta). */
export function countLocations(rows: InventoryReportRow[]): number {
  return new Set(rows.map(row => row.location).filter((l): l is string => !!l)).size;
}

// Paginação A4 paisagem ─────────────────────────────────────────────────────

export interface PaginationOptions {
  /** Linhas na primeira página (a que carrega o cabeçalho da emissão). */
  firstPageRows: number;
  /** Linhas nas páginas seguintes. */
  nextPageRows: number;
}

export const A4_LANDSCAPE_PAGINATION: PaginationOptions = {
  // A4 deitado com margem 6mm em cima/baixo: 198mm úteis. Cabeçalho da emissão
  // ~11mm, cabeçalho da tabela ~4.5mm, rodapé ~4.5mm, linha ~4.3mm.
  // Toda linha ocupa altura fixa — o nome do produto fica em UMA linha (o
  // excedente é truncado), que é o que dá a densidade da folha do Tiny.
  firstPageRows: 41,
  nextPageRows: 44,
};

/** Nome que não cabe na célula é cortado com reticências, em vez de quebrar a
 *  linha em duas ou três e destruir a densidade da folha. O corte acontece na
 *  fronteira de palavra quando dá, para o nome continuar reconhecível. */
export function truncateProductName(name: string, maxChars: number): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  const hard = clean.slice(0, maxChars - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/**
 * Distribui as linhas em páginas A4 paisagem. Puro: recebe as linhas e quantas
 * cabem por página, devolve as páginas — a UI só renderiza. Como toda linha tem
 * altura fixa, nenhuma linha é partida entre páginas.
 */
export function paginateReportRows(
  rows: InventoryReportRow[],
  options: PaginationOptions = A4_LANDSCAPE_PAGINATION
): InventoryReportRow[][] {
  if (rows.length === 0) return [[]];
  const pages: InventoryReportRow[][] = [];
  let current: InventoryReportRow[] = [];
  let budget = options.firstPageRows;

  for (const row of rows) {
    if (current.length >= budget) {
      pages.push(current);
      current = [];
      budget = options.nextPageRows;
    }
    current.push(row);
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

// Saldo vindo de uma Fonte de Saldo ────────────────────────────────────────

export interface SourceBalanceSummary {
  total: number;
  matched: number;
  notFound: number;
  ambiguous: number;
}

/**
 * Aplica às linhas o saldo já persistido numa Fonte de Saldo.
 *
 * A associação produto <-> registro da fonte NÃO acontece aqui: ela foi
 * resolvida e gravada na importação da fonte, e o mapa recebido já vem chaveado
 * por product_id. Este passo é só a montagem local das linhas — sem matching,
 * sem aproximação, sem consulta.
 *
 * Zero real vira "0". Produto ausente da fonte fica VAZIO (nunca zero), e
 * produto com mais de um registro na fonte também fica vazio, porque atribuir
 * um dos números seria escolher por adivinhação.
 */
export function applySourceBalancesToRows(
  rows: InventoryReportRow[],
  balances: Map<string, { quantity: number; ambiguous: boolean }>
): { rows: InventoryReportRow[]; summary: SourceBalanceSummary } {
  let matched = 0;
  let notFound = 0;
  let ambiguous = 0;

  const next = rows.map<InventoryReportRow>(row => {
    const found = balances.get(row.productId);
    if (found == null) {
      notFound += 1;
      return { ...row, balance: null, balanceStatus: 'not-found' };
    }
    if (found.ambiguous) {
      ambiguous += 1;
      return { ...row, balance: null, balanceStatus: 'ambiguous' };
    }
    matched += 1;
    return { ...row, balance: String(found.quantity), balanceStatus: 'matched' };
  });

  return { rows: next, summary: { total: rows.length, matched, notFound, ambiguous } };
}

export const NO_EAN_PLACEHOLDER = '-';
export const NO_LOCATION_PLACEHOLDER = 'Sem endereço';

/** EAN ausente vira "-" na folha; o valor presente sai como texto, nunca número. */
export function formatEanCell(ean: string | null): string {
  return ean && ean.trim() !== '' ? ean.trim() : NO_EAN_PLACEHOLDER;
}

export function formatLocationCell(location: string | null): string {
  return location ?? NO_LOCATION_PLACEHOLDER;
}

/** O que vai impresso na coluna Saldo/Contagem. Zero é "0"; ausência é vazio;
 *  ambíguo nunca imprime número (o operador conta e escreve). */
export function formatBalanceCell(row: InventoryReportRow): string {
  if (row.balanceStatus === 'ambiguous') return '';
  return row.balance ?? '';
}
