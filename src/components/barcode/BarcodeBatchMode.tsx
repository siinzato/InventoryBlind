import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Printer, Download, Trash2, RefreshCw, FileWarning, CheckCircle2, XCircle, Copy as CopyIcon,
} from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Table, Thead, Tr, Th, Td } from '../ui';
import { downloadFile } from '../../lib/productImportUtils';
import { BarcodeSymbology, BarcodeLabSettings, resolveLabelSize, pickLayoutVariant } from '../../lib/barcode/barcodeTypes';
import {
  BarcodeRow, BarcodeBatchRow, processBarcodeBatchRows, summarizeBarcodeBatch, barcodeBatchErrorsToCSV,
} from '../../lib/barcode/barcodeBatchUtils';
import {
  printBarcodeArea, captureElementToCanvas, createBatchPDFDocument, addLabelPageToPDF,
} from '../../lib/barcode/barcodeExport';
import { BarcodeLabel } from './BarcodeLabel';
import { BarcodeSettings } from './BarcodeSettings';
import { BarcodeBatchImport } from './BarcodeBatchImport';

type ToastType = 'success' | 'error' | 'info';
type BatchFilter = 'all' | 'valid' | 'invalid' | 'duplicate';

interface BarcodeBatchModeProps {
  settings: BarcodeLabSettings;
  onSettingsChange: (patch: Partial<BarcodeLabSettings>) => void;
  onResetSettings: () => void;
  toast: (message: string, type?: ToastType) => void;
  initialRawRows: BarcodeRow[] | null;
  initialSymbology: BarcodeSymbology | null;
  onConsumedInitialRows: () => void;
}

const STATUS_LABEL: Record<BarcodeBatchRow['status'], string> = { valid: 'Válido', invalid: 'Inválido', duplicate: 'Duplicado' };
const STATUS_BADGE: Record<BarcodeBatchRow['status'], 'success' | 'danger' | 'warning'> = { valid: 'success', invalid: 'danger', duplicate: 'warning' };

export const BarcodeBatchMode: React.FC<BarcodeBatchModeProps> = ({
  settings, onSettingsChange, onResetSettings, toast, initialRawRows, initialSymbology, onConsumedInitialRows,
}) => {
  const [rows, setRows] = useState<BarcodeBatchRow[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<BatchFilter>('all');
  const [generating, setGenerating] = useState(false);

  const { widthMm, heightMm } = resolveLabelSize(settings.sizeId, settings.customWidthMm, settings.customHeightMm);
  const layoutVariant = pickLayoutVariant(settings.sizeId, widthMm, heightMm);

  const processRows = async (rawRows: BarcodeRow[], globalSymbology: BarcodeSymbology | null) => {
    setProcessing(true);
    try {
      const processed = await processBarcodeBatchRows(rawRows, globalSymbology);
      setRows(processed);
    } finally { setProcessing(false); }
  };

  // Handoff do "Colar dados" do modo unitário — processa direto, sem passar pela tela de upload.
  useEffect(() => {
    if (initialRawRows && initialRawRows.length > 0) {
      processRows(initialRawRows, initialSymbology);
      onConsumedInitialRows();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportConfirm = (rawRows: BarcodeRow[], globalSymbology: BarcodeSymbology | null) => {
    processRows(rawRows, globalSymbology);
  };

  const handleReset = () => setRows(null);

  const handleDeleteRow = (rowIndex: number) => {
    setRows(prev => prev ? prev.filter(r => r.rowIndex !== rowIndex) : prev);
  };

  const summary = useMemo(() => rows ? summarizeBarcodeBatch(rows) : null, [rows]);
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter(r => r.status === filter);
  }, [rows, filter]);

  const handleDownloadErrors = () => {
    if (!rows) return;
    downloadFile(barcodeBatchErrorsToCSV(rows), `barcode-lab-erros-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const validRows = useMemo(() => (rows ?? []).filter(r => r.status === 'valid'), [rows]);

  /** Renderiza uma linha fora da tela, captura em canvas e desmonta — evita manter centenas de nós montados. */
  const captureRowCanvas = async (row: BarcodeBatchRow): Promise<HTMLCanvasElement> => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;';
    document.body.appendChild(container);
    const root = createRoot(container);
    const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
      root.render(
        <BarcodeLabel
          widthMm={widthMm} heightMm={heightMm} layoutVariant={layoutVariant}
          symbology={row.symbology} value={row.correctedValue!}
          fields={{ name: row.name, sku: row.sku, location: row.location, lot: row.lot, expiry: row.expiry, quantity: row.quantity }}
          settings={settings}
        />
      );
      setTimeout(async () => {
        const el = container.firstElementChild as HTMLElement;
        if (!el) { reject(new Error('elemento não renderizado')); return; }
        try { resolve(await captureElementToCanvas(el)); } catch (e) { reject(e); }
      }, 150);
    });
    root.unmount();
    document.body.removeChild(container);
    return canvas;
  };

  const handleBatchPrint = async () => {
    if (validRows.length === 0) { toast('Nenhuma linha válida para imprimir.', 'error'); return; }
    setGenerating(true);
    try {
      printBarcodeArea(widthMm, heightMm, area => {
        const root = createRoot(area);
        const items = validRows.flatMap(row => Array.from({ length: row.copies }, (_, i) => ({ row, i })));
        root.render(
          <>
            {items.map(({ row, i }, gi) => (
              <div key={`${row.rowIndex}-${i}`} style={{ pageBreakAfter: gi < items.length - 1 ? 'always' : 'auto', pageBreakInside: 'avoid' }}>
                <BarcodeLabel
                  widthMm={widthMm} heightMm={heightMm} layoutVariant={layoutVariant}
                  symbology={row.symbology} value={row.correctedValue!}
                  fields={{ name: row.name, sku: row.sku, location: row.location, lot: row.lot, expiry: row.expiry, quantity: row.quantity }}
                  settings={settings}
                />
              </div>
            ))}
          </>
        );
      }, () => toast('Impressão enviada.', 'success'));
    } finally { setGenerating(false); }
  };

  const handleBatchPDF = async () => {
    if (validRows.length === 0) { toast('Nenhuma linha válida para gerar PDF.', 'error'); return; }
    setGenerating(true);
    try {
      const pdf = createBatchPDFDocument(widthMm, heightMm);
      let page = 0;
      for (const row of validRows) {
        const canvas = await captureRowCanvas(row);
        for (let c = 0; c < row.copies; c++) {
          addLabelPageToPDF(pdf, canvas, widthMm, heightMm, page === 0);
          page++;
        }
      }
      pdf.save(`barcode-lab-lote-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast(`PDF com ${page} etiqueta(s) gerado.`, 'success');
    } catch (err) {
      console.error('[BarcodeLab] batch PDF error:', err);
      toast('Erro ao gerar PDF em lote.', 'error');
    } finally { setGenerating(false); }
  };

  if (!rows) {
    return (
      <div className="space-y-4">
        {processing && (
          <Panel><PanelSection padding="lg" className="flex items-center justify-center gap-2 text-fg-subtle"><RefreshCw size={18} className="animate-spin" />Processando linhas...</PanelSection></Panel>
        )}
        <BarcodeBatchImport onConfirm={handleImportConfirm} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: summary.total, icon: null, filterVal: 'all' as BatchFilter },
            { label: 'Válidos', value: summary.valid, icon: CheckCircle2, filterVal: 'valid' as BatchFilter, tone: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Inválidos', value: summary.invalid, icon: XCircle, filterVal: 'invalid' as BatchFilter, tone: 'text-red-600 dark:text-red-400' },
            { label: 'Duplicados', value: summary.duplicate, icon: CopyIcon, filterVal: 'duplicate' as BatchFilter, tone: 'text-amber-600 dark:text-amber-400' },
          ].map(card => (
            <button key={card.label} onClick={() => setFilter(card.filterVal)}
              className={`text-left bg-surface-2 rounded-xl border p-4 transition ${filter === card.filterVal ? 'border-accent' : 'border-edge hover:border-fg-subtle'}`}>
              <p className="text-xs text-fg-subtle uppercase font-semibold">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.tone ?? 'text-fg'}`}>{card.value}</p>
            </button>
          ))}
        </div>
      )}

      {summary && summary.valid > 0 && (
        <div className="bg-accent/10 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-accent">
            {summary.valid} linha(s) válida(s) · {summary.totalLabels} etiqueta(s) · {summary.totalLabels} página(s) no PDF consolidado
          </p>
          <div className="flex gap-2">
            <Button onClick={handleBatchPrint} disabled={generating} size="sm">
              {generating ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />}Imprimir
            </Button>
            <Button onClick={handleBatchPDF} disabled={generating} variant="secondary" size="sm">
              {generating ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}PDF consolidado
            </Button>
          </div>
        </div>
      )}

      <BarcodeSettings settings={settings} symbology={validRows[0]?.symbology ?? 'ean13'} onChange={onSettingsChange} onReset={onResetSettings} />

      <Panel>
        <PanelSection padding="md" className="flex items-center justify-between">
          <h2 className="font-bold text-fg text-sm">Linhas ({filteredRows.length})</h2>
          <div className="flex gap-2">
            {(summary?.invalid ?? 0) + (summary?.duplicate ?? 0) > 0 && (
              <Button variant="secondary" size="sm" onClick={handleDownloadErrors}><FileWarning size={14} />Baixar relatório de erros</Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleReset}>Novo arquivo</Button>
          </div>
        </PanelSection>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <Table>
            <Thead>
              <Tr><Th>#</Th><Th>Valor</Th><Th>Tipo</Th><Th>Nome</Th><Th>SKU</Th><Th>Cópias</Th><Th>Status</Th><Th></Th></Tr>
            </Thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center py-8 text-fg-subtle text-sm">Nenhuma linha para este filtro.</Td></Tr>
              ) : filteredRows.map(row => (
                <Tr key={row.rowIndex}>
                  <Td className="text-fg-subtle text-xs">{row.rowIndex + 1}</Td>
                  <Td className="font-mono text-xs">{row.value}</Td>
                  <Td className="text-xs text-fg-muted">{row.symbology}</Td>
                  <Td className="text-xs text-fg-muted max-w-[160px] truncate">{row.name || '—'}</Td>
                  <Td className="text-xs font-mono text-fg-subtle">{row.sku || '—'}</Td>
                  <Td className="text-xs font-mono">{row.copies}</Td>
                  <Td>
                    <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    {row.error && row.status !== 'valid' && <p className="text-xs text-fg-subtle mt-0.5">{row.error}</p>}
                  </Td>
                  <Td>
                    <button onClick={() => handleDeleteRow(row.rowIndex)} className="text-fg-subtle hover:text-red-600 dark:hover:text-red-400" title="Excluir linha">
                      <Trash2 size={14} />
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Panel>
    </div>
  );
};

export default BarcodeBatchMode;
