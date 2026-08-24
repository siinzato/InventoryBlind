// Tipos do Comparador de Planilhas. Ferramenta independente — não compartilha
// estado, chave de localStorage nem tabelas com o Importador de Produtos.

export type CellValue = string | number | undefined;

export interface SpreadsheetRow {
  [column: string]: CellValue;
}

export interface SpreadsheetDataRow {
  /** Número da linha no arquivo original (1-based, contando a própria linha de cabeçalho). */
  sourceRowNumber: number;
  data: SpreadsheetRow;
}

export interface ParsedSheet {
  headers: string[];
  rows: SpreadsheetDataRow[];
  /** Linha de cabeçalho usada (0-based), para exibir/permitir troca. */
  headerRowIndex: number;
  /** true quando o arquivo excedeu MAX_GRID_ROWS e foi cortado. */
  truncated: boolean;
}

export interface SheetGrid {
  sheetNames: string[];
  activeSheet: string;
  grid: CellValue[][];
  truncated: boolean;
}

// ── Bases (Planilha A / Planilha B) ─────────────────────────────────────────

export interface LoadedFileMeta {
  name: string;
  sizeBytes: number;
  totalRows: number;
  totalColumns: number;
}

export interface ComparatorBaseState {
  label: string; // "Planilha A" / nome renomeado pelo usuário
  file: File | null;
  meta: LoadedFileMeta | null;
  sheetNames: string[];
  activeSheet: string | null;
  grid: CellValue[][];
  headerRowIndex: number;
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export function createEmptyBaseState(label: string): ComparatorBaseState {
  return { label, file: null, meta: null, sheetNames: [], activeSheet: null, grid: [], headerRowIndex: 0, truncated: false, loading: false, error: null };
}

// ── Preset (etapa 1) ─────────────────────────────────────────────────────────

export type ComparatorPresetId =
  | 'stock-physical-vs-system' | 'erp-vs-wms' | 'receiving-vs-invoice' | 'before-vs-after' | 'custom';

export interface ComparatorPreset {
  id: ComparatorPresetId;
  label: string;
  description: string;
  labelA: string;
  labelB: string;
}

// Sugestões de nome/rótulo — o usuário pode alterar qualquer campo depois de escolher.
export const COMPARATOR_PRESETS: ComparatorPreset[] = [
  { id: 'stock-physical-vs-system', label: 'Estoque físico × sistema', description: 'Compare a contagem física com o saldo do seu sistema/ERP.', labelA: 'Estoque físico', labelB: 'Sistema' },
  { id: 'erp-vs-wms', label: 'ERP × WMS', description: 'Compare os saldos do ERP com os do WMS.', labelA: 'ERP', labelB: 'WMS' },
  { id: 'receiving-vs-invoice', label: 'Recebimento × nota fiscal', description: 'Compare o que foi recebido com o que consta na NF-e.', labelA: 'Recebido', labelB: 'NF-e' },
  { id: 'before-vs-after', label: 'Antes × depois', description: 'Compare duas fotografias da mesma base em momentos diferentes.', labelA: 'Antes', labelB: 'Depois' },
  { id: 'custom', label: 'Comparação personalizada', description: 'Defina os nomes e o mapeamento do zero.', labelA: 'Planilha A', labelB: 'Planilha B' },
];

// ── Mapeamento de chave (etapa 3) ────────────────────────────────────────────

export interface KeyPartMapping {
  id: string;
  label: string;
  columnA: string | null;
  columnB: string | null;
}

// ── Mapeamento de campos (etapa 3) ───────────────────────────────────────────

export type FieldDataType = 'text' | 'number' | 'date' | 'auto';

export interface FieldMapping {
  id: string;
  label: string;
  columnA: string | null;
  columnB: string | null;
  dataType: FieldDataType;
  caseSensitive: boolean; // só para 'text'/'auto' resolvido como texto
  toleranceAbsolute: number; // só para 'number'
  tolerancePercent: number;  // só para 'number'
}

// ── Regras de comparação (etapa 4) ───────────────────────────────────────────

export type DuplicateStrategy = 'aggregate' | 'row-by-row';

export interface ComparisonSettings {
  duplicateStrategy: DuplicateStrategy;
  defaultCaseSensitive: boolean;
  defaultToleranceAbsolute: number;
  defaultTolerancePercent: number;
}

// ── Resultado (etapas 6/7) ───────────────────────────────────────────────────

export type ComparisonStatus =
  | 'equal' | 'divergent' | 'only-a' | 'only-b' | 'duplicate-a' | 'duplicate-b' | 'invalid';

export interface FieldComparisonResult {
  fieldId: string;
  label: string;
  dataType: Exclude<FieldDataType, 'auto'>;
  rawA: CellValue;
  rawB: CellValue;
  normalizedA: string | number | null;
  normalizedB: string | number | null;
  match: boolean;
  difference: number | null;        // numérico: B - A
  differencePercent: number | null; // numérico: (B - A) / |A| * 100
  toleranceAbsolute: number | null;
  tolerancePercent: number | null;
  note: string | null; // ex.: "valor numérico não interpretável"
}

export interface ComparisonRecord {
  id: string;
  keyValues: Record<string, CellValue>;
  keyDisplay: string;
  status: ComparisonStatus;
  fields: FieldComparisonResult[];
  sourceRowsA: number[];
  sourceRowsB: number[];
  duplicateGroupSizeA: number;
  duplicateGroupSizeB: number;
  invalidReason: string | null;
}

export interface FieldTotals {
  fieldId: string;
  label: string;
  netDifference: number;      // soma de (B - A)
  absoluteDifference: number; // soma de abs(B - A) — falta e sobra nunca se cancelam
}

export interface ComparisonSummary {
  totalRowsA: number;
  totalRowsB: number;
  uniqueKeys: number;
  equalCount: number;
  divergentCount: number;
  onlyACount: number;
  onlyBCount: number;
  duplicateACount: number;
  duplicateBCount: number;
  invalidCount: number;
  fieldTotals: FieldTotals[];
}

export interface ComparisonResult {
  records: ComparisonRecord[];
  summary: ComparisonSummary;
}

// ── Preferências (localStorage) ──────────────────────────────────────────────

export interface ComparatorPrefs {
  preset: ComparatorPresetId;
  defaultCaseSensitive: boolean;
  duplicateStrategy: DuplicateStrategy;
  defaultToleranceAbsolute: number;
  defaultTolerancePercent: number;
  visibleColumns: string[];
}
