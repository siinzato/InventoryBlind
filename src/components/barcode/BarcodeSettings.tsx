import React from 'react';
import { RotateCcw } from 'lucide-react';
import {
  BarcodeLabSettings, BarcodeSymbology, LABEL_SIZES, LabelSizeId,
  CUSTOM_SIZE_LIMITS_MM, BARCODE_SETTINGS_LIMITS, symbologyInfo,
} from '../../lib/barcode/barcodeTypes';

interface BarcodeSettingsProps {
  settings: BarcodeLabSettings;
  symbology: BarcodeSymbology;
  onChange: (patch: Partial<BarcodeLabSettings>) => void;
  onReset: () => void;
}

interface SliderProps { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }

const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 0.05, suffix = 'x', onChange }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-fg-subtle w-28 font-medium flex-shrink-0">{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
      className="flex-1 accent-accent h-1.5 cursor-pointer" />
    <span className="text-xs font-mono font-bold text-fg-muted w-12 text-right flex-shrink-0">{value.toFixed(2)}{suffix}</span>
  </div>
);

interface ToggleProps { label: string; checked: boolean; onChange: (v: boolean) => void }

const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer select-none">
    <span className="text-sm text-fg-muted">{label}</span>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-accent w-4 h-4 cursor-pointer" />
  </label>
);

/** Personalização — tamanho, campos visíveis, escalas e cópias. Persistido pelo caller em localStorage. */
export const BarcodeSettings: React.FC<BarcodeSettingsProps> = ({ settings, symbology, onChange, onReset }) => {
  const info = symbologyInfo(symbology);

  return (
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-fg text-sm">Personalização</h2>
        <button onClick={onReset} className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg font-semibold transition border border-edge rounded-lg px-2.5 py-1.5 hover:bg-surface-3">
          <RotateCcw size={12} />Restaurar padrão
        </button>
      </div>

      {/* Tamanho */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-fg-subtle uppercase mb-2">Tamanho da etiqueta</label>
        <select
          value={settings.sizeId}
          onChange={e => onChange({ sizeId: e.target.value as LabelSizeId })}
          className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          {LABEL_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          <option value="custom">Personalizado</option>
        </select>
        {settings.sizeId === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-xs text-fg-subtle mb-1">Largura (mm)</label>
              <input type="number" min={CUSTOM_SIZE_LIMITS_MM.minWidth} max={CUSTOM_SIZE_LIMITS_MM.maxWidth}
                value={settings.customWidthMm}
                onChange={e => onChange({ customWidthMm: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="block text-xs text-fg-subtle mb-1">Altura (mm)</label>
              <input type="number" min={CUSTOM_SIZE_LIMITS_MM.minHeight} max={CUSTOM_SIZE_LIMITS_MM.maxHeight}
                value={settings.customHeightMm}
                onChange={e => onChange({ customHeightMm: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <p className="col-span-2 text-xs text-fg-subtle">
              Limites: {CUSTOM_SIZE_LIMITS_MM.minWidth}–{CUSTOM_SIZE_LIMITS_MM.maxWidth}mm (largura), {CUSTOM_SIZE_LIMITS_MM.minHeight}–{CUSTOM_SIZE_LIMITS_MM.maxHeight}mm (altura).
            </p>
          </div>
        )}
      </div>

      {/* Campos visíveis */}
      <div className="mb-4 border-t border-edge pt-3">
        <p className="text-xs font-semibold text-fg-subtle uppercase mb-1">Campos visíveis</p>
        <Toggle label="Nome" checked={settings.showName} onChange={v => onChange({ showName: v })} />
        <Toggle label="SKU" checked={settings.showSku} onChange={v => onChange({ showSku: v })} />
        <Toggle label="Localização" checked={settings.showLocation} onChange={v => onChange({ showLocation: v })} />
        <Toggle label="Lote" checked={settings.showLot} onChange={v => onChange({ showLot: v })} />
        <Toggle label="Validade" checked={settings.showExpiry} onChange={v => onChange({ showExpiry: v })} />
        <Toggle label="Quantidade" checked={settings.showQuantity} onChange={v => onChange({ showQuantity: v })} />
        <Toggle label="Valor legível" checked={settings.showHumanReadable} onChange={v => onChange({ showHumanReadable: v })} />
      </div>

      {/* Escalas */}
      <div className="mb-4 border-t border-edge pt-3 space-y-2.5">
        <p className="text-xs font-semibold text-fg-subtle uppercase mb-1">Ajustes</p>
        <Slider label="Tamanho da fonte" value={settings.fontScale} min={BARCODE_SETTINGS_LIMITS.fontScale.min} max={BARCODE_SETTINGS_LIMITS.fontScale.max} onChange={v => onChange({ fontScale: v })} />
        <Slider label="Escala do código" value={settings.barcodeScale} min={BARCODE_SETTINGS_LIMITS.barcodeScale.min} max={BARCODE_SETTINGS_LIMITS.barcodeScale.max} onChange={v => onChange({ barcodeScale: v })} />
      </div>

      {/* ECC — só QR Code suporta o nível de correção configurável no bwip-js */}
      {info.id === 'qrcode' && (
        <div className="mb-4 border-t border-edge pt-3">
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Nível de correção de erro (QR)</label>
          <select value={settings.eccLevel} onChange={e => onChange({ eccLevel: e.target.value as BarcodeLabSettings['eccLevel'] })}
            className="w-full px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
            <option value="L">L — Baixo (~7%)</option>
            <option value="M">M — Médio (~15%)</option>
            <option value="Q">Q — Alto (~25%)</option>
            <option value="H">H — Máximo (~30%)</option>
          </select>
        </div>
      )}

      {/* Cópias */}
      <div className="border-t border-edge pt-3">
        <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Quantidade de cópias</label>
        <input type="number" min={BARCODE_SETTINGS_LIMITS.copies.min} max={BARCODE_SETTINGS_LIMITS.copies.max}
          value={settings.copies}
          onChange={e => onChange({ copies: Math.max(BARCODE_SETTINGS_LIMITS.copies.min, Number(e.target.value)) })}
          className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40" />
      </div>

      <p className="mt-3 text-xs text-fg-subtle">
        Ajustes salvos automaticamente. Aplicados em pré-visualização, impressão, PNG, SVG e PDF.
      </p>
    </div>
  );
};

export default BarcodeSettings;
