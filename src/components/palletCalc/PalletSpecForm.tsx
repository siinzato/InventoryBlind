import { Input, Select } from '../ui';
import { parsePositiveNumber, toMm, type LengthUnit } from '../../lib/palletCalc/units';
import { PALLET_PRESETS, CUSTOM_PALLET_ID, findPalletPreset } from '../../lib/palletCalc/palletPresets';
import type { PalletSpec } from '../../lib/palletCalc/types';
import type { CustomPalletPreset } from '../../lib/palletCalc/palletCalcPrefs';

interface PalletSpecFormProps {
  pallet: PalletSpec;
  onChange: (pallet: PalletSpec) => void;
  presetId: string;
  onPresetChange: (id: string) => void;
  lengthUnit: LengthUnit;
  customPallets: CustomPalletPreset[];
}

export function PalletSpecForm({ pallet, onChange, presetId, onPresetChange, lengthUnit, customPallets }: PalletSpecFormProps) {
  const handlePresetChange = (id: string) => {
    onPresetChange(id);
    if (id === CUSTOM_PALLET_ID) return;
    const custom = customPallets.find(p => p.id === id);
    if (custom) { onChange({ name: custom.label, ...custom.spec }); return; }
    const preset = findPalletPreset(id);
    if (preset) onChange({ name: preset.label, ...preset.spec });
  };

  const num = (text: string) => parsePositiveNumber(text) ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Palete</label>
        <Select value={presetId} onChange={e => handlePresetChange(e.target.value)} className="w-56">
          {PALLET_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          {customPallets.map(p => <option key={p.id} value={p.id}>{p.label} (personalizado)</option>)}
          <option value={CUSTOM_PALLET_ID}>Personalizado...</option>
        </Select>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Comprimento ({lengthUnit})</label>
          <Input type="number" min={0} step="any" defaultValue={pallet.lengthMm} key={`pl-${pallet.lengthMm}`} onBlur={e => onChange({ ...pallet, lengthMm: toMm(num(e.target.value), lengthUnit) })} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Largura ({lengthUnit})</label>
          <Input type="number" min={0} step="any" defaultValue={pallet.widthMm} key={`pw-${pallet.widthMm}`} onBlur={e => onChange({ ...pallet, widthMm: toMm(num(e.target.value), lengthUnit) })} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Altura do palete (mm)</label>
          <Input type="number" min={0} step="any" value={pallet.heightMm} onChange={e => onChange({ ...pallet, heightMm: Number(e.target.value) || 0 })} className="w-28" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Tara (kg)</label>
          <Input type="number" min={0} step="any" value={pallet.tareKg} onChange={e => onChange({ ...pallet, tareKg: Number(e.target.value) || 0 })} className="w-24" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Capacidade máxima de carga (kg)</label>
          <Input type="number" min={0} step="any" value={pallet.maxLoadKg} onChange={e => onChange({ ...pallet, maxLoadKg: Number(e.target.value) || 0 })} className="w-32" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Altura total máxima (mm)</label>
          <Input type="number" min={0} step="any" value={pallet.maxTotalHeightMm} onChange={e => onChange({ ...pallet, maxTotalHeightMm: Number(e.target.value) || 0 })} className="w-32" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Limite operacional de camadas</label>
          <Input type="number" min={1} step={1} value={pallet.operationalMaxLayers ?? ''} onChange={e => onChange({ ...pallet, operationalMaxLayers: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined })} className="w-28" placeholder="sem limite" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Overhang permitido por lado (mm, padrão 0)</label>
        <div className="flex flex-wrap gap-2">
          {(['front', 'back', 'left', 'right'] as const).map(side => (
            <div key={side} className="flex items-center gap-1.5">
              <span className="text-xs text-fg-subtle w-14 capitalize">{{ front: 'Frente', back: 'Trás', left: 'Esq.', right: 'Dir.' }[side]}</span>
              <Input type="number" min={0} step="any" value={pallet.overhangMm[side]} onChange={e => onChange({ ...pallet, overhangMm: { ...pallet.overhangMm, [side]: Number(e.target.value) || 0 } })} className="w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Apoio mínimo entre camadas alternadas (%)</label>
        <Input type="number" min={0} max={100} step={1} value={pallet.minSupportPct ?? ''} onChange={e => onChange({ ...pallet, minSupportPct: e.target.value ? Number(e.target.value) : undefined })} className="w-24" placeholder="sem exigência" />
      </div>
    </div>
  );
}
