// Exportação do Comparador — Excel (múltiplas abas), CSV e PDF (relatório
// executivo). Toda geração é local; nada é enviado ao Supabase ou a qualquer
// servidor. Protegido contra formula injection: qualquer valor que comece com
// =, +, -, @ (ou tab/CR, vetores menos comuns) é neutralizado como texto puro
// nas exportações CSV/Excel.

import { ComparisonRecord, ComparisonResult, ComparisonStatus, CellValue, KeyPartMapping, FieldMapping, ComparisonSettings } from './types';

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  equal: 'Igual', divergent: 'Divergente', 'only-a': 'Somente A', 'only-b': 'Somente B',
  'duplicate-a': 'Duplicado A', 'duplicate-b': 'Duplicado B', invalid: 'Inválido',
};

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/** Neutraliza valores que começariam com caractere de fórmula — CSV/Excel nunca reproduzem uma injeção. */
export function sanitizeExportValue(raw: CellValue): string {
  const value = raw === undefined || raw === null ? '' : String(raw);
  if (value.length === 0) return value;
  if (FORMULA_TRIGGER_CHARS.includes(value[0])) return `'${value}`;
  return value;
}

function csvCell(raw: CellValue): string {
  const value = sanitizeExportValue(raw);
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(cells: CellValue[]): string {
  return cells.map(csvCell).join(';');
}

function reasonForRecord(record: ComparisonRecord): string {
  if (record.status === 'invalid') return record.invalidReason ?? 'Registro inválido.';
  const divergentFields = record.fields.filter(f => !f.match);
  if (divergentFields.length === 0) return '';
  return divergentFields.map(f => `${f.label}: ${f.rawA ?? '—'} → ${f.rawB ?? '—'}`).join(' | ');
}

function recordToRow(record: ComparisonRecord, fields: FieldMapping[]): CellValue[] {
  const fieldCells = fields.flatMap(f => {
    const fr = record.fields.find(x => x.fieldId === f.id);
    return [fr?.rawA, fr?.rawB, fr?.difference ?? undefined];
  });
  return [
    record.keyDisplay,
    ...fieldCells,
    STATUS_LABEL[record.status],
    record.sourceRowsA.join(', '),
    record.sourceRowsB.join(', '),
    reasonForRecord(record),
  ];
}

function fieldHeaderCells(fields: FieldMapping[]): string[] {
  return fields.flatMap(f => [`${f.label} (A)`, `${f.label} (B)`, `${f.label} (Δ)`]);
}

export function buildResultCSV(records: ComparisonRecord[], fields: FieldMapping[]): string {
  const header = ['Chave', ...fieldHeaderCells(fields), 'Status', 'Linhas A', 'Linhas B', 'Motivo'];
  const lines = [csvLine(header), ...records.map(r => csvLine(recordToRow(r, fields)))];
  return lines.join('\n');
}

export interface ComparisonConfigSnapshot {
  labelA: string;
  labelB: string;
  fileNameA: string | null;
  fileNameB: string | null;
  keyParts: KeyPartMapping[];
  fields: FieldMapping[];
  settings: ComparisonSettings;
}

/** Workbook com uma aba por categoria + Resumo + Configuração utilizada. */
export async function buildResultWorkbook(result: ComparisonResult, config: ComparisonConfigSnapshot) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number)[][] = [
    ['Resumo da comparação', ''],
    ['Planilha A', config.labelA], ['Planilha B', config.labelB],
    ['Arquivo A', config.fileNameA ?? '—'], ['Arquivo B', config.fileNameB ?? '—'],
    ['Linhas na A', result.summary.totalRowsA], ['Linhas na B', result.summary.totalRowsB],
    ['Chaves únicas', result.summary.uniqueKeys],
    ['Iguais', result.summary.equalCount], ['Divergentes', result.summary.divergentCount],
    ['Somente na A', result.summary.onlyACount], ['Somente na B', result.summary.onlyBCount],
    ['Duplicados na A', result.summary.duplicateACount], ['Duplicados na B', result.summary.duplicateBCount],
    ['Inválidos', result.summary.invalidCount],
    ...result.summary.fieldTotals.flatMap(t => [
      [`${t.label} — diferença líquida`, t.netDifference],
      [`${t.label} — diferença absoluta`, t.absoluteDifference],
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(summaryRows)), 'Resumo');

  const header = ['Chave', ...fieldHeaderCells(config.fields), 'Status', 'Linhas A', 'Linhas B', 'Motivo'];
  const addSheet = (name: string, filter: (r: ComparisonRecord) => boolean) => {
    const rows = result.records.filter(filter).map(r => recordToRow(r, config.fields));
    const aoa = sanitizeAoa([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  };

  addSheet('Divergências', r => r.status === 'divergent');
  addSheet('Somente A', r => r.status === 'only-a');
  addSheet('Somente B', r => r.status === 'only-b');
  addSheet('Iguais', r => r.status === 'equal');
  addSheet('Duplicados A', r => r.duplicateGroupSizeA > 1);
  addSheet('Duplicados B', r => r.duplicateGroupSizeB > 1);
  addSheet('Inválidos', r => r.status === 'invalid');

  const configRows: (string | number)[][] = [
    ['Configuração utilizada', ''],
    ['Chave', config.keyParts.map(k => `${k.label} (A: ${k.columnA ?? '—'} / B: ${k.columnB ?? '—'})`).join(' + ')],
    ['Estratégia de duplicados', config.settings.duplicateStrategy === 'aggregate' ? 'Agrupar e somar' : 'Linha a linha'],
    ['Sensibilidade de texto padrão', config.settings.defaultCaseSensitive ? 'Exata' : 'Ignora maiúsculas/minúsculas'],
    ['Tolerância absoluta padrão', config.settings.defaultToleranceAbsolute],
    ['Tolerância percentual padrão', config.settings.defaultTolerancePercent],
    ...config.fields.map(f => [`Campo: ${f.label}`, `A: ${f.columnA ?? '—'} / B: ${f.columnB ?? '—'} / tipo: ${f.dataType}`]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sanitizeAoa(configRows)), 'Configuração utilizada');

  return wb;
}

/** Sanitiza toda a matriz antes de virar planilha — mesma proteção contra formula injection do CSV. */
function sanitizeAoa(aoa: CellValue[][]): CellValue[][] {
  return aoa.map(row => row.map(cell => (typeof cell === 'number' ? cell : sanitizeExportValue(cell))));
}

export function downloadTextFile(content: string, filename: string, type = 'text/csv;charset=utf-8') {
  const bom = '﻿';
  const blob = new Blob([bom + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadResultWorkbook(result: ComparisonResult, config: ComparisonConfigSnapshot, filename: string) {
  const XLSX = await import('xlsx');
  const wb = await buildResultWorkbook(result, config);
  XLSX.writeFile(wb, filename);
}

// ── PDF — relatório executivo, não milhares de linhas ────────────────────────

export interface PdfReportOptions {
  comparisonName: string;
  generatedAt: Date;
  config: ComparisonConfigSnapshot;
  result: ComparisonResult;
  topDivergences: ComparisonRecord[]; // já limitado pelo chamador (ex.: 15 maiores)
}

export async function buildAndDownloadPdfReport(options: PdfReportOptions) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 15;
  let y = 18;

  const line = (text: string, size = 10, bold = false) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(text, marginX, y);
    y += size * 0.5 + 2;
  };

  line('Comparador de Planilhas — Relatório Executivo', 16, true);
  line(options.comparisonName || 'Comparação sem nome', 12, true);
  line(`Gerado em ${options.generatedAt.toLocaleString('pt-BR')}`, 9);
  y += 3;

  line('Arquivos utilizados', 12, true);
  line(`${options.config.labelA}: ${options.config.fileNameA ?? '—'}`);
  line(`${options.config.labelB}: ${options.config.fileNameB ?? '—'}`);
  y += 2;

  line('Regras principais', 12, true);
  line(`Chave: ${options.config.keyParts.map(k => k.label).join(' + ') || '—'}`);
  line(`Duplicados: ${options.config.settings.duplicateStrategy === 'aggregate' ? 'Agrupar e somar' : 'Linha a linha'}`);
  line(`Texto: ${options.config.settings.defaultCaseSensitive ? 'Exata' : 'Ignora maiúsculas/minúsculas'} · Tolerância: ${options.config.settings.defaultToleranceAbsolute} (absoluta) / ${options.config.settings.defaultTolerancePercent}% (percentual)`);
  y += 2;

  const s = options.result.summary;
  line('Indicadores', 12, true);
  line(`Linhas A: ${s.totalRowsA}  ·  Linhas B: ${s.totalRowsB}  ·  Chaves únicas: ${s.uniqueKeys}`);
  line(`Iguais: ${s.equalCount}  ·  Divergentes: ${s.divergentCount}  ·  Somente A: ${s.onlyACount}  ·  Somente B: ${s.onlyBCount}`);
  line(`Duplicados A: ${s.duplicateACount}  ·  Duplicados B: ${s.duplicateBCount}  ·  Inválidos: ${s.invalidCount}`);
  s.fieldTotals.forEach(t => line(`${t.label} — diferença líquida: ${t.netDifference.toLocaleString('pt-BR')}  ·  diferença absoluta: ${t.absoluteDifference.toLocaleString('pt-BR')}`));
  y += 2;

  line('Principais divergências', 12, true);
  if (options.topDivergences.length === 0) {
    line('Nenhuma divergência encontrada.');
  } else {
    options.topDivergences.forEach(r => {
      if (y > 270) { doc.addPage(); y = 18; }
      const detail = r.fields.filter(f => !f.match).map(f => `${f.label} ${f.rawA ?? '—'}→${f.rawB ?? '—'}`).join(', ');
      line(`${sanitizeExportValue(r.keyDisplay)} — ${detail || STATUS_LABEL[r.status]}`, 9);
    });
  }

  y += 4;
  if (y > 270) { doc.addPage(); y = 18; }
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text('Para os dados linha a linha completos, exporte em Excel ou CSV.', marginX, y);

  doc.save(`${(options.comparisonName || 'comparacao').replace(/[^a-z0-9-_]/gi, '_')}.pdf`);
}
