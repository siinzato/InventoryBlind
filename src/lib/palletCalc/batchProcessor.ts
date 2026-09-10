// Processamento em lote (spec §9) — uma linha inválida NUNCA para o lote;
// chunked com yield ao event loop pro navegador não travar em arquivos
// grandes (mesmo padrão de src/lib/barcode/barcodeBatchUtils.ts, já que este
// projeto não usa Web Worker em lugar nenhum — ver auditoria).

import { calculatePallet, type PalletCalcResult } from './calculatePallet';
import { parseBatchRow, type BatchMappedRow } from './batchRowParser';
import type { CustomPalletPreset } from './palletCalcPrefs';

export type BatchRowStatus = 'ok' | 'ok-with-alerts' | 'invalid' | 'no-solution';

export interface BatchRowOutcome {
  rowNumber: number;
  sku?: string;
  status: BatchRowStatus;
  result?: PalletCalcResult;
  errors: string[];
}

export interface BatchSummary {
  total: number;
  processed: number;
  processedWithAlerts: number;
  invalid: number;
  noSolution: number;
  rows: BatchRowOutcome[];
}

const CHUNK_SIZE = 500;

export interface SourcedRow {
  sourceRowNumber: number;
  row: BatchMappedRow;
}

function processOneRow(sourced: SourcedRow, customPallets: CustomPalletPreset[]): BatchRowOutcome {
  const sku = sourced.row.sku != null ? String(sourced.row.sku) : undefined;
  try {
    const parsed = parseBatchRow(sourced.row, customPallets);
    if (!parsed.ok) {
      return { rowNumber: sourced.sourceRowNumber, sku, status: 'invalid', errors: parsed.errors };
    }

    const result = calculatePallet(parsed.box!, parsed.pallet!);
    if (result.recommended.pattern.boxesPerLayer === 0) {
      return { rowNumber: sourced.sourceRowNumber, sku, status: 'no-solution', result, errors: [] };
    }

    return {
      rowNumber: sourced.sourceRowNumber, sku, result, errors: [],
      status: result.recommended.alerts.length > 0 ? 'ok-with-alerts' : 'ok',
    };
  } catch (err) {
    return { rowNumber: sourced.sourceRowNumber, sku, status: 'invalid', errors: [err instanceof Error ? err.message : 'Falha inesperada ao calcular esta linha.'] };
  }
}

export async function processBatchRows(
  sourcedRows: SourcedRow[],
  customPallets: CustomPalletPreset[],
  onProgress?: (done: number, total: number) => void
): Promise<BatchSummary> {
  const rows: BatchRowOutcome[] = [];

  for (let start = 0; start < sourcedRows.length; start += CHUNK_SIZE) {
    const chunk = sourcedRows.slice(start, start + CHUNK_SIZE);
    for (const sourced of chunk) rows.push(processOneRow(sourced, customPallets));

    onProgress?.(Math.min(start + CHUNK_SIZE, sourcedRows.length), sourcedRows.length);
    if (start + CHUNK_SIZE < sourcedRows.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return {
    total: rows.length,
    processed: rows.filter(r => r.status === 'ok').length,
    processedWithAlerts: rows.filter(r => r.status === 'ok-with-alerts').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    noSolution: rows.filter(r => r.status === 'no-solution').length,
    rows,
  };
}
