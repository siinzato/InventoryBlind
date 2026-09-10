// CSV dos resultados (spec §10) — mesma sanitização contra Formula Injection
// do Excel (spec §10/§12: "proteger exportações"), formato ";"-delimitado
// igual ao resto do projeto (barcodeBatchErrorsToCSV, exportUtils.ts).

import { sanitizeExportValue } from '../spreadsheet-comparator/exportUtils';
import type { BatchSummary } from './batchProcessor';

function csvCell(raw: string | number | undefined): string {
  const value = sanitizeExportValue(raw);
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(cells: Array<string | number | undefined>): string {
  return cells.map(csvCell).join(';');
}

export function buildBatchResultsCsv(summary: BatchSummary): string {
  const header = ['Linha', 'SKU', 'Status', 'Padrão', 'Caixas/camada', 'Camadas', 'Caixas/palete', 'Total de paletes', 'Último palete', 'Ocupação (%)', 'Peso bruto (kg)', 'Alertas'];
  const lines = summary.rows.map(r => {
    const rec = r.result?.recommended;
    return csvLine([
      r.rowNumber, r.sku ?? '', r.status, rec?.pattern.label ?? '',
      rec?.pattern.boxesPerLayer ?? '', rec?.layers.layers ?? '', rec?.capacityPerPallet ?? '',
      rec?.palletsNeeded.totalPallets ?? '', rec?.palletsNeeded.lastPalletQty ?? '',
      rec ? Number(rec.pattern.occupationPct.toFixed(1)) : '', rec ? Number(rec.grossKg.toFixed(1)) : '',
      rec ? rec.alerts.map(a => a.message).join(' | ') : (r.errors.join(' | ') || ''),
    ]);
  });
  return [csvLine(header), ...lines].join('\n');
}

export function downloadCsvText(content: string, filename: string): void {
  const bom = '﻿';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
