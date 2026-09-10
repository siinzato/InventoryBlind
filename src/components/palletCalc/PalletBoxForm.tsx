import { Input, Select } from '../ui';
import { parsePositiveNumber, toMm, toKg, type LengthUnit, type WeightUnit } from '../../lib/palletCalc/units';
import type { BoxSpec, RotationPolicy } from '../../lib/palletCalc/types';

interface PalletBoxFormProps {
  box: BoxSpec;
  onChange: (box: BoxSpec) => void;
  lengthUnit: LengthUnit;
  onLengthUnitChange: (unit: LengthUnit) => void;
  weightUnit: WeightUnit;
  onWeightUnitChange: (unit: WeightUnit) => void;
}

/** Os campos de dimensão/peso mostram o valor JÁ CONVERTIDO na unidade
 *  escolhida (não guardam a unidade por campo) — troca de unidade só muda a
 *  visualização, `box` continua sempre em mm/kg internamente (spec §3). */
export function PalletBoxForm({ box, onChange, lengthUnit, onLengthUnitChange, weightUnit, onWeightUnitChange }: PalletBoxFormProps) {
  const displayLength = (box.lengthMm / (lengthUnit === 'mm' ? 1 : lengthUnit === 'cm' ? 10 : 1000)).toString();
  const displayWidth = (box.widthMm / (lengthUnit === 'mm' ? 1 : lengthUnit === 'cm' ? 10 : 1000)).toString();
  const displayHeight = (box.heightMm / (lengthUnit === 'mm' ? 1 : lengthUnit === 'cm' ? 10 : 1000)).toString();
  const displayWeight = (box.weightKg / (weightUnit === 'kg' ? 1 : 0.001)).toString();

  const setDim = (field: 'lengthMm' | 'widthMm' | 'heightMm', text: string) => {
    const value = parsePositiveNumber(text);
    if (value == null) return;
    onChange({ ...box, [field]: toMm(value, lengthUnit) });
  };

  const setWeight = (text: string) => {
    const value = parsePositiveNumber(text);
    if (value == null) return;
    onChange({ ...box, weightKg: toKg(value, weightUnit) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">SKU</label>
          <Input value={box.sku ?? ''} onChange={e => onChange({ ...box, sku: e.target.value || undefined })} className="w-32" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Descrição</label>
          <Input value={box.description ?? ''} onChange={e => onChange({ ...box, description: e.target.value || undefined })} className="w-56" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Comprimento</label>
          <Input type="number" min={0} step="any" defaultValue={displayLength} key={`l-${lengthUnit}`} onBlur={e => setDim('lengthMm', e.target.value)} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Largura</label>
          <Input type="number" min={0} step="any" defaultValue={displayWidth} key={`w-${lengthUnit}`} onBlur={e => setDim('widthMm', e.target.value)} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Altura</label>
          <Input type="number" min={0} step="any" defaultValue={displayHeight} key={`h-${lengthUnit}`} onBlur={e => setDim('heightMm', e.target.value)} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Unidade</label>
          <Select value={lengthUnit} onChange={e => onLengthUnitChange(e.target.value as LengthUnit)} className="w-20">
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Peso unitário</label>
          <Input type="number" min={0} step="any" defaultValue={displayWeight} key={`wt-${weightUnit}`} onBlur={e => setWeight(e.target.value)} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Unidade</label>
          <Select value={weightUnit} onChange={e => onWeightUnitChange(e.target.value as WeightUnit)} className="w-20">
            <option value="g">g</option>
            <option value="kg">kg</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Quantidade total</label>
          <Input type="number" min={1} step={1} value={box.quantity} onChange={e => onChange({ ...box, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="w-28" />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Rotação permitida</label>
          <Select value={box.rotation} onChange={e => onChange({ ...box, rotation: e.target.value as RotationPolicy })} className="w-52">
            <option value="none">Sem rotação</option>
            <option value="base90">Apenas rotação de 90° na base</option>
            <option value="any">Qualquer orientação permitida</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg pb-2.5">
          <input type="checkbox" checked={box.stackable} onChange={e => onChange({ ...box, stackable: e.target.checked })} />
          Empilhável
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Máximo de camadas (opcional)</label>
          <Input type="number" min={1} step={1} value={box.maxLayers ?? ''} onChange={e => onChange({ ...box, maxLayers: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : undefined })} className="w-28" placeholder="sem limite" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Carga máx. sobre a caixa, kg (opcional)</label>
          <Input type="number" min={0} step="any" value={box.maxLoadOnBoxKg ?? ''} onChange={e => onChange({ ...box, maxLoadOnBoxKg: e.target.value ? Number(e.target.value) : undefined })} className="w-32" placeholder="sem limite" />
        </div>
      </div>
    </div>
  );
}
