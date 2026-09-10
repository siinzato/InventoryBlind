// Exportação em Excel do lote (spec §10) — Resumo/Resultados/Alertas/
// Inválidos/Parâmetros, uma aba cada. Reaproveita a sanitização contra
// Formula Injection já existente e testada no Comparador de Planilhas —
// mesma técnica (prefixa `'` em valor que começa com caractere de fórmula),
// só a montagem das linhas é própria desta ferramenta.

import { sanitizeExportValue } from '../spreadsheet-comparator/exportUtils';
import type { BatchSummary } from './batchProcessor';

type Cell = string | number;

function sanitizeAoa(aoa: Cell[][]): Cell[][] {
  return aoa.map(row => row.map(cell => (typeof cell === 'number' ? cell : sanitizeExportValue(cell))));
}

function summarySheet(summary: BatchSummary): Cell[][] {
  return [
    ['Resumo do lote — Calculadora de Paletização', ''],
    ['Total de linhas', summary.total],
    ['Processados', summary.processed],
    ['Processados com alerta', summary.processedWithAlerts],
    ['Sem solução geométrica', summary.noSolution],
    ['Inválidos', summary.invalid],
  ];
}

function resultsSheet(summary: BatchSummary): Cell[][] {
  const header = [
    'Linha', 'SKU', 'Status', 'Palete', 'Padrão', 'Caixas/camada', 'Camadas', 'Caixas/palete',
    'Paletes cheios', 'Último palete', 'Total de paletes', 'Ocupação (%)', 'Peso bruto (kg)', 'Altura total (mm)',
  ];
  const rows = summary.rows.filter(r => r.result).map(r => {
    const rec = r.result!.recommended;
    return [
      r.rowNumber, r.sku ?? '', r.status, r.result!.pallet.name, rec.pattern.label,
      rec.pattern.boxesPerLayer, rec.layers.layers, rec.capacityPerPallet,
      rec.palletsNeeded.fullPallets, rec.palletsNeeded.lastPalletQty, rec.palletsNeeded.totalPallets,
      Number(rec.pattern.occupationPct.toFixed(1)), Number(rec.grossKg.toFixed(1)), Number(rec.totalHeightMm.toFixed(0)),
    ] as Cell[];
  });
  return [header, ...rows];
}

function alertsSheet(summary: BatchSummary): Cell[][] {
  const header = ['Linha', 'SKU', 'Severidade', 'Alerta'];
  const rows = summary.rows.flatMap(r =>
    (r.result?.recommended.alerts ?? []).map(a => [r.rowNumber, r.sku ?? '', a.severity, a.message] as Cell[])
  );
  return [header, ...rows];
}

function invalidSheet(summary: BatchSummary): Cell[][] {
  const header = ['Linha', 'SKU', 'Motivo'];
  const rows = summary.rows
    .filter(r => r.status === 'invalid' || r.status === 'no-solution')
    .flatMap(r => (r.errors.length > 0 ? r.errors : ['Nenhuma caixa cabe no palete configurado.']).map(msg => [r.rowNumber, r.sku ?? '', msg] as Cell[]));
  return [header, ...rows];
}

function parametersSheet(summary: BatchSummary): Cell[][] {
  const first = summary.rows.find(r => r.result)?.result;
  if (!first) return [['Parâmetro', 'Valor']];
  return [
    ['Parâmetro', 'Valor'],
    ['Palete (referência da primeira linha calculada)', first.pallet.name],
    ['Comprimento do palete (mm)', first.pallet.lengthMm],
    ['Largura do palete (mm)', first.pallet.widthMm],
    ['Altura do palete (mm)', first.pallet.heightMm],
    ['Tara (kg)', first.pallet.tareKg],
    ['Capacidade máxima de carga (kg)', first.pallet.maxLoadKg],
    ['Altura total máxima (mm)', first.pallet.maxTotalHeightMm],
  ];
}

export async function buildBatchWorkbook(summary: BatchSummary) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(summarySheet(summary))), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(resultsSheet(summary))), 'Resultados');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(alertsSheet(summary))), 'Alertas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(invalidSheet(summary))), 'Inválidos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(parametersSheet(summary))), 'Parâmetros');
  return wb;
}

export async function downloadBatchWorkbook(summary: BatchSummary, filename: string): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = await buildBatchWorkbook(summary);
  XLSX.writeFile(wb, filename);
}
