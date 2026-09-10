/**
 * LabelGeneratorPage
 *
 * Arquitetura de captura:
 *   captureRef → elemento REAL (100mm × 40mm ou 100mm × 150mm),
 *                position:fixed; left:-9999px. html2canvas lê daqui.
 *   Preview    → mesmo componente, wrapper com transform:scale().
 *
 * FontSettings:
 *   - Controles slider por campo (nome, local, SKU, EAN, qtd excesso)
 *   - Persistência em localStorage com chave 'ib_label_font_prefs'
 *   - Botão "Restaurar padrão"
 *   - Propaga para captureRef e preview — print/PNG/PDF refletem mudanças
 *
 * Impressão: CSS @media print injetado, sem window.open().
 * PNG:       html2canvas scale:4 no captureRef.
 * PDF:       html2canvas + jsPDF formato mm.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  ArrowLeft, Search, Printer, Download, Tag, Package,
  AlertTriangle, X, CheckSquare, Square, RefreshCw, Layers,
  CheckCircle2, RotateCcw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ToastStack, useToasts } from './ui';
import ShelfLabel100x40, {
  SHELF_FONT_DEFAULTS,
} from './ShelfLabel100x40';
import ExcessLabel100x150, {
  EXCESS_FONT_DEFAULTS,
} from './ExcessLabel100x150';
import type { LabelProduct, ShelfFontSettings } from './ShelfLabel100x40';
import type { ExcessFontSettings } from './ExcessLabel100x150';

// ─── Types ────────────────────────────────────────────────────────────────────

type LabelType = 'shelf' | 'excess';
interface DbProduct extends LabelProduct { id: string; price: number | null }

// ── localStorage persistence ─────────────────────────────────────────────────

const PREFS_KEY = 'ib_label_font_prefs';

interface SavedPrefs {
  shelf: ShelfFontSettings;
  excess: ExcessFontSettings;
}

function loadPrefs(): SavedPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPrefs;
    return parsed;
  } catch { return null; }
}

function savePrefs(shelf: ShelfFontSettings, excess: ExcessFontSettings) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ shelf, excess }));
  } catch { /* storage unavailable */ }
}

// ── Print helpers ─────────────────────────────────────────────────────────────

function injectPrintStyle(labelType: LabelType) {
  document.getElementById('_label_print_style')?.remove();
  const size = labelType === 'shelf' ? '100mm 40mm' : '100mm 150mm';
  const el = document.createElement('style');
  el.id = '_label_print_style';
  el.textContent = `
    @media print {
      @page { size: ${size}; margin: 0; }
      body > * { display: none !important; }
      #_label_print_area { display: flex !important; }
    }
    #_label_print_area {
      display: none;
      position: fixed; left: 0; top: 0; z-index: 99999;
      background: white; flex-direction: column;
    }
  `;
  document.head.appendChild(el);
}

function removePrintStyle() {
  document.getElementById('_label_print_style')?.remove();
  const area = document.getElementById('_label_print_area');
  if (area) { area.remove(); }
}

function printLabels(
  product: LabelProduct, labelType: LabelType, copies: number,
  excessQty: number, shelfFonts: ShelfFontSettings, excessFonts: ExcessFontSettings
) {
  removePrintStyle();
  injectPrintStyle(labelType);
  const area = document.createElement('div');
  area.id = '_label_print_area';
  document.body.appendChild(area);
  const root = createRoot(area);
  const items = Array.from({ length: copies });

  root.render(React.createElement(React.Fragment, null,
    ...items.map((_, i) =>
      React.createElement('div', {
        key: i,
        style: { pageBreakAfter: i < copies - 1 ? 'always' : 'auto', pageBreakInside: 'avoid' },
      },
        labelType === 'shelf'
          ? React.createElement(ShelfLabel100x40, { product, fonts: shelfFonts })
          : React.createElement(ExcessLabel100x150, { product, excessQty, fonts: excessFonts })
      )
    )
  ));

  setTimeout(() => {
    window.print();
    window.addEventListener('afterprint', () => { root.unmount(); removePrintStyle(); }, { once: true });
  }, 200);
}

// ── html2canvas capture ───────────────────────────────────────────────────────

async function captureEl(el: HTMLElement): Promise<HTMLCanvasElement> {
  console.log('[LabelGen] Capturing:', el.offsetWidth, 'x', el.offsetHeight);
  return html2canvas(el, {
    scale: 4, useCORS: true, logging: true,
    backgroundColor: '#ffffff', allowTaint: false, removeContainer: false,
  });
}

// company_id/user_id are filled by the DB (get_my_company_id()/auth.uid() defaults) — no auth context needed here.
async function logLabelGeneration(sku: string, labelType: LabelType, quantity: number) {
  const { error } = await supabase.from('label_generation_log').insert({ sku, label_type: labelType, quantity });
  if (error) console.warn('[LabelGen] Failed to log label generation:', error.message);
}

function downloadURL(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function downloadPNG(el: HTMLElement, sku: string, labelType: LabelType) {
  const canvas = await captureEl(el);
  downloadURL(canvas.toDataURL('image/png'), `etiqueta-${labelType === 'shelf' ? 'vao' : 'excesso'}-${sku.replace(/[^a-z0-9]/gi, '_')}.png`);
}

async function downloadPDF(el: HTMLElement, sku: string, labelType: LabelType, copies: number) {
  const canvas = await captureEl(el);
  const imgData = canvas.toDataURL('image/png');
  const wMM = 100; const hMM = labelType === 'shelf' ? 40 : 150;
  const pdf = new jsPDF({ orientation: wMM >= hMM ? 'landscape' : 'portrait', unit: 'mm', format: [wMM, hMM] });
  for (let i = 0; i < copies; i++) {
    if (i > 0) pdf.addPage([wMM, hMM], wMM >= hMM ? 'landscape' : 'portrait');
    pdf.addImage(imgData, 'PNG', 0, 0, wMM, hMM);
  }
  pdf.save(`etiqueta-${labelType === 'shelf' ? 'vao' : 'excesso'}-${sku.replace(/[^a-z0-9]/gi, '_')}.pdf`);
}

async function captureProductLabel(
  product: LabelProduct, labelType: LabelType, excessQty: number,
  shelfFonts: ShelfFontSettings, excessFonts: ExcessFontSettings
): Promise<HTMLCanvasElement> {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;';
  document.body.appendChild(container);
  const root = createRoot(container);
  const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
    root.render(
      React.createElement('div', { id: '__batch_capture' },
        labelType === 'shelf'
          ? React.createElement(ShelfLabel100x40, { product, fonts: shelfFonts })
          : React.createElement(ExcessLabel100x150, { product, excessQty, fonts: excessFonts })
      )
    );
    setTimeout(async () => {
      const el = container.firstElementChild as HTMLElement;
      if (!el) { reject(new Error('element not rendered')); return; }
      try { resolve(await captureEl(el)); } catch (e) { reject(e); }
    }, 150);
  });
  root.unmount();
  document.body.removeChild(container);
  return canvas;
}

// ── Preview scale constants ───────────────────────────────────────────────────

// 1mm = 3.7795px at 96dpi → 100mm = 378px, 40mm = 151px, 150mm = 567px
const SHELF_PX_W = 378, SHELF_PX_H = 151;
const EXCESS_PX_W = 378, EXCESS_PX_H = 567;
const SHELF_SCALE = 2.4;   // preview ~907×363px
const EXCESS_SCALE = 1.15; // preview ~435×652px

// ── Slider component ──────────────────────────────────────────────────────────

interface FontSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

const FontSlider: React.FC<FontSliderProps> = ({ label, value, min, max, onChange }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-fg-subtle w-24 font-medium flex-shrink-0">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="flex-1 accent-accent h-1.5 cursor-pointer"
    />
    <span className="text-xs font-mono font-bold text-fg-muted w-10 text-right flex-shrink-0">
      {value}px
    </span>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────────────────────

interface LabelGeneratorPageProps {
  onBack: () => void;
}

export const LabelGeneratorPage: React.FC<LabelGeneratorPageProps> = ({ onBack }) => {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const { toasts, toast } = useToasts();

  // Font settings — loaded from localStorage on mount
  const [shelfFonts, setShelfFonts] = useState<ShelfFontSettings>(SHELF_FONT_DEFAULTS);
  const [excessFonts, setExcessFonts] = useState<ExcessFontSettings>(EXCESS_FONT_DEFAULTS);

  // Single mode
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'sku' | 'ean'>('sku');
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<DbProduct | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [labelType, setLabelType] = useState<LabelType>('shelf');
  const [excessQty, setExcessQty] = useState(0);
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);

  // Batch
  const [batchProducts, setBatchProducts] = useState<DbProduct[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchLocation, setBatchLocation] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLabelType, setBatchLabelType] = useState<LabelType>('shelf');
  const [batchCopies, setBatchCopies] = useState(1);
  const [batchExcessQty, setBatchExcessQty] = useState(0);

  const captureRef = useRef<HTMLDivElement>(null);

  // ── Load prefs on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const saved = loadPrefs();
    if (saved?.shelf) setShelfFonts(f => ({ ...f, ...saved.shelf }));
    if (saved?.excess) setExcessFonts(f => ({ ...f, ...saved.excess }));
  }, []);

  // ── Save prefs whenever fonts change ───────────────────────────────────
  useEffect(() => { savePrefs(shelfFonts, excessFonts); }, [shelfFonts, excessFonts]);

  // ── Helpers ───────────────────────────────────────────────────────────
  const updateShelf = (key: keyof ShelfFontSettings, val: number) =>
    setShelfFonts(f => ({ ...f, [key]: val }));

  const updateExcess = (key: keyof ExcessFontSettings, val: number) =>
    setExcessFonts(f => ({ ...f, [key]: val }));

  const resetFonts = () => {
    setShelfFonts({ ...SHELF_FONT_DEFAULTS });
    setExcessFonts({ ...EXCESS_FONT_DEFAULTS });
    toast('Fontes restauradas para o padrão.', 'success');
  };

  // ── Search ─────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true); setNotFound(false); setProduct(null);
    console.log('[LabelGen] Search:', searchType, '=', q);
    try {
      const { data, error } = await supabase
        .from('products').select('id, name, sku, ean, location, price')
        .ilike(searchType, q).limit(1).maybeSingle();
      console.log('[LabelGen] Result:', data, error);
      if (error) throw error;
      if (data) { setProduct(data as DbProduct); toast('Produto encontrado.', 'success'); }
      else { setNotFound(true); toast('Produto não encontrado. Verifique SKU ou EAN.', 'error'); }
    } catch (err) {
      console.error('[LabelGen] Search error:', err);
      setNotFound(true); toast('Erro ao buscar produto.', 'error');
    } finally { setSearching(false); }
  }, [searchQuery, searchType, toast]);

  // ── Print ──────────────────────────────────────────────────────────────
  const handlePrint = useCallback(() => {
    if (!product) { toast('Selecione um produto primeiro.', 'error'); return; }
    console.log('[LabelGen] Print type:', labelType, 'copies:', copies);
    try {
      printLabels(labelAsProduct(product), labelType, copies, excessQty, shelfFonts, excessFonts);
      toast('Impressão enviada.', 'success');
    } catch (err) { console.error('[LabelGen] Print error:', err); toast('Erro ao imprimir.', 'error'); }
  }, [product, labelType, copies, excessQty, shelfFonts, excessFonts, toast]);

  // ── PNG ────────────────────────────────────────────────────────────────
  const handlePNG = useCallback(async () => {
    if (!product || !captureRef.current) { toast('Produto não selecionado.', 'error'); return; }
    setBusy(true);
    try {
      console.log('[LabelGen] PNG start');
      await downloadPNG(captureRef.current, product.sku, labelType);
      await logLabelGeneration(product.sku, labelType, 1);
      toast('PNG baixado com sucesso.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LabelGen] PNG error:', err);
      toast(`Erro ao gerar PNG: ${msg}`, 'error');
    } finally { setBusy(false); }
  }, [product, labelType, toast]);

  // ── PDF ────────────────────────────────────────────────────────────────
  const handlePDF = useCallback(async () => {
    if (!product || !captureRef.current) { toast('Produto não selecionado.', 'error'); return; }
    setBusy(true);
    try {
      console.log('[LabelGen] PDF start, copies:', copies);
      await downloadPDF(captureRef.current, product.sku, labelType, copies);
      await logLabelGeneration(product.sku, labelType, copies);
      toast('PDF gerado com sucesso.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LabelGen] PDF error:', err);
      toast(`Erro ao gerar PDF: ${msg}`, 'error');
    } finally { setBusy(false); }
  }, [product, labelType, copies, toast]);

  // ── Batch ──────────────────────────────────────────────────────────────
  const loadBatch = useCallback(async () => {
    setBatchLoading(true);
    try {
      let q = supabase.from('products').select('id, name, sku, ean, location, price').order('name').limit(300);
      if (batchSearch.trim()) q = q.or(`name.ilike.%${batchSearch.trim()}%,sku.ilike.%${batchSearch.trim()}%,ean.ilike.%${batchSearch.trim()}%`);
      if (batchLocation.trim()) q = q.ilike('location', `%${batchLocation.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      setBatchProducts((data as DbProduct[]) || []);
    } catch (err) {
      console.error('[LabelGen] Batch load error:', err);
      toast('Erro ao carregar produtos.', 'error');
    } finally { setBatchLoading(false); }
  }, [batchSearch, batchLocation, toast]);

  useEffect(() => { if (mode === 'batch') loadBatch(); }, [mode, loadBatch]);

  const handleBatchPrint = useCallback(() => {
    const selected = batchProducts.filter(p => selectedIds.has(p.id));
    if (!selected.length) { toast('Selecione ao menos um produto.', 'error'); return; }
    removePrintStyle();
    injectPrintStyle(batchLabelType);
    const area = document.createElement('div');
    area.id = '_label_print_area';
    document.body.appendChild(area);
    const root = createRoot(area);
    const allLabels = selected.flatMap(p => Array.from({ length: batchCopies }, (_, i) => ({ p, i })));
    root.render(React.createElement(React.Fragment, null,
      ...allLabels.map(({ p, i }, gi) =>
        React.createElement('div', {
          key: `${p.id}-${i}`,
          style: { pageBreakAfter: gi < allLabels.length - 1 ? 'always' : 'auto', pageBreakInside: 'avoid' },
        },
          batchLabelType === 'shelf'
            ? React.createElement(ShelfLabel100x40, { product: labelAsProduct(p), fonts: shelfFonts })
            : React.createElement(ExcessLabel100x150, { product: labelAsProduct(p), excessQty: batchExcessQty, fonts: excessFonts })
        )
      )
    ));
    setTimeout(() => {
      window.print();
      window.addEventListener('afterprint', () => {
        root.unmount(); removePrintStyle();
        Promise.all(selected.map(p => logLabelGeneration(p.sku, batchLabelType, batchCopies)));
        toast(`${allLabels.length} etiqueta(s) impressa(s).`, 'success');
      }, { once: true });
    }, 250);
  }, [batchProducts, selectedIds, batchLabelType, batchCopies, batchExcessQty, shelfFonts, excessFonts, toast]);

  const handleBatchPDF = useCallback(async () => {
    const selected = batchProducts.filter(p => selectedIds.has(p.id));
    if (!selected.length) { toast('Selecione ao menos um produto.', 'error'); return; }
    setBusy(true);
    try {
      const wMM = 100; const hMM = batchLabelType === 'shelf' ? 40 : 150;
      const pdf = new jsPDF({ orientation: wMM >= hMM ? 'landscape' : 'portrait', unit: 'mm', format: [wMM, hMM] });
      let pg = 0;
      for (const p of selected) {
        const canvas = await captureProductLabel(labelAsProduct(p), batchLabelType, batchExcessQty, shelfFonts, excessFonts);
        const imgData = canvas.toDataURL('image/png');
        for (let c = 0; c < batchCopies; c++) {
          if (pg > 0) pdf.addPage([wMM, hMM], wMM >= hMM ? 'landscape' : 'portrait');
          pdf.addImage(imgData, 'PNG', 0, 0, wMM, hMM);
          pg++;
        }
      }
      pdf.save(`etiquetas-lote-${new Date().toISOString().slice(0, 10)}.pdf`);
      await Promise.all(selected.map(p => logLabelGeneration(p.sku, batchLabelType, batchCopies)));
      toast(`PDF com ${pg} etiqueta(s) gerado.`, 'success');
    } catch (err: unknown) {
      console.error('[LabelGen] Batch PDF error:', err);
      toast('Erro ao gerar PDF em lote.', 'error');
    } finally { setBusy(false); }
  }, [batchProducts, selectedIds, batchLabelType, batchCopies, batchExcessQty, shelfFonts, excessFonts, toast]);

  const handleClear = () => { setProduct(null); setNotFound(false); setSearchQuery(''); setExcessQty(0); setCopies(1); };
  const toggleSelect = (id: string) => setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(p => p.size === batchProducts.length ? new Set() : new Set(batchProducts.map(x => x.id)));

  const labelProduct = product ? labelAsProduct(product) : null;
  const activeFonts = labelType === 'shelf' ? shelfFonts : excessFonts;

  return (
    <div className="min-h-screen bg-surface-3">

      {/* OFF-SCREEN CAPTURE TARGET — real mm size, read by html2canvas */}
      {labelProduct && (
        <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1, pointerEvents: 'none' }} aria-hidden>
          {labelType === 'shelf'
            ? <ShelfLabel100x40 ref={captureRef} product={labelProduct} fonts={shelfFonts} />
            : <ExcessLabel100x150 ref={captureRef} product={labelProduct} excessQty={excessQty} fonts={excessFonts} />
          }
        </div>
      )}

      <ToastStack toasts={toasts} />

      {/* HEADER */}
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
              <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
            </button>
            <div className="flex items-center gap-2">
              <Tag size={22} className="text-accent" />
              <div>
                <h1 className="text-title leading-tight">Gerador de Etiquetas</h1>
                <p className="text-xs text-fg-subtle hidden sm:block">Vão 100×40mm · Excesso 100×150mm</p>
              </div>
            </div>
          </div>
          <div className="flex items-center bg-surface-3 rounded-lg p-1 gap-1">
            {(['single', 'batch'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1.5 ${mode === m ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg'}`}>
                {m === 'batch' ? <><Layers size={14} />Lote</> : 'Unitário'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ══ SINGLE MODE ═══════════════════════════════════════════════════ */}
        {mode === 'single' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* LEFT */}
            <div className="space-y-4">

              {/* SEARCH */}
              <div className="bg-surface-2 rounded-xl border border-edge p-5">
                <h2 className="font-bold text-fg text-sm mb-4 flex items-center gap-2">
                  <Search size={16} className="text-fg-subtle" />Buscar Produto
                </h2>
                <div className="flex gap-2 mb-3">
                  {(['sku', 'ean'] as const).map(t => (
                    <button key={t} onClick={() => setSearchType(t)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${searchType === t ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'}`}>
                      Por {t.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input type="text"
                    placeholder={searchType === 'sku' ? 'Digite o SKU...' : 'Digite o EAN...'}
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setNotFound(false); }}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    className="flex-1 px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                    className="px-4 py-2.5 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2 transition">
                    {searching ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                  </button>
                </div>
                {notFound && (
                  <div className="mt-3 flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
                    <AlertTriangle size={16} />Produto não encontrado. Verifique o SKU ou EAN.
                  </div>
                )}
              </div>

              {/* PRODUCT INFO */}
              {product && (
                <div className="bg-surface-2 rounded-xl border border-emerald-500/20 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-emerald-700 dark:text-emerald-400 text-sm flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />Produto Encontrado
                    </h2>
                    <button onClick={handleClear} className="text-fg-subtle hover:text-fg-muted"><X size={16} /></button>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs text-fg-subtle font-semibold uppercase mb-0.5">Nome</p>
                    <p className="font-bold text-fg text-sm">{product.name}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-edge">
                    {[['SKU', product.sku], ['EAN', product.ean || '—'], ['Local', product.location || '—']].map(([l, v]) => (
                      <div key={l} className="min-w-0">
                        <p className="text-xs text-fg-subtle font-semibold uppercase mb-0.5">{l}</p>
                        <p className="font-mono font-bold text-fg text-xs truncate">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LABEL TYPE + CONFIG */}
              <div className="bg-surface-2 rounded-xl border border-edge p-5">
                <h2 className="font-bold text-fg text-sm mb-4 flex items-center gap-2">
                  <Tag size={16} className="text-fg-subtle" />Configurações
                </h2>

                {/* Type */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">Tipo de Etiqueta</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setLabelType('shelf')}
                      className={`p-3 rounded-lg border-2 text-left transition ${labelType === 'shelf' ? 'border-accent bg-accent/10' : 'border-edge bg-surface-2 hover:border-fg-subtle'}`}>
                      <p className={`font-bold text-xs ${labelType === 'shelf' ? 'text-accent' : 'text-fg-muted'}`}>Etiqueta de Vão</p>
                      <p className="text-xs text-fg-subtle mt-0.5">100 × 40mm</p>
                    </button>
                    <button onClick={() => setLabelType('excess')}
                      className={`p-3 rounded-lg border-2 text-left transition ${labelType === 'excess' ? 'border-accent bg-accent/10' : 'border-edge bg-surface-2 hover:border-fg-subtle'}`}>
                      <p className={`font-bold text-xs ${labelType === 'excess' ? 'text-accent' : 'text-fg-muted'}`}>Excesso de Estoque</p>
                      <p className="text-xs text-fg-subtle mt-0.5">100 × 150mm</p>
                    </button>
                  </div>
                </div>

                {/* Excess qty */}
                {labelType === 'excess' && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Quantidade em Excesso</label>
                    <input type="number" min="0" value={excessQty} onChange={e => setExcessQty(Number(e.target.value))}
                      className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
                  </div>
                )}

                {/* Copies */}
                <div>
                  <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Quantidade de Cópias</label>
                  <input type="number" min="1" max="999" value={copies} onChange={e => setCopies(Math.max(1, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
                </div>
              </div>

              {/* FONT SETTINGS */}
              <div className="bg-surface-2 rounded-xl border border-edge p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-fg text-sm flex items-center gap-2">
                    <span className="text-base">Aa</span> Tamanho das Fontes
                  </h2>
                  <button onClick={resetFonts}
                    className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg font-semibold transition border border-edge rounded-lg px-2.5 py-1.5 hover:bg-surface-3">
                    <RotateCcw size={12} />Restaurar padrão
                  </button>
                </div>

                {labelType === 'shelf' ? (
                  <div className="space-y-3">
                    <FontSlider label="Nome" value={shelfFonts.nameSize} min={10} max={28} onChange={v => updateShelf('nameSize', v)} />
                    <FontSlider label="Localização" value={shelfFonts.locationSize} min={10} max={26} onChange={v => updateShelf('locationSize', v)} />
                    <FontSlider label="SKU" value={shelfFonts.skuSize} min={10} max={24} onChange={v => updateShelf('skuSize', v)} />
                    <FontSlider label="EAN / GTIN" value={shelfFonts.eanSize} min={16} max={40} onChange={v => updateShelf('eanSize', v)} />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FontSlider label="Nome" value={excessFonts.nameSize} min={10} max={24} onChange={v => updateExcess('nameSize', v)} />
                    <FontSlider label="Localização" value={excessFonts.locationSize} min={8} max={20} onChange={v => updateExcess('locationSize', v)} />
                    <FontSlider label="SKU" value={excessFonts.skuSize} min={8} max={18} onChange={v => updateExcess('skuSize', v)} />
                    <FontSlider label="EAN / GTIN" value={excessFonts.eanSize} min={10} max={26} onChange={v => updateExcess('eanSize', v)} />
                    <div className="pt-1 border-t border-edge">
                      <FontSlider label="Qtd Excesso" value={excessFonts.qtySize} min={20} max={80} onChange={v => updateExcess('qtySize', v)} />
                    </div>
                  </div>
                )}

                <p className="mt-3 text-xs text-fg-subtle">
                  Ajustes salvos automaticamente. Aplicados em pré-visualização, impressão, PNG e PDF.
                </p>
              </div>

              {/* ACTIONS */}
              {product && (
                <div className="bg-surface-2 rounded-xl border border-edge p-5">
                  <h2 className="font-bold text-fg text-sm mb-3">Ações</h2>
                  <div className="space-y-2">
                    <button onClick={handlePrint} disabled={busy}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-bold transition disabled:opacity-60">
                      <Printer size={16} />Imprimir {copies > 1 ? `(${copies} cópias)` : ''}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={handlePNG} disabled={busy}
                        className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                        {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}Download PNG
                      </button>
                      <button onClick={handlePDF} disabled={busy}
                        className="flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                        {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}Download PDF
                      </button>
                    </div>
                    <button onClick={handleClear}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-surface-3 hover:bg-edge text-fg-muted rounded-lg text-sm font-semibold transition">
                      <X size={14} />Limpar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT — PREVIEW */}
            <div>
              <div className="bg-surface-2 rounded-xl border border-edge p-5 sticky top-28">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-fg text-sm">Pré-visualização</h2>
                  <span className="text-xs text-fg-subtle">{labelType === 'shelf' ? '100 × 40mm' : '100 × 150mm'}</span>
                </div>

                {!labelProduct ? (
                  <div className="flex flex-col items-center justify-center py-16 text-fg-subtle">
                    <Tag size={48} className="mb-3 opacity-20" />
                    <p className="text-sm text-center">Busque um produto para visualizar</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    {/* PREVIEW: same component, scaled wrapper */}
                    <div style={{
                      width: labelType === 'shelf' ? SHELF_PX_W * SHELF_SCALE : EXCESS_PX_W * EXCESS_SCALE,
                      height: labelType === 'shelf' ? SHELF_PX_H * SHELF_SCALE : EXCESS_PX_H * EXCESS_SCALE,
                      overflow: 'hidden', position: 'relative',
                      borderRadius: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.12)', flexShrink: 0,
                    }}>
                      <div style={{
                        transform: `scale(${labelType === 'shelf' ? SHELF_SCALE : EXCESS_SCALE})`,
                        transformOrigin: 'top left', position: 'absolute', top: 0, left: 0,
                      }}>
                        {labelType === 'shelf'
                          ? <ShelfLabel100x40 product={labelProduct} fonts={shelfFonts} />
                          : <ExcessLabel100x150 product={labelProduct} excessQty={excessQty} fonts={excessFonts} />
                        }
                      </div>
                    </div>

                    {/* Font summary badge */}
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {labelType === 'shelf' ? (
                        <>
                          {[
                            { l: 'Nome', v: shelfFonts.nameSize },
                            { l: 'Local', v: shelfFonts.locationSize },
                            { l: 'SKU', v: shelfFonts.skuSize },
                            { l: 'EAN', v: shelfFonts.eanSize },
                          ].map(({ l, v }) => (
                            <span key={l} className="text-xs bg-surface-3 text-fg-muted px-2 py-0.5 rounded-full font-mono">
                              {l}: {v}px
                            </span>
                          ))}
                        </>
                      ) : (
                        <>
                          {[
                            { l: 'Nome', v: excessFonts.nameSize },
                            { l: 'Local', v: excessFonts.locationSize },
                            { l: 'SKU', v: excessFonts.skuSize },
                            { l: 'EAN', v: excessFonts.eanSize },
                            { l: 'Qtd', v: excessFonts.qtySize },
                          ].map(({ l, v }) => (
                            <span key={l} className="text-xs bg-surface-3 text-fg-muted px-2 py-0.5 rounded-full font-mono">
                              {l}: {v}px
                            </span>
                          ))}
                        </>
                      )}
                    </div>

                    <p className="text-xs text-fg-subtle text-center">
                      Visualização ampliada. Download e impressão saem em tamanho real.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══ BATCH MODE ════════════════════════════════════════════════════ */}
        {mode === 'batch' && (
          <div className="space-y-4">
            <div className="bg-surface-2 rounded-xl border border-edge p-5">
              <h2 className="font-bold text-fg text-sm mb-4 flex items-center gap-2">
                <Search size={16} className="text-fg-subtle" />Filtros
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Buscar', value: batchSearch, onChange: setBatchSearch, placeholder: 'Nome, SKU ou EAN...' },
                  { label: 'Localização', value: batchLocation, onChange: setBatchLocation, placeholder: 'Ex: A-01...' },
                ].map(f => (
                  <div key={f.label}>
                    <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">{f.label}</label>
                    <input type="text" value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                      className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Tipo</label>
                  <select value={batchLabelType} onChange={e => setBatchLabelType(e.target.value as LabelType)}
                    className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg">
                    <option value="shelf">Vão — 100×40mm</option>
                    <option value="excess">Excesso — 100×150mm</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Cópias/produto</label>
                  <input type="number" min="1" max="99" value={batchCopies} onChange={e => setBatchCopies(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
                </div>
              </div>
              {batchLabelType === 'excess' && (
                <div className="mt-3 max-w-xs">
                  <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Qtd em Excesso (padrão)</label>
                  <input type="number" min="0" value={batchExcessQty} onChange={e => setBatchExcessQty(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono" />
                </div>
              )}
              <div className="mt-4">
                <button onClick={loadBatch} disabled={batchLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                  {batchLoading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}Buscar
                </button>
              </div>
            </div>

            {selectedIds.size > 0 && (
              <div className="bg-accent/10 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-accent">
                  {selectedIds.size} produto(s) · {selectedIds.size * batchCopies} etiqueta(s)
                  <span className="ml-2 text-xs font-normal text-fg-muted">
                    (fontes: {batchLabelType === 'shelf' ? `Nome ${shelfFonts.nameSize}px · EAN ${shelfFonts.eanSize}px` : `Qtd ${excessFonts.qtySize}px`})
                  </span>
                </p>
                <div className="flex gap-2">
                  <button onClick={handleBatchPrint} disabled={busy}
                    className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold transition disabled:opacity-60">
                    {busy ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />}Imprimir
                  </button>
                  <button onClick={handleBatchPDF} disabled={busy}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-3 hover:bg-edge text-fg rounded-lg text-sm font-semibold transition disabled:opacity-60">
                    {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}PDF
                  </button>
                  <button onClick={() => setSelectedIds(new Set())} className="px-3 py-2 bg-edge hover:bg-fg-subtle/30 text-fg-muted rounded-lg">
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className="bg-surface-2 rounded-xl border border-edge overflow-hidden">
              <div className="bg-surface-3 px-4 py-3 border-b border-edge flex items-center justify-between">
                <h2 className="font-bold text-fg text-sm">Produtos ({batchProducts.length})</h2>
                <button onClick={toggleAll} className="text-xs text-fg-muted hover:text-fg flex items-center gap-1.5 font-medium">
                  {selectedIds.size === batchProducts.length && batchProducts.length > 0
                    ? <><CheckSquare size={14} />Desmarcar todos</>
                    : <><Square size={14} />Marcar todos</>}
                </button>
              </div>
              {batchLoading ? (
                <div className="flex items-center justify-center py-12 text-fg-subtle gap-2">
                  <RefreshCw size={20} className="animate-spin" />Carregando...
                </div>
              ) : batchProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-fg-subtle">
                  <Package size={40} className="mb-2 opacity-30" />
                  <p className="text-sm">Nenhum produto encontrado.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-3 border-b border-edge">
                      <tr>
                        {['', 'Nome', 'SKU', 'EAN', 'Local'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-fg-subtle uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {batchProducts.map(p => (
                        <tr key={p.id} onClick={() => toggleSelect(p.id)}
                          className={`cursor-pointer transition ${selectedIds.has(p.id) ? 'bg-emerald-50 hover:bg-emerald-100' : 'hover:bg-surface-3'}`}>
                          <td className="px-4 py-3">
                            {selectedIds.has(p.id) ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} className="text-fg-subtle" />}
                          </td>
                          <td className="px-4 py-3 font-medium text-fg max-w-[200px] truncate">{p.name}</td>
                          <td className="px-4 py-3 font-mono text-fg-muted text-xs">{p.sku}</td>
                          <td className="px-4 py-3 font-mono text-fg-subtle text-xs">{p.ean || '—'}</td>
                          <td className="px-4 py-3 text-fg-muted">{p.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Helper ────────────────────────────────────────────────────────────────────
function labelAsProduct(p: DbProduct | LabelProduct): LabelProduct {
  return { name: p.name, sku: p.sku, ean: p.ean || '', location: p.location || '' };
}
