import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui';
import { COMPARATOR_PRESETS, ComparatorPresetId } from '../../lib/spreadsheet-comparator/types';

interface PresetStepProps {
  preset: ComparatorPresetId;
  labelA: string;
  labelB: string;
  onSelectPreset: (id: ComparatorPresetId) => void;
  onLabelAChange: (value: string) => void;
  onLabelBChange: (value: string) => void;
  onNext: () => void;
}

export const PresetStep: React.FC<PresetStepProps> = ({ preset, labelA, labelB, onSelectPreset, onLabelAChange, onLabelBChange, onNext }) => (
  <div className="space-y-5">
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-1">Tipo de comparação</h2>
      <p className="text-xs text-fg-subtle mb-4">Os modelos abaixo só sugerem nomes e configurações — você pode alterar qualquer campo depois.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COMPARATOR_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectPreset(p.id)}
            className={`text-left p-4 rounded-lg border-2 transition ${preset === p.id ? 'border-accent bg-accent/10' : 'border-edge hover:border-fg-subtle'}`}
          >
            <p className={`font-bold text-sm ${preset === p.id ? 'text-accent' : 'text-fg'}`}>{p.label}</p>
            <p className="text-xs text-fg-subtle mt-1">{p.description}</p>
          </button>
        ))}
      </div>
    </div>

    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-4">Nomes das bases</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Planilha A</label>
          <input value={labelA} onChange={e => onLabelAChange(e.target.value)}
            className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Planilha B</label>
          <input value={labelB} onChange={e => onLabelBChange(e.target.value)}
            className="w-full px-3 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
        </div>
      </div>
    </div>

    <div className="flex justify-end">
      <Button onClick={onNext}>Continuar<ArrowRight size={16} /></Button>
    </div>
  </div>
);

export default PresetStep;
