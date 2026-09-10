// Emitir Relatório — saída física: CSS de impressão, PDF e Excel.
//
// Os três formatos representam o MESMO documento: A4 paisagem, cabeçalho de
// duas linhas, grade completa e tabela compacta — a folha operacional do
// estoque, não um documento corporativo.
//
// Impressão: mesma técnica já usada por src/lib/palletCalc/palletPrint.ts e
// src/lib/barcode/barcodeExport.ts — injeta um `@media print` que esconde o
// resto da página (sidebar, header, filtros, botões) e mostra só a folha, sem
// abrir nova janela. A área é montada por um portal React em `document.body`
// (por isso o seletor `body > *`), e só existe enquanto a impressão acontece.
//
// PDF: jsPDF em landscape por cursor de texto, como src/lib/palletCalc/
// palletExportPdf.ts. Sem html2canvas: a folha é tabela de texto, então o PDF
// sai vetorial e leve.
//
// Excel: xlsx (SheetJS), a mesma dependência já usada por FullNewOperation e
// NFeReportView. Nenhuma biblioteca nova.

import {
  formatBalanceCell,
  formatEanCell,
  formatLocationCell,
  truncateProductName,
} from './inventoryReportAlgorithm';
import type { InventoryReportRow, ReportMeta } from './inventoryReportTypes';

export const REPORT_PRINT_AREA_ID = '_ib_inventory_report_print_area';
const PRINT_STYLE_ID = '_ib_inventory_report_print_style';

/** A4 paisagem sobra largura, então SKU/EAN/Local não precisam apertar o
 *  Produto — e a coluna de anotação à caneta ganha espaço de verdade. */
export const COLUMN_WIDTHS_PERCENT = {
  product: 43,
  sku: 16,
  ean: 17,
  location: 13,
  balance: 11,
} as const;

/** Rótulos da grade, na ordem das colunas — uma fonte só para HTML, PDF e Excel. */
export const COLUMN_LABELS = ['Produto', 'SKU', 'EAN', 'Local', 'Saldo / Contagem'] as const;

export function injectReportPrintStyle(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    #${REPORT_PRINT_AREA_ID} { display: none; }
    @media print {
      @page { size: A4 landscape; margin: 6mm 8mm; }
      html, body { background: #fff !important; }
      body > *:not(#${REPORT_PRINT_AREA_ID}) { display: none !important; }
      #${REPORT_PRINT_AREA_ID} { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}

export function removeReportPrintStyle(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
}

export function formatEmissionTimestamp(date: Date): string {
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function reportFilename(emittedAt: Date, extension: 'pdf' | 'xlsx' | 'xls'): string {
  const stamp = emittedAt.toISOString().slice(0, 10);
  return `relatorio-contagem-${stamp}.${extension}`;
}

// PDF — A4 paisagem ──────────────────────────────────────────────────────────

const PAGE_WIDTH = 297;
const PAGE_HEIGHT = 210;
const MARGIN_X = 8;
const MARGIN_TOP = 6;
const MARGIN_BOTTOM = 6;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
/** Altura fixa da linha: compacta como a folha de referência, ainda legível. */
const ROW_HEIGHT = 4.3;
const HEAD_HEIGHT = 4.8;
const ROW_FONT_SIZE = 8.5;
const HEAD_FONT_SIZE = 8.5;
const GRID_WIDTH = 0.15;

const COLUMN_MM = [
  (CONTENT_WIDTH * COLUMN_WIDTHS_PERCENT.product) / 100,
  (CONTENT_WIDTH * COLUMN_WIDTHS_PERCENT.sku) / 100,
  (CONTENT_WIDTH * COLUMN_WIDTHS_PERCENT.ean) / 100,
  (CONTENT_WIDTH * COLUMN_WIDTHS_PERCENT.location) / 100,
  (CONTENT_WIDTH * COLUMN_WIDTHS_PERCENT.balance) / 100,
];

function columnX(index: number): number {
  let x = MARGIN_X;
  for (let i = 0; i < index; i++) x += COLUMN_MM[i];
  return x;
}

/**
 * PDF equivalente à impressão: A4 paisagem, grade completa (horizontais e
 * verticais), cabeçalho mínimo de duas linhas, cabeçalho de tabela repetido em
 * toda página e "Página X de Y" discreto no pé.
 */
export async function downloadInventoryReportPdf(
  meta: ReportMeta,
  rows: InventoryReportRow[]
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  // Explícito: nunca depender da orientação padrão do navegador/diálogo.
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });

  /** Cabeçalho da emissão: duas linhas, ~11mm. Todo o resto é produto. */
  const drawSheetHeader = (): number => {
    let y = MARGIN_TOP + 3.4;
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.text('InventoryBlind - Relatório de Contagem', MARGIN_X, y);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `${meta.productCount} produtos  •  ${meta.locationCount} endereços`,
      MARGIN_X + CONTENT_WIDTH,
      y,
      { align: 'right' }
    );
    y += 4;
    doc.text(
      `Workspace: ${meta.workspaceName}    |    ${meta.filterDescription}    |    Emissão: ${formatEmissionTimestamp(meta.emittedAt)}`,
      MARGIN_X,
      y,
      { maxWidth: CONTENT_WIDTH }
    );
    return y + 3;
  };

  /** Faixa de cabeçalho da tabela, com a grade já fechada. */
  const drawTableHead = (y: number): number => {
    doc.setFontSize(HEAD_FONT_SIZE);
    doc.setFont('helvetica', 'bold');
    doc.setLineWidth(GRID_WIDTH);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, HEAD_HEIGHT);
    COLUMN_LABELS.forEach((label, index) => {
      if (index > 0) {
        const x = columnX(index);
        doc.line(x, y, x, y + HEAD_HEIGHT);
      }
      doc.text(label, columnX(index) + 1.2, y + HEAD_HEIGHT - 1.5);
    });
    return y + HEAD_HEIGHT;
  };

  const pageBottom = PAGE_HEIGHT - MARGIN_BOTTOM - 4;
  let y = drawTableHead(drawSheetHeader());
  let currentGroup: string | null = null;

  /** Uma linha da grade: retângulo externo + separadores verticais + texto. */
  const drawRow = (cells: string[], height: number, bold = false, span = false) => {
    doc.setLineWidth(GRID_WIDTH);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, height);
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    if (span) {
      doc.text(cells[0], MARGIN_X + 1.2, y + height - 1.3);
    } else {
      cells.forEach((cell, index) => {
        if (index > 0) {
          const x = columnX(index);
          doc.line(x, y, x, y + height);
        }
        if (cell !== '') doc.text(cell, columnX(index) + 1.2, y + height - 1.3);
      });
    }
    y += height;
  };

  for (const row of rows) {
    const needsGroupHeading = row.groupLabel !== null && row.groupLabel !== currentGroup;
    const needed = ROW_HEIGHT + (needsGroupHeading ? ROW_HEIGHT : 0);

    if (y + needed > pageBottom) {
      doc.addPage();
      y = drawTableHead(MARGIN_TOP + 2);
      if (currentGroup !== null && !needsGroupHeading) {
        drawRow([`${currentGroup} (continuação)`], ROW_HEIGHT, true, true);
      }
    }

    if (needsGroupHeading) {
      currentGroup = row.groupLabel;
      drawRow([row.groupLabel ?? ''], ROW_HEIGHT, true, true);
    }

    // Truncagem medida na fonte real: o nome fica em UMA linha sempre.
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setFont('helvetica', 'normal');
    let name = row.name.trim().replace(/\s+/g, ' ') || '—';
    const maxNameWidth = COLUMN_MM[0] - 2.4;
    if (doc.getTextWidth(name) > maxNameWidth) {
      const perChar = doc.getTextWidth(name) / name.length;
      name = truncateProductName(name, Math.max(8, Math.floor(maxNameWidth / perChar)));
      while (name.length > 2 && doc.getTextWidth(name) > maxNameWidth) {
        name = `${name.slice(0, -2)}…`;
      }
    }

    drawRow(
      [
        name,
        row.sku || '—',
        formatEanCell(row.ean),
        formatLocationCell(row.location),
        // Vazio de propósito quando não há saldo: a célula é para caneta.
        formatBalanceCell(row),
      ],
      ROW_HEIGHT
    );
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`Página ${page} de ${total}`, MARGIN_X + CONTENT_WIDTH, PAGE_HEIGHT - 3, {
      align: 'right',
    });
  }

  doc.save(reportFilename(meta.emittedAt, 'pdf'));
}

// Excel ─────────────────────────────────────────────────────────────────────

/**
 * Exporta exatamente as linhas da pré-visualização, na mesma ordem (por local
 * ou por marca — a ordenação já vem resolvida em `rows`).
 *
 * SKU, EAN e Local são gravados como TEXTO (`t: 's'`). É o requisito crítico:
 * gravados como número, o Excel comeria o zero inicial de "0070341856000" e
 * mostraria EAN de 13 dígitos em notação científica. O saldo importado também
 * vai como texto para preservar o que veio da planilha (zeros à esquerda,
 * negativos, anotações), e célula sem saldo fica realmente vazia — não "0",
 * não "-".
 */
export async function downloadInventoryReportExcel(
  meta: ReportMeta,
  rows: InventoryReportRow[],
  bookType: 'xlsx' | 'xls' = 'xlsx'
): Promise<void> {
  const XLSX = await import('xlsx');

  const header = [...COLUMN_LABELS];
  const aoa: (string | undefined)[][] = [
    header,
    ...rows.map(row => [
      row.name.trim() || '',
      row.sku || '',
      row.ean ?? '',
      row.location ?? '',
      formatBalanceCell(row) || undefined,
    ]),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  // Força tipo texto em toda célula de dado (aoa_to_sheet infere número em
  // string numérica, e é exatamente isso que corromperia EAN e SKU).
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address];
      if (!cell || cell.v === undefined || cell.v === '') continue;
      cell.t = 's';
      cell.v = String(cell.v);
      cell.z = '@';
    }
  }

  sheet['!cols'] = [{ wch: 60 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Contagem');

  // Metadados da emissão numa segunda aba, para a primeira ser só a tabela
  // (é ela que o operador imprime ou cola em outro lugar).
  const info = XLSX.utils.aoa_to_sheet([
    ['Relatório de Contagem Física'],
    ['Workspace', meta.workspaceName],
    ['Filtro', meta.filterDescription],
    ['Emissão', formatEmissionTimestamp(meta.emittedAt)],
    ['Produtos', String(meta.productCount)],
    ['Endereços', String(meta.locationCount)],
  ]);
  info['!cols'] = [{ wch: 16 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(book, info, 'Emissão');

  XLSX.writeFile(book, reportFilename(meta.emittedAt, bookType), { bookType });
}
