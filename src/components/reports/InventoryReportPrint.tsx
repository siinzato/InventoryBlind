// A folha operacional de contagem — UM componente, usado pela pré-visualização
// e pela impressão, para preview/impressão/PDF nunca divergirem.
//
// Formato: A4 PAISAGEM, grade completa (linhas horizontais e verticais),
// cabeçalho de duas linhas e tabela compacta — praticamente a folha do Tiny que
// o time já usa na prancheta. Deliberadamente sem card, sombra, fundo colorido
// ou qualquer decoração de SaaS dentro da folha.
//
// As medidas estão em mm/pt (não em px nem em tokens do design system) porque
// isto é papel: o que a tela mostra é exatamente o que a impressora recebe. As
// cores são literais (#000/#fff) para sair legível em preto e branco mesmo com
// o app em tema escuro.

import { Fragment } from 'react';
import {
  formatBalanceCell,
  formatEanCell,
  formatLocationCell,
  paginateReportRows,
} from '../../lib/reports/inventoryReportAlgorithm';
import {
  COLUMN_LABELS,
  COLUMN_WIDTHS_PERCENT,
  REPORT_PRINT_AREA_ID,
  formatEmissionTimestamp,
} from '../../lib/reports/inventoryReportOutput';
import type { InventoryReportRow, ReportMeta } from '../../lib/reports/inventoryReportTypes';

/** Largura útil de uma A4 deitada com margem de 8mm: 297 - 16. */
export const SHEET_CONTENT_WIDTH_MM = 281;

export const REPORT_SHEET_CSS = `
/* index.css aplica "* { max-width: 100% }" em todo o app para nenhum container
   vazar na horizontal. Aqui a folha TEM largura fixa de papel (297mm), então a
   regra global precisa ser neutralizada só neste documento — sem tocar no reset. */
.ib-rep-doc, .ib-rep-doc * { max-width: none; }
.ib-rep-doc { color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
.ib-rep-sheet { width: ${SHEET_CONTENT_WIDTH_MM}mm; }
.ib-rep-sheet + .ib-rep-sheet { margin-top: 8mm; }

/* Cabeçalho mínimo: duas linhas e a tabela já começa. */
.ib-rep-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6mm; }
.ib-rep-title { font-size: 9.5pt; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.ib-rep-tally { font-size: 7.5pt; white-space: nowrap; }
.ib-rep-sub { font-size: 7.5pt; margin: 0.6mm 0 1.4mm; }
.ib-rep-sub span + span::before { content: "|"; margin: 0 2mm; color: #666; }

/* Grade real: colapsada, uma linha fina em toda célula. */
.ib-rep-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ib-rep-table th, .ib-rep-table td {
  border: 0.15mm solid #000;
  padding: 0.3mm 1.1mm;
  font-size: 8.5pt;
  line-height: 1.1;
  height: 4.2mm;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.ib-rep-table th { font-weight: 700; text-align: left; }
.ib-rep-mono { font-family: "Courier New", Courier, monospace; font-size: 8pt; }
/* Célula de anotação: fica COMPLETAMENTE em branco quando não há saldo. */
.ib-rep-balance { text-align: left; }
.ib-rep-group td { font-weight: 700; font-size: 8.5pt; }
.ib-rep-foot { font-size: 6.5pt; text-align: right; margin-top: 1mm; }

/* Controles só de tela — nunca no papel. */
/* O botão de remover fica na margem da folha, fora da grade. O ancestral
   posicionado é a LINHA (não a célula): a célula tem overflow:hidden para o
   nome truncar com reticências, e um absoluto ancorado nela seria recortado. */
.ib-rep-table tbody tr { position: relative; }
.ib-rep-kill {
  position: absolute; left: -6mm; top: 50%; transform: translateY(-50%);
  width: 5mm; height: 4mm; display: none; align-items: center; justify-content: center;
  border: 0; background: transparent; color: #b91c1c; cursor: pointer;
  font-size: 9pt; line-height: 1; padding: 0;
}
.ib-rep-table tbody tr:hover .ib-rep-kill { display: flex; }
.ib-rep-balance-input {
  width: 100%; border: 0; background: transparent; color: #000;
  font-family: "Courier New", Courier, monospace; font-size: 8pt; padding: 0;
  outline: none;
}
.ib-rep-balance-input:focus { background: #fffbc8; }
@media print {
  .ib-rep-kill { display: none !important; }
  .ib-rep-balance-input { background: transparent !important; }
  /* Uma <section> por folha; a última não força página em branco no fim. */
  .ib-rep-sheet { page-break-after: always; break-after: page; }
  .ib-rep-sheet:last-child { page-break-after: auto; break-after: auto; }
  .ib-rep-sheet + .ib-rep-sheet { margin-top: 0; }
  .ib-rep-table tr { page-break-inside: avoid; break-inside: avoid; }
  .ib-rep-table thead { display: table-header-group; }
}
`;

/** Só na pré-visualização: desenha cada página como uma folha A4 deitada de
 *  verdade (papel branco, margem de 6mm/8mm e altura de 210mm), para o que se
 *  vê na tela ter a mesma proporção do que sai na impressora. */
export const REPORT_PREVIEW_CSS = `
.ib-rep-screen { width: 297mm; }
.ib-rep-screen .ib-rep-sheet {
  width: 297mm; min-height: 210mm; box-sizing: border-box;
  padding: 6mm 8mm; background: #fff; border: 1px solid #d4d4d4;
}
.ib-rep-screen .ib-rep-sheet + .ib-rep-sheet { margin-top: 6mm; }
`;

function SheetColumns() {
  return (
    <colgroup>
      <col style={{ width: `${COLUMN_WIDTHS_PERCENT.product}%` }} />
      <col style={{ width: `${COLUMN_WIDTHS_PERCENT.sku}%` }} />
      <col style={{ width: `${COLUMN_WIDTHS_PERCENT.ean}%` }} />
      <col style={{ width: `${COLUMN_WIDTHS_PERCENT.location}%` }} />
      <col style={{ width: `${COLUMN_WIDTHS_PERCENT.balance}%` }} />
    </colgroup>
  );
}

interface InventoryReportDocumentProps {
  meta: ReportMeta;
  rows: InventoryReportRow[];
  /** Só na pré-visualização: digitar o saldo direto na célula (modo manual). */
  editableBalance?: boolean;
  onEditBalance?: (productId: string, value: string) => void;
  /** Só na pré-visualização: tirar a linha da emissão (não altera o cadastro). */
  onRemoveRow?: (productId: string) => void;
  /** Liga o desenho de folha A4 da pré-visualização (REPORT_PREVIEW_CSS). */
  screen?: boolean;
  /** Renderiza só uma janela de páginas (pré-visualização de relatório longo),
   *  preservando a numeração real: "Página 4 de 12", não "Página 1 de 3". */
  pageWindow?: { from: number; count: number };
}

/** O documento inteiro — uma `<section>` por página A4 paisagem. */
export function InventoryReportDocument({
  meta, rows, editableBalance = false, onEditBalance, onRemoveRow, screen = false, pageWindow,
}: InventoryReportDocumentProps) {
  // Pagina SEMPRE o documento inteiro: é o que mantém a numeração honesta
  // quando a tela desenha apenas algumas folhas.
  const allPages = paginateReportRows(rows);
  const totalPages = allPages.length;
  const firstIndex = pageWindow ? Math.min(pageWindow.from, totalPages - 1) : 0;
  const pages = pageWindow
    ? allPages.slice(firstIndex, firstIndex + pageWindow.count)
    : allPages;

  return (
    <div className={screen ? 'ib-rep-doc ib-rep-screen' : 'ib-rep-doc'}>
      {pages.map((pageRows, windowIndex) => {
        const pageIndex = firstIndex + windowIndex;
        const previousPage = pageIndex > 0 ? allPages[pageIndex - 1] : null;
        const carriedGroup = previousPage
          ? (previousPage[previousPage.length - 1]?.groupLabel ?? null)
          : null;
        let lastGroup: string | null = carriedGroup;

        return (
          <section className="ib-rep-sheet" key={pageIndex}>
            {pageIndex === 0 && (
              <>
                <div className="ib-rep-head">
                  <h1 className="ib-rep-title">InventoryBlind - Relatório de Contagem</h1>
                  <span className="ib-rep-tally">
                    {meta.productCount} produtos • {meta.locationCount} endereços
                  </span>
                </div>
                <p className="ib-rep-sub">
                  <span>Workspace: {meta.workspaceName}</span>
                  <span>{meta.filterDescription}</span>
                  <span>Emissão: {formatEmissionTimestamp(meta.emittedAt)}</span>
                </p>
              </>
            )}

            <table className="ib-rep-table">
              <SheetColumns />
              <thead>
                <tr>
                  {COLUMN_LABELS.map(label => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carriedGroup && (
                  <tr className="ib-rep-group">
                    <td colSpan={5}>{carriedGroup} (continuação)</td>
                  </tr>
                )}
                {pageRows.map(row => {
                  const startsGroup = row.groupLabel !== null && row.groupLabel !== lastGroup;
                  if (startsGroup) lastGroup = row.groupLabel;
                  const balance = formatBalanceCell(row);
                  return (
                    <Fragment key={row.productId}>
                      {startsGroup && (
                        <tr className="ib-rep-group">
                          <td colSpan={5}>{row.groupLabel}</td>
                        </tr>
                      )}
                      <tr>
                        <td title={row.name}>
                          {onRemoveRow && (
                            <button
                              type="button"
                              className="ib-rep-kill"
                              title="Remover desta emissão (não altera o cadastro)"
                              aria-label={`Remover ${row.name} da emissão`}
                              onClick={() => onRemoveRow(row.productId)}
                            >
                              ×
                            </button>
                          )}
                          {row.name || '—'}
                        </td>
                        <td className="ib-rep-mono">{row.sku || '—'}</td>
                        <td className="ib-rep-mono">{formatEanCell(row.ean)}</td>
                        <td className="ib-rep-mono">{formatLocationCell(row.location)}</td>
                        <td className="ib-rep-mono ib-rep-balance">
                          {editableBalance && onEditBalance ? (
                            <input
                              className="ib-rep-balance-input"
                              value={balance}
                              inputMode="numeric"
                              aria-label={`Saldo de ${row.name}`}
                              onChange={event => onEditBalance(row.productId, event.target.value)}
                            />
                          ) : (
                            balance
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            <div className="ib-rep-foot">
              Página {pageIndex + 1} de {totalPages}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Área de impressão: montada em `document.body` por portal, só enquanto a
 *  impressão acontece. O CSS injetado esconde `body > *` — sidebar, header,
 *  filtros e botões — e mostra apenas esta folha. */
export function InventoryReportPrint({ meta, rows }: { meta: ReportMeta; rows: InventoryReportRow[] }) {
  return (
    <div id={REPORT_PRINT_AREA_ID}>
      <style>{REPORT_SHEET_CSS}</style>
      <InventoryReportDocument meta={meta} rows={rows} />
    </div>
  );
}
