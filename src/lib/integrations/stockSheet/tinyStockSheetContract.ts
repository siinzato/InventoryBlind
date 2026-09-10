// Contrato do relatório de estoque do Tiny — leitura pura da grade da planilha.
//
// Nada aqui toca banco, React ou rede: recebe a grade já lida pelo parser do
// Comparador (src/lib/spreadsheet-comparator/fileParser.ts) e devolve os
// registros normalizados, ou uma recusa. É de propósito estrito: o usuário não
// deve editar o arquivo antes de importar, então qualquer divergência de
// cabeçalho é recusa explícita — nunca importação parcial "adivinhando" colunas.
//
// Tipos: SKU e GTIN/EAN são IDENTIFICADORES, sempre texto (zero à esquerda
// preservado, nunca notação científica). Saldo é número, e célula vazia não é
// zero.

import { cellToText } from '../../reports/tinyStockReportImporter';
import { parseFlexibleNumber } from '../../spreadsheet-comparator/normalization';

export { TINY_STOCK_SHEET_PROVIDER_KEY } from '../sheetSources';

/** Nome da fonte, como aparece em Produtos -> Fonte de Saldo. */
export const TINY_STOCK_SHEET_SOURCE_NAME = 'Tiny — Estoque diário';

/**
 * As seis colunas esperadas, nesta ordem exata.
 *
 * Recusa se houver coluna ausente, renomeada, fora de ordem, adicional no meio
 * do conjunto, ou adicional antes/depois das seis.
 */
export const TINY_STOCK_SHEET_COLUMNS = [
  'ID',
  'Produto',
  'Código(SKU)',
  'GTIN/EAN',
  'Localização',
  'Saldo em Estoque',
] as const;

/** Quantas linhas do topo são varridas em busca do cabeçalho. Mesmo limite que
 *  o detector do Comparador usa, para não divergir de tela para tela. */
const HEADER_SCAN_LIMIT = 15;

/**
 * Rótulo como o usuário vê, para a mensagem de recusa: só whitespace acidental
 * nas extremidades. `String.prototype.trim()` cobre também espaço-não-separável
 * (U+00A0) e BOM (U+FEFF), invisíveis e comuns em export de planilha.
 */
function headerLabel(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

/**
 * Forma canônica usada para COMPARAR nome de coluna.
 *
 * Diferença de formatação não é diferença de coluna: o relatório do Tiny exporta
 * "Saldo em estoque" e a documentação escreve "Saldo em Estoque". Recusar o
 * arquivo por causa de uma inicial minúscula é bug, não rigor.
 *
 * O mesmo arquivo traz "Código (SKU)", com espaço antes do parêntese, contra o
 * "Código(SKU)" da documentação — outra diferença de espaçamento, tratada pela
 * mesma regra.
 *
 * A normalização é só de FORMA:
 *   1. vira string;
 *   2. `normalize('NFC')` — "Localização" com cedilha/tilde combinantes passa a
 *      ter a mesma representação da versão pré-composta (diferença invisível);
 *   3. `trim()` nas extremidades;
 *   4. qualquer sequência de whitespace (espaço, tab, quebra de linha, NBSP)
 *      interna colapsa em um espaço só;
 *   5. whitespace encostado em pontuação de agrupamento — `(`, `)`, `/` — cai:
 *      "Código (SKU)" e "GTIN / EAN" são a mesma coluna que "Código(SKU)" e
 *      "GTIN/EAN";
 *   6. caixa baixa.
 *
 * O que ela NÃO faz: não remove acento, não remove pontuação, não parte o nome
 * em palavras, não conhece apelido. "Saldo", "Estoque", "Saldo Atual",
 * "Quantidade", "SKU", "Código", "Cod Produto" e "Codigo(SKU)" (sem acento)
 * continuam sendo colunas diferentes e continuam recusados — normalizar
 * formatação não é aceitar nome semanticamente diferente.
 */
export function normalizeHeader(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell)
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([()/])\s*/g, '$1')
    .toLowerCase();
}

const CANONICAL_COLUMNS = TINY_STOCK_SHEET_COLUMNS.map(normalizeHeader);

function isBlankCell(cell: unknown): boolean {
  return headerLabel(cell) === '';
}

/** Célula vazia no fim da linha não é coluna: planilha frequentemente carrega
 *  colunas fantasma à direita. Qualquer célula PREENCHIDA além das seis é,
 *  isso sim, coluna adicional — e recusa. */
function trimTrailingBlanks(cells: unknown[]): unknown[] {
  let end = cells.length;
  while (end > 0 && isBlankCell(cells[end - 1])) end -= 1;
  return cells.slice(0, end);
}

/** A linha é o cabeçalho do contrato?
 *
 *  Estrito no que importa — exatamente seis colunas, na ordem exata, nenhuma a
 *  mais — e tolerante só quanto à forma do nome (ver `normalizeHeader`). */
export function headerRowMatchesContract(cells: unknown[]): boolean {
  const trimmed = trimTrailingBlanks(cells);
  if (trimmed.length !== CANONICAL_COLUMNS.length) return false;
  return CANONICAL_COLUMNS.every((expected, index) => normalizeHeader(trimmed[index]) === expected);
}

/** Índice da linha de cabeçalho, ou -1. Varre o topo porque relatório exportado
 *  costuma trazer linha de título/filtro antes do cabeçalho de verdade. */
export function findContractHeaderRow(grid: unknown[][]): number {
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    if (headerRowMatchesContract(grid[i] ?? [])) return i;
  }
  return -1;
}

/** Primeira linha não vazia, para dizer ao usuário o que foi encontrado no
 *  lugar do cabeçalho esperado. */
export function firstNonEmptyRowLabels(grid: unknown[][]): string[] {
  for (const row of grid) {
    const trimmed = trimTrailingBlanks(row ?? []);
    if (trimmed.length > 0) return trimmed.map(headerLabel);
  }
  return [];
}

export type TinyStockSheetIssue =
  | 'missing-id'
  | 'duplicate-id'
  | 'missing-balance'
  | 'invalid-balance';

export interface TinyStockSheetRecord {
  /** Número da linha no arquivo, para o usuário achar o problema. */
  sourceRowNumber: number;
  /** Coluna ID — identificador do registro NO TINY. Nunca products.id. */
  externalId: string;
  /** Coluna Produto — nome informado pela fonte, metadado. */
  name: string;
  /** Coluna Código(SKU) — texto, zeros à esquerda preservados. */
  sku: string;
  /** Coluna GTIN/EAN — texto, zeros à esquerda preservados. */
  ean: string;
  /** Coluna Localização — informada pelo Tiny, metadado da fonte. */
  location: string;
  /** Coluna Saldo em Estoque. `null` = ausente ou inválido; nunca 0 por omissão. */
  quantity: number | null;
  /** Por que a linha não entra no saldo, quando não entra. */
  issue: TinyStockSheetIssue | null;
}

export type TinyStockSheetParse =
  | { ok: false; error: string }
  | { ok: true; headerRowIndex: number; records: TinyStockSheetRecord[] };

/** Mensagem única de recusa de contrato, com o que foi encontrado. */
export function contractErrorMessage(found: string[]): string {
  const expected = TINY_STOCK_SHEET_COLUMNS.join(' | ');
  const encontrado = found.length > 0 ? found.join(' | ') : '(nenhuma coluna preenchida)';
  return (
    `A planilha não está no formato do relatório de estoque do Tiny. ` +
    `Esperado exatamente, nesta ordem: ${expected}. Encontrado: ${encontrado}. ` +
    `Envie o arquivo exportado pelo Tiny sem alterar as colunas.`
  );
}

/**
 * Lê a grade de UMA planilha (aba) e devolve os registros.
 *
 * Recusa antes de produzir qualquer registro quando o cabeçalho não bate: é o
 * que garante que um arquivo estruturalmente inválido não chegue a alterar
 * saldo nenhum.
 */
export function parseTinyStockSheetGrid(grid: unknown[][]): TinyStockSheetParse {
  const headerRowIndex = findContractHeaderRow(grid);
  if (headerRowIndex < 0) {
    return { ok: false, error: contractErrorMessage(firstNonEmptyRowLabels(grid)) };
  }

  const records: TinyStockSheetRecord[] = [];
  // ID repetido no mesmo arquivo não é escolha nossa de "quem vence": os dois
  // registros ficam recusados. Mesma postura que o resto do domínio tem para
  // chave duplicada — nunca resolver ambiguidade por conta própria.
  const idCount = new Map<string, number>();

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (trimTrailingBlanks(row).length === 0) continue;

    const externalId = cellToText(row[0]);
    const rawBalance = cellToText(row[5]);
    const parsedBalance = rawBalance === '' ? null : parseFlexibleNumber(rawBalance);

    let issue: TinyStockSheetIssue | null = null;
    if (externalId === '') issue = 'missing-id';
    else if (rawBalance === '') issue = 'missing-balance';
    else if (!parsedBalance?.ok) issue = 'invalid-balance';

    records.push({
      sourceRowNumber: i + 1,
      externalId,
      name: cellToText(row[1]),
      sku: cellToText(row[2]),
      ean: cellToText(row[3]),
      location: cellToText(row[4]),
      // Zero real é 0; ausente e inválido são null — e o `issue` diz qual dos dois.
      quantity: issue === null ? (parsedBalance?.value ?? null) : null,
      issue,
    });

    if (externalId !== '') idCount.set(externalId, (idCount.get(externalId) ?? 0) + 1);
  }

  const duplicated = records.map(record =>
    record.issue === null && (idCount.get(record.externalId) ?? 0) > 1
      ? { ...record, quantity: null, issue: 'duplicate-id' as TinyStockSheetIssue }
      : record
  );

  return { ok: true, headerRowIndex, records: duplicated };
}

export interface TinyStockSheetCounts {
  total: number;
  usable: number;
  missingBalance: number;
  rejected: number;
}

/** Contagem para a tela mostrar antes de importar. */
export function countSheetRecords(records: TinyStockSheetRecord[]): TinyStockSheetCounts {
  let usable = 0;
  let missingBalance = 0;
  let rejected = 0;
  for (const record of records) {
    if (record.issue === null) usable += 1;
    else if (record.issue === 'missing-balance') missingBalance += 1;
    else rejected += 1;
  }
  return { total: records.length, usable, missingBalance, rejected };
}

export const ISSUE_LABEL: Record<TinyStockSheetIssue, string> = {
  'missing-id': 'Sem ID do Tiny',
  'duplicate-id': 'ID repetido no arquivo',
  'missing-balance': 'Saldo em branco',
  'invalid-balance': 'Saldo inválido',
};
