import { CUSTOM_SIZE_ID, SIZE_PRESETS } from '../../lib/pdfCenter/sizePresets';
import { Input, Select } from '../ui';

interface SizePresetFieldProps {
  presetId: string;
  customWidthMm: number;
  customHeightMm: number;
  onPresetChange: (id: string) => void;
  onCustomChange: (widthMm: number, heightMm: number) => void;
}

export function SizePresetField({ presetId, customWidthMm, customHeightMm, onPresetChange, onCustomChange }: SizePresetFieldProps) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-fg-muted">Tamanho da página de destino</label>
      <Select value={presetId} onChange={e => onPresetChange(e.target.value)}>
        <optgroup label="Etiquetas térmicas">
          {SIZE_PRESETS.filter(p => p.category === 'termica').map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </optgroup>
        <optgroup label="Papel">
          {SIZE_PRESETS.filter(p => p.category === 'papel').map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </optgroup>
        <option value={CUSTOM_SIZE_ID}>Personalizado...</option>
      </Select>
      {presetId === CUSTOM_SIZE_ID && (
        <div className="flex items-center gap-2">
          <Input type="number" min={1} step={0.1} value={customWidthMm} onChange={e => onCustomChange(Number(e.target.value), customHeightMm)} className="w-24" aria-label="Largura em mm" />
          <span className="text-fg-subtle text-sm">×</span>
          <Input type="number" min={1} step={0.1} value={customHeightMm} onChange={e => onCustomChange(customWidthMm, Number(e.target.value))} className="w-24" aria-label="Altura em mm" />
          <span className="text-fg-subtle text-sm">mm</span>
        </div>
      )}
    </div>
  );
}

interface MarginFieldProps {
  marginMm: number;
  onChange: (value: number) => void;
}

export function MarginField({ marginMm, onChange }: MarginFieldProps) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-fg-muted">Margem (mm, igual nos 4 lados)</label>
      <Input type="number" min={0} step={0.5} value={marginMm} onChange={e => onChange(Number(e.target.value))} className="w-28" />
    </div>
  );
}
