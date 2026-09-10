import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Search, Printer, Download, Copy, X, RefreshCw, CheckCircle2, AlertTriangle,
  ClipboardPaste, Type, Package, ArrowRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  BarcodeSymbology, BarcodeLabSettings, BARCODE_SYMBOLOGIES,
  resolveLabelSize, pickLayoutVariant, symbologyInfo,
} from '../../lib/barcode/barcodeTypes';
import { validateBarcodeValue, estimateReadabilityWarning } from '../../lib/barcode/barcodeValidation';
import {
  composeExportSVG, downloadSVG, downloadLabelPNG, downloadLabelPDF,
  printBarcodeArea, renderBarcodeSVG,
} from '../../lib/barcode/barcodeExport';
import { BarcodeLabel, BarcodeLabelFields } from './BarcodeLabel';
import { BarcodePreview } from './BarcodePreview';
import { BarcodeSettings } from './BarcodeSettings';

type FillMode = 'free' | 'catalog' | 'paste';
type ToastType = 'success' | 'error' | 'info';

interface CatalogProduct { id: string; name: string; sku: string; ean: string | null; location: string | null }

interface BarcodeUnitModeProps {
  settings: BarcodeLabSettings;
  onSettingsChange: (patch: Partial<BarcodeLabSettings>) => void;
  onResetSettings: () => void;
  onSendToBatch: (values: string[], symbology: BarcodeSymbology) => void;
  toast: (message: string, type?: ToastType) => void;
}

const EMPTY_FIELDS: BarcodeLabelFields = { name: '', sku: '', location: '', lot: '', expiry: '', quantity: '' };

export const BarcodeUnitMode: React.FC<BarcodeUnitModeProps> = ({ settings, onSettingsChange, onResetSettings, onSendToBatch, toast }) => {
  const [fillMode, setFillMode] = useState<FillMode>('free');
  const [symbology, setSymbology] = useState<BarcodeSymbology>('ean13');
  const [rawValue, setRawValue] = useState('');
  const [fields, setFields] = useState<BarcodeLabelFields>(EMPTY_FIELDS);
  const [busy, setBusy] = useState(false);

  // Catálogo
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CatalogProduct[]>([]);
  const [catalogSelected, setCatalogSelected] = useState<CatalogProduct | null>(null);

  // Colar dados
  const [pasteText, setPasteText] = useState('');

  const captureRef = useRef<HTMLDivElement>(null);

  const validation = useMemo(() => validateBarcodeValue(symbology, rawValue), [symbology, rawValue]);
  const { widthMm, heightMm } = resolveLabelSize(settings.sizeId, settings.customWidthMm, settings.customHeightMm);
  const layoutVariant = pickLayoutVariant(settings.sizeId, widthMm, heightMm);
  const finalValue = validation.correctedValue;

  const readabilityWarning = useMemo(() => {
    if (!finalValue) return null;
    return estimateReadabilityWarning(symbology, finalValue, widthMm, heightMm, settings.barcodeScale);
  }, [symbology, finalValue, widthMm, heightMm, settings.barcodeScale]);

  const handleClear = () => {
    setRawValue(''); setFields(EMPTY_FIELDS); setCatalogSelected(null); setCatalogResults([]); setCatalogQuery('');
  };

  // ── Catálogo (só leitura — nunca altera o produto) ─────────────────────
  const handleCatalogSearch = useCallback(async () => {
    const q = catalogQuery.trim();
    if (!q) return;
    setCatalogSearching(true);
    try {
      const { data, error } = await supabase
        .from('products').select('id, name, sku, ean, location')
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
        .limit(20);
      if (error) throw error;
      setCatalogResults((data as CatalogProduct[]) || []);
      if (!data || data.length === 0) toast('Nenhum produto encontrado.', 'info');
    } catch (err) {
      console.error('[BarcodeLab] catalog search error:', err);
      toast('Erro ao buscar no catálogo.', 'error');
    } finally { setCatalogSearching(false); }
  }, [catalogQuery, toast]);

  const handleSelectProduct = (p: CatalogProduct) => {
    setCatalogSelected(p);
    setFields({ name: p.name, sku: p.sku, location: p.location || '', lot: '', expiry: '', quantity: '' });
    if (p.ean) { setSymbology('ean13'); setRawValue(p.ean); }
  };

  // ── Colar dados ─────────────────────────────────────────────────────────
  const pasteLines = useMemo(() => pasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean), [pasteText]);

  const handleApplyPaste = () => {
    if (pasteLines.length === 0) return;
    setRawValue(pasteLines[0]);
    toast('Valor aplicado ao modo unitário.', 'success');
  };

  // ── Exportação ────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!finalValue) { toast('Corrija o código antes de imprimir.', 'error'); return; }
    printBarcodeArea(widthMm, heightMm, area => {
      const root = createRoot(area);
      const items = Array.from({ length: settings.copies });
      root.render(React.createElement(React.Fragment, null,
        ...items.map((_, i) => React.createElement('div', {
          key: i, style: { pageBreakAfter: i < settings.copies - 1 ? 'always' : 'auto', pageBreakInside: 'avoid' },
        }, React.createElement(BarcodeLabel, { widthMm, heightMm, layoutVariant, symbology, value: finalValue, fields, settings })))
      ));
    }, () => toast('Impressão enviada.', 'success'));
  }, [finalValue, widthMm, heightMm, layoutVariant, symbology, fields, settings, toast]);

  const handlePNG = useCallback(async () => {
    if (!finalValue || !captureRef.current) { toast('Corrija o código antes de exportar.', 'error'); return; }
    setBusy(true);
    try {
      await downloadLabelPNG(captureRef.current, symbology, finalValue);
      toast('PNG baixado com sucesso.', 'success');
    } catch (err) {
      console.error('[BarcodeLab] PNG error:', err);
      toast('Erro ao gerar PNG.', 'error');
    } finally { setBusy(false); }
  }, [finalValue, symbology, toast]);

  const handleSVG = useCallback(async () => {
    if (!finalValue) { toast('Corrija o código antes de exportar.', 'error'); return; }
    setBusy(true);
    try {
      const baseSvg = await renderBarcodeSVG(symbology, finalValue, { showHumanReadable: settings.showHumanReadable, scale: settings.barcodeScale, eccLevel: settings.eccLevel });
      const composed = composeExportSVG(baseSvg, finalValue, settings.showHumanReadable);
      downloadSVG(composed, symbology, finalValue);
      toast('SVG baixado com sucesso.', 'success');
    } catch (err) {
      console.error('[BarcodeLab] SVG error:', err);
      toast('Erro ao gerar SVG.', 'error');
    } finally { setBusy(false); }
  }, [finalValue, symbology, settings.showHumanReadable, settings.barcodeScale, settings.eccLevel, toast]);

  const handlePDF = useCallback(async () => {
    if (!finalValue || !captureRef.current) { toast('Corrija o código antes de exportar.', 'error'); return; }
    setBusy(true);
    try {
      await downloadLabelPDF(captureRef.current, symbology, finalValue, widthMm, heightMm, settings.copies);
      toast('PDF gerado com sucesso.', 'success');
    } catch (err) {
      console.error('[BarcodeLab] PDF error:', err);
      toast('Erro ao gerar PDF.', 'error');
    } finally { setBusy(false); }
  }, [finalValue, symbology, widthMm, heightMm, settings.copies, toast]);

  const handleCopyValue = useCallback(async () => {
    if (!finalValue) return;
    try {
      await navigator.clipboard.writeText(finalValue);
      toast('Valor copiado.', 'success');
    } catch {
      toast('Não foi possível copiar automaticamente.', 'error');
    }
  }, [finalValue, toast]);

  const numericInfo = symbologyInfo(symbology);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* OFF-SCREEN CAPTURE — tamanho físico real, alvo do html2canvas */}
      {finalValue && (
        <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1, pointerEvents: 'none' }} aria-hidden>
          <BarcodeLabel ref={captureRef} widthMm={widthMm} heightMm={heightMm} layoutVariant={layoutVariant} symbology={symbology} value={finalValue} fields={fields} settings={settings} />
        </div>
      )}

      {/* LEFT */}
      <div className="space-y-4">
        {/* Sub-abas de preenchimento */}
        <div className="bg-surface-2 rounded-xl border border-edge p-2 flex gap-1">
          {([
            { id: 'free', label: 'Valor livre', icon: Type },
            { id: 'catalog', label: 'Catálogo', icon: Package },
            { id: 'paste', label: 'Colar dados', icon: ClipboardPaste },
          ] as const).map(m => (
            <button key={m.id} onClick={() => setFillMode(m.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition ${fillMode === m.id ? 'bg-accent text-white' : 'text-fg-muted hover:bg-surface-3'}`}>
              <m.icon size={14} />{m.label}
            </button>
          ))}
        </div>

        {/* Tipo do código — sempre visível, vale para os 3 sub-modos */}
        <div className="bg-surface-2 rounded-xl border border-edge p-5">
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">Tipo de código</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {BARCODE_SYMBOLOGIES.map(s => (
              <button key={s.id} onClick={() => setSymbology(s.id)}
                className={`p-2.5 rounded-lg border-2 text-left transition ${symbology === s.id ? 'border-accent bg-accent/10' : 'border-edge bg-surface-2 hover:border-fg-subtle'}`}>
                <p className={`font-bold text-xs ${symbology === s.id ? 'text-accent' : 'text-fg-muted'}`}>{s.label}</p>
                <p className="text-xs text-fg-subtle">{s.kind === '1d' ? '1D' : '2D'}</p>
              </button>
            ))}
          </div>
        </div>

        {/* VALOR LIVRE */}
        {fillMode === 'free' && (
          <div className="bg-surface-2 rounded-xl border border-edge p-5">
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">
              Conteúdo {numericInfo.fixedLength ? `(${numericInfo.fixedLength.withoutCheck} ou ${numericInfo.fixedLength.withCheck} dígitos)` : ''}
            </label>
            <textarea
              value={rawValue}
              onChange={e => setRawValue(e.target.value)}
              rows={numericInfo.kind === '2d' ? 4 : 1}
              placeholder={numericInfo.numeric ? 'Somente números...' : 'Digite ou cole o conteúdo...'}
              className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
            />
            {validation.ok ? (
              <div className="mt-3 flex items-center justify-between gap-2 p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm">
                <span className="flex items-center gap-2"><CheckCircle2 size={16} />Código válido{validation.checkDigit !== null ? ` — dígito verificador: ${validation.checkDigit}` : ''}</span>
              </div>
            ) : rawValue.trim() ? (
              <div className="mt-3 flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
                <AlertTriangle size={16} className="flex-shrink-0" /><span>{validation.error}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* CATÁLOGO */}
        {fillMode === 'catalog' && (
          <div className="bg-surface-2 rounded-xl border border-edge p-5">
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">Buscar no catálogo (nome, SKU ou EAN)</label>
            <div className="flex gap-2 mb-3">
              <input type="text" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCatalogSearch()}
                placeholder="Digite para buscar..."
                className="flex-1 px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
              <button onClick={handleCatalogSearch} disabled={catalogSearching || !catalogQuery.trim()}
                className="px-4 py-2.5 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2 transition">
                {catalogSearching ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
              </button>
            </div>

            {catalogResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 mb-2">
                {catalogResults.map(p => (
                  <button key={p.id} onClick={() => handleSelectProduct(p)}
                    className={`w-full text-left p-2.5 rounded-lg border transition ${catalogSelected?.id === p.id ? 'border-accent bg-accent/10' : 'border-edge hover:bg-surface-3'}`}>
                    <p className="font-semibold text-fg text-sm truncate">{p.name}</p>
                    <p className="text-xs text-fg-subtle font-mono">{p.sku} · {p.ean || 'sem EAN'} · {p.location || 'sem local'}</p>
                  </button>
                ))}
              </div>
            )}

            {catalogSelected && (
              <div className="mt-3 p-3 bg-surface-3 rounded-lg space-y-2">
                <p className="text-xs text-fg-subtle">Campos preenchidos a partir do produto — edite livremente, isto não altera o cadastro.</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={fields.name} onChange={e => setFields(f => ({ ...f, name: e.target.value }))} placeholder="Nome" className="px-2.5 py-2 border border-edge rounded-lg text-xs" />
                  <input value={fields.sku} onChange={e => setFields(f => ({ ...f, sku: e.target.value }))} placeholder="SKU" className="px-2.5 py-2 border border-edge rounded-lg text-xs font-mono" />
                  <input value={fields.location} onChange={e => setFields(f => ({ ...f, location: e.target.value }))} placeholder="Localização" className="px-2.5 py-2 border border-edge rounded-lg text-xs" />
                  <input value={rawValue} onChange={e => setRawValue(e.target.value)} placeholder="EAN" className="px-2.5 py-2 border border-edge rounded-lg text-xs font-mono" />
                </div>
              </div>
            )}
            {!validation.ok && rawValue.trim() && (
              <div className="mt-3 flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
                <AlertTriangle size={16} className="flex-shrink-0" /><span>{validation.error}</span>
              </div>
            )}
          </div>
        )}

        {/* COLAR DADOS */}
        {fillMode === 'paste' && (
          <div className="bg-surface-2 rounded-xl border border-edge p-5">
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">Cole um valor ou uma lista (uma linha por código)</label>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5}
              placeholder="Cole aqui..."
              className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={handleApplyPaste} disabled={pasteLines.length === 0}
                className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition">
                Usar 1º valor no modo unitário
              </button>
              {pasteLines.length > 1 && (
                <button onClick={() => onSendToBatch(pasteLines, symbology)}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition">
                  <ArrowRight size={14} />Ir para o modo em lote ({pasteLines.length} valores)
                </button>
              )}
            </div>
          </div>
        )}

        {/* PERSONALIZAÇÃO */}
        <BarcodeSettings settings={settings} symbology={symbology} onChange={onSettingsChange} onReset={onResetSettings} />

        {/* AÇÕES */}
        <div className="bg-surface-2 rounded-xl border border-edge p-5">
          <h2 className="font-bold text-fg text-sm mb-3">Ações</h2>
          <div className="space-y-2">
            <button onClick={handlePrint} disabled={busy || !finalValue}
              className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-bold transition disabled:opacity-60">
              <Printer size={16} />Imprimir {settings.copies > 1 ? `(${settings.copies} cópias)` : ''}
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={handlePNG} disabled={busy || !finalValue}
                className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}PNG
              </button>
              <button onClick={handleSVG} disabled={busy || !finalValue}
                className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}SVG
              </button>
              <button onClick={handlePDF} disabled={busy || !finalValue}
                className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}PDF
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleCopyValue} disabled={!finalValue}
                className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                <Copy size={14} />Copiar valor
              </button>
              <button onClick={handleClear}
                className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg-muted rounded-lg text-sm font-semibold transition">
                <X size={14} />Limpar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — PREVIEW */}
      <div>
        <div className="sticky top-28">
          <BarcodePreview
            widthMm={widthMm} heightMm={heightMm} layoutVariant={layoutVariant}
            symbology={symbology} value={finalValue} fields={fields} settings={settings}
            warning={readabilityWarning}
            sizeLabel={settings.sizeId === 'custom' ? `Personalizado — ${widthMm} × ${heightMm}mm` : `${widthMm} × ${heightMm}mm`}
          />
        </div>
      </div>
    </div>
  );
};

export default BarcodeUnitMode;
