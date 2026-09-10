// Pré-visualização: a MESMA folha que vai para a impressora e para o PDF,
// desenhada como uma A4 deitada de verdade (297×210mm). Não é uma tabela do
// design system imitando o relatório — é o próprio documento
// (InventoryReportDocument), o que garante que preview, impressão e PDF não
// possam divergir.
//
// Remover uma linha aqui tira o produto da FOLHA — nunca do cadastro.

import { useMemo, useState } from 'react';
import { ChevronDown, FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import { Badge, Button, Panel, PanelSection } from '../ui';
import { SafeDropdown } from '../SafeDropdown';
import { paginateReportRows } from '../../lib/reports/inventoryReportAlgorithm';
import type { BalanceSource, InventoryReportRow, ReportMeta } from '../../lib/reports/inventoryReportTypes';
import {
  InventoryReportDocument,
  REPORT_PREVIEW_CSS,
  REPORT_SHEET_CSS,
} from './InventoryReportPrint';

/** Folhas A4 desenhadas por vez — a impressão, o PDF e o Excel trazem todas.
 *  Segura o DOM: 3 folhas são ~130 linhas, não milhares. */
const SHEETS_PER_WINDOW = 3;

const MODE_LABEL: Record<ReportMeta['mode'], string> = {
  location: 'Por Local',
  brand: 'Por Linha/Marca',
  manual: 'Seleção Manual',
};

interface InventoryReportPreviewProps {
  meta: ReportMeta;
  rows: InventoryReportRow[];
  balanceSource: BalanceSource;
  onEditBalance: (productId: string, value: string) => void;
  onRemoveRow: (productId: string) => void;
  onPrint: () => void;
  onPdf: () => void;
  onExcel: (bookType: 'xlsx' | 'xls') => void;
  busy: boolean;
  removedCount: number;
}

export function InventoryReportPreview({
  meta, rows, balanceSource, onEditBalance, onRemoveRow,
  onPrint, onPdf, onExcel, busy, removedCount,
}: InventoryReportPreviewProps) {
  const [sheetWindow, setSheetWindow] = useState(0);

  const totalSheets = useMemo(() => paginateReportRows(rows).length, [rows]);
  const windowCount = Math.max(1, Math.ceil(totalSheets / SHEETS_PER_WINDOW));
  const currentWindow = Math.min(sheetWindow, windowCount - 1);
  const firstSheet = currentWindow * SHEETS_PER_WINDOW;

  const canEmit = rows.length > 0;

  return (
    <Panel>
      <PanelSection>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">3. Pré-visualização e emissão</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Folha A4 paisagem — é exatamente isto que sai na impressora, no PDF e no Excel.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">{MODE_LABEL[meta.mode]}</Badge>
            <Badge>{meta.productCount} produtos</Badge>
            <Badge>{meta.locationCount} locais</Badge>
          </div>
        </div>

        {/* Barra de ações simples, logo acima da folha. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onPrint} disabled={!canEmit || busy}>
            <Printer size={16} />
            Imprimir
          </Button>
          <Button variant="secondary" onClick={onPdf} disabled={!canEmit || busy}>
            <FileDown size={16} />
            PDF
          </Button>
          <Button variant="secondary" onClick={() => onExcel('xlsx')} disabled={!canEmit || busy}>
            <FileSpreadsheet size={16} />
            Excel (.xlsx)
          </Button>
          <SafeDropdown
            trigger={
              <span className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-control px-3 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg [@media(pointer:fine)]:min-h-[32px]">
                Mais
                <ChevronDown size={14} />
              </span>
            }
            items={[
              {
                id: 'xls',
                label: 'Excel antigo (.xls)',
                onClick: () => onExcel('xls'),
                disabled: !canEmit || busy,
              },
            ]}
          />
          {removedCount > 0 && (
            <span className="text-xs text-fg-subtle">
              {removedCount} linha(s) removida(s) desta emissão — o cadastro não foi alterado.
            </span>
          )}
        </div>
      </PanelSection>

      <PanelSection padding="sm">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            Nenhum produto selecionado ainda.
          </p>
        ) : (
          <>
            {/* A folha tem largura fixa de A4 deitada; abaixo de ~1150px de
                conteúdo ela rola dentro do próprio container, e o corpo da
                página nunca rola na horizontal. */}
            <div className="overflow-x-auto bg-surface-3/40 p-3">
              <style>{REPORT_SHEET_CSS}</style>
              <style>{REPORT_PREVIEW_CSS}</style>
              <InventoryReportDocument
                meta={meta}
                rows={rows}
                pageWindow={{ from: firstSheet, count: SHEETS_PER_WINDOW }}
                screen
                editableBalance={balanceSource === 'manual'}
                onEditBalance={onEditBalance}
                onRemoveRow={onRemoveRow}
              />
            </div>

            {windowCount > 1 && (
              <div className="mt-3 flex items-center justify-between text-xs text-fg-subtle">
                <span>
                  Pré-visualizando as folhas {firstSheet + 1}–
                  {Math.min(totalSheets, firstSheet + SHEETS_PER_WINDOW)} de {totalSheets}.
                  A impressão, o PDF e o Excel trazem todas.
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 hover:bg-surface-3 disabled:opacity-40"
                    onClick={() => setSheetWindow(w => Math.max(0, w - 1))}
                    disabled={currentWindow === 0}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 hover:bg-surface-3 disabled:opacity-40"
                    onClick={() => setSheetWindow(w => Math.min(windowCount - 1, w + 1))}
                    disabled={currentWindow >= windowCount - 1}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  );
}
