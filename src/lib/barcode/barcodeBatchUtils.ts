// Utilitários do modo "Em lote" do Laboratório de Códigos de Barras.
//
// O detector de colunas por fuzzy-match (Levenshtein) já existe em
// productImportUtils.ts, mas hardcoded para os campos de produto — o mesmo
// caso já enfrentado por countManagementUtils.ts ("Mirrors the patterns in
// productImportUtils.ts without modifying that file"). Seguimos o mesmo
// precedente aqui: mesmo algoritmo, campos próprios do lote de código de barras.
// parseCSV é genérico e É reaproveitado diretamente de productImportUtils.ts.

import { parseCSV } from '../productImportUtils';
import { BarcodeSymbology, BARCODE_SYMBOLOGIES } from './barcodeTypes';
import { validateBarcodeValue } from './barcodeValidation';

export interface BarcodeRow {
  [key: string]: string | number | undefined;
}

export const BARCODE_BATCH_FIELDS = [
  { key: 'value', label: 'Valor do Código', required: true, aliases: ['valor', 'codigo', 'código', 'value', 'code', 'barcode', 'ean', 'conteudo', 'conteúdo'] },
  { key: 'symbology', label: 'Tipo do Código', required: false, aliases: ['tipo', 'symbology', 'formato', 'type', 'tipodecodigo'] },
  { key: 'name', label: 'Nome', required: false, aliases: ['nome', 'produto', 'name', 'descricao', 'descrição'] },
  { key: 'sku', label: 'SKU', required: false, aliases: ['sku', 'codigointerno', 'ref', 'referencia'] },
  { key: 'location', label: 'Localização', required: false, aliases: ['local', 'localizacao', 'localização', 'location', 'endereco', 'endereço'] },
  { key: 'lot', label: 'Lote', required: false, aliases: ['lote', 'lot', 'batch'] },
  { key: 'expiry', label: 'Validade', required: false, aliases: ['validade', 'vencimento', 'expiry', 'venc'] },
  { key: 'quantity', label: 'Quantidade', required: false, aliases: ['quantidade', 'qty', 'quantity', 'qtd'] },
  { key: 'copies', label: 'Cópias', required: false, aliases: ['copias', 'cópias', 'copies', 'numerodecopias', 'qtdcopias'] },
] as const;

export type BarcodeBatchFieldKey = typeof BARCODE_BATCH_FIELDS[number]['key'];

export type BarcodeColumnMapping = Record<BarcodeBatchFieldKey, string | null>;

export interface DetectedBarcodeColumn {
  name: string;
  detectedField: BarcodeBatchFieldKey | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

export function detectBarcodeColumnMappings(headers: string[]): DetectedBarcodeColumn[] {
  return headers.map(header => {
    const norm = normalize(header);
    let best: { field: BarcodeBatchFieldKey; confidence: DetectedBarcodeColumn['confidence'] } | null = null;

    for (const field of BARCODE_BATCH_FIELDS) {
      for (const alias of field.aliases) {
        const normAlias = normalize(alias);
        if (norm === normAlias) { best = { field: field.key, confidence: 'high' }; break; }
        if (!best && (norm.includes(normAlias) || normAlias.includes(norm))) {
          best = { field: field.key, confidence: 'medium' };
        }
        if (!best && levenshteinDistance(norm, normAlias) <= 2 && norm.length > 2) {
          best = { field: field.key, confidence: 'low' };
        }
      }
      if (best?.confidence === 'high') break;
    }

    return { name: header, detectedField: best?.field ?? null, confidence: best?.confidence ?? 'none' };
  });
}

export function suggestBarcodeMapping(detected: DetectedBarcodeColumn[]): BarcodeColumnMapping {
  const mapping = Object.fromEntries(BARCODE_BATCH_FIELDS.map(f => [f.key, null])) as BarcodeColumnMapping;
  detected.forEach(d => {
    if (d.detectedField && d.confidence !== 'none' && !mapping[d.detectedField]) {
      mapping[d.detectedField] = d.name;
    }
  });
  return mapping;
}

export function applyBarcodeColumnMapping(rawRows: BarcodeRow[], mapping: BarcodeColumnMapping): BarcodeRow[] {
  return rawRows.map(row => {
    const mapped: BarcodeRow = {};
    for (const field of BARCODE_BATCH_FIELDS) {
      const sourceCol = mapping[field.key];
      mapped[field.key] = sourceCol ? row[sourceCol] : undefined;
    }
    return mapped;
  });
}

/** Espelha o parser inline usado em ProductImportPage.tsx/countManagementUtils.ts — não há um parser XLSX compartilhado. */
export async function parseBarcodeBatchFile(file: File): Promise<{ headers: string[]; rows: BarcodeRow[] }> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    return parseCSV(text);
  }
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows2d = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  if (rows2d.length === 0) return { headers: [], rows: [] };
  const headers = (rows2d[0] || []).map(h => String(h ?? '').trim());
  const rows: BarcodeRow[] = rows2d.slice(1)
    .filter(r => r.some(cell => cell !== undefined && cell !== ''))
    .map(r => {
      const row: BarcodeRow = {};
      headers.forEach((h, i) => { row[h] = r[i]; });
      return row;
    });
  return { headers, rows };
}

// ── Validação de linhas do lote ──────────────────────────────────────────────

export type BarcodeBatchRowStatus = 'valid' | 'invalid' | 'duplicate';

export interface BarcodeBatchRow {
  rowIndex: number;
  value: string;
  symbology: BarcodeSymbology;
  name: string;
  sku: string;
  location: string;
  lot: string;
  expiry: string;
  quantity: string;
  copies: number;
  status: BarcodeBatchRowStatus;
  correctedValue: string | null;
  error: string | null;
}

const SYMBOLOGY_IDS = new Set(BARCODE_SYMBOLOGIES.map(s => s.id));

function resolveSymbology(raw: unknown, globalSymbology: BarcodeSymbology | null): BarcodeSymbology | null {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[\s-]/g, '');
  const bySymbol = BARCODE_SYMBOLOGIES.find(s => s.id === text || normalize(s.label) === normalize(text));
  if (bySymbol) return bySymbol.id;
  if (globalSymbology) return globalSymbology;
  return null;
}

const CHUNK_SIZE = 500;

/**
 * Valida cada linha (dígito verificador, formato) e depois marca duplicados
 * dentro do próprio lote. Processado em chunks com yield ao event loop para
 * não travar a UI em arquivos grandes — mesmo padrão de processRawProducts.
 */
export async function processBarcodeBatchRows(
  rawRows: BarcodeRow[],
  globalSymbology: BarcodeSymbology | null,
  onProgress?: (done: number, total: number) => void
): Promise<BarcodeBatchRow[]> {
  const results: BarcodeBatchRow[] = [];

  for (let start = 0; start < rawRows.length; start += CHUNK_SIZE) {
    const chunk = rawRows.slice(start, start + CHUNK_SIZE);
    chunk.forEach((row, i) => {
      const rowIndex = start + i;
      const value = String(row.value ?? '').trim();
      const symbology = resolveSymbology(row.symbology, globalSymbology);
      const copiesRaw = Number(row.copies);
      const copies = Number.isFinite(copiesRaw) && copiesRaw > 0 ? Math.floor(copiesRaw) : 1;

      const base = {
        rowIndex,
        value,
        name: String(row.name ?? '').trim(),
        sku: String(row.sku ?? '').trim(),
        location: String(row.location ?? '').trim(),
        lot: String(row.lot ?? '').trim(),
        expiry: String(row.expiry ?? '').trim(),
        quantity: String(row.quantity ?? '').trim(),
        copies,
      };

      if (!value) {
        results.push({ ...base, symbology: symbology ?? 'code128', status: 'invalid', correctedValue: null, error: 'Valor do código vazio.' });
        return;
      }
      if (!symbology || !SYMBOLOGY_IDS.has(symbology)) {
        results.push({ ...base, symbology: 'code128', status: 'invalid', correctedValue: null, error: 'Tipo de código não informado ou desconhecido.' });
        return;
      }

      const validation = validateBarcodeValue(symbology, value);
      results.push({
        ...base,
        symbology,
        status: validation.ok ? 'valid' : 'invalid',
        correctedValue: validation.correctedValue,
        error: validation.error,
      });
    });

    onProgress?.(Math.min(start + CHUNK_SIZE, rawRows.length), rawRows.length);
    if (start + CHUNK_SIZE < rawRows.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  markDuplicates(results);
  return results;
}

/** Marca como duplicado (sem perder o motivo de erro) qualquer código final repetido entre linhas válidas. */
function markDuplicates(rows: BarcodeBatchRow[]): void {
  const counts = new Map<string, number>();
  rows.forEach(r => {
    if (r.status !== 'valid' || !r.correctedValue) return;
    const key = `${r.symbology}:${r.correctedValue}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  rows.forEach(r => {
    if (r.status !== 'valid' || !r.correctedValue) return;
    const key = `${r.symbology}:${r.correctedValue}`;
    if ((counts.get(key) ?? 0) > 1) r.status = 'duplicate';
  });
}

export interface BarcodeBatchSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  totalLabels: number; // soma de cópias das linhas válidas
}

export function summarizeBarcodeBatch(rows: BarcodeBatchRow[]): BarcodeBatchSummary {
  const valid = rows.filter(r => r.status === 'valid');
  return {
    total: rows.length,
    valid: valid.length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    duplicate: rows.filter(r => r.status === 'duplicate').length,
    totalLabels: valid.reduce((sum, r) => sum + r.copies, 0),
  };
}

/** ";"-delimitado, mesmo formato de exportErrorsToCSV — para as linhas inválidas/duplicadas baixarem como relatório. */
export function barcodeBatchErrorsToCSV(rows: BarcodeBatchRow[]): string {
  const header = 'Linha;Valor;Tipo;Status;Erro';
  const lines = rows
    .filter(r => r.status !== 'valid')
    .map(r => [r.rowIndex + 1, r.value, r.symbology, r.status === 'duplicate' ? 'Duplicado' : 'Inválido', r.error ?? (r.status === 'duplicate' ? 'Código já usado em outra linha.' : '')]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  return [header, ...lines].join('\n');
}
