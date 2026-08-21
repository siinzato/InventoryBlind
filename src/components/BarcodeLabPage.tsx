/**
 * BarcodeLabPage — Laboratório de Códigos de Barras
 *
 * Ferramenta separada do Gerador de Etiquetas (LabelGeneratorPage). Gera,
 * valida, visualiza, imprime e exporta códigos de barras/QR/Data Matrix sem
 * exigir cadastro prévio no InventoryBlind — reaproveita a técnica de
 * impressão/PNG/PDF (html2canvas + jsPDF, CSS @media print injetado) e o
 * padrão visual do Gerador de Etiquetas, mas com estado, preferências
 * (`ib_barcode_lab_prefs`, chave própria) e componentes totalmente próprios.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Barcode as BarcodeIcon, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { BarcodeLabSettings, BarcodeSymbology, DEFAULT_BARCODE_LAB_SETTINGS } from '../lib/barcode/barcodeTypes';
import { BarcodeRow } from '../lib/barcode/barcodeBatchUtils';
import { loadBarcodeLabPrefs, saveBarcodeLabPrefs } from '../lib/barcode/barcodeLabPrefs';
import { BarcodeUnitMode } from './barcode/BarcodeUnitMode';
import { BarcodeBatchMode } from './barcode/BarcodeBatchMode';

type Mode = 'unit' | 'batch';
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType }

let _tid = 0;

interface BarcodeLabPageProps {
  onBack: () => void;
}

export const BarcodeLabPage: React.FC<BarcodeLabPageProps> = ({ onBack }) => {
  const [mode, setMode] = useState<Mode>('unit');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settings, setSettings] = useState<BarcodeLabSettings>(DEFAULT_BARCODE_LAB_SETTINGS);

  const [pendingBatchRows, setPendingBatchRows] = useState<BarcodeRow[] | null>(null);
  const [pendingBatchSymbology, setPendingBatchSymbology] = useState<BarcodeSymbology | null>(null);

  useEffect(() => {
    const saved = loadBarcodeLabPrefs();
    if (saved) setSettings(s => ({ ...s, ...saved }));
  }, []);

  useEffect(() => { saveBarcodeLabPrefs(settings); }, [settings]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_tid;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  const handleSettingsChange = (patch: Partial<BarcodeLabSettings>) => setSettings(s => ({ ...s, ...patch }));
  const handleResetSettings = () => { setSettings({ ...DEFAULT_BARCODE_LAB_SETTINGS }); toast('Preferências restauradas para o padrão.', 'success'); };

  const handleSendToBatch = (values: string[], symbology: BarcodeSymbology) => {
    setPendingBatchRows(values.map(v => ({ value: v })));
    setPendingBatchSymbology(symbology);
    setMode('batch');
  };

  return (
    <div className="min-h-screen bg-surface-3">
      {/* TOASTS */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-container shadow-panel text-sm font-semibold max-w-xs pointer-events-auto ${
            t.type === 'success' ? 'bg-emerald-600 text-white' : t.type === 'error' ? 'bg-red-600 text-white' : 'bg-surface-2 text-fg border border-edge'}`}>
            {t.type === 'success' ? <CheckCircle2 size={15} /> : t.type === 'error' ? <AlertCircle size={15} /> : null}
            {t.message}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
              <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
            </button>
            <div className="flex items-center gap-2">
              <BarcodeIcon size={22} className="text-accent" />
              <div>
                <h1 className="text-title leading-tight">Laboratório de Códigos de Barras</h1>
                <p className="text-xs text-fg-subtle hidden sm:block">EAN-13/8 · UPC-A · Code 128 · ITF-14 · QR Code · Data Matrix</p>
              </div>
            </div>
          </div>
          <div className="flex items-center bg-surface-3 rounded-lg p-1 gap-1">
            {(['unit', 'batch'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${mode === m ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg'}`}>
                {m === 'batch' ? <><Layers size={14} />Em lote</> : 'Unitário'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {mode === 'unit' ? (
          <BarcodeUnitMode
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onResetSettings={handleResetSettings}
            onSendToBatch={handleSendToBatch}
            toast={toast}
          />
        ) : (
          <BarcodeBatchMode
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onResetSettings={handleResetSettings}
            toast={toast}
            initialRawRows={pendingBatchRows}
            initialSymbology={pendingBatchSymbology}
            onConsumedInitialRows={() => { setPendingBatchRows(null); setPendingBatchSymbology(null); }}
          />
        )}
      </div>
    </div>
  );
};

export default BarcodeLabPage;
