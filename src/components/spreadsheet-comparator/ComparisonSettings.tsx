import React from 'react';
import { Info } from 'lucide-react';
import { ComparisonSettings as ComparisonSettingsType, DuplicateStrategy } from '../../lib/spreadsheet-comparator/types';

interface ComparisonSettingsProps {
  settings: ComparisonSettingsType;
  onChange: (patch: Partial<ComparisonSettingsType>) => void;
}

export const ComparisonSettings: React.FC<ComparisonSettingsProps> = ({ settings, onChange }) => (
  <div className="space-y-4">
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-3">Duplicados</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          { id: 'aggregate', title: 'Agrupar e somar', desc: 'Soma os campos numéricos das linhas com a mesma chave e compara os totais.' },
          { id: 'row-by-row', title: 'Comparar linha a linha', desc: 'Pareia as linhas na ordem em que aparecem — a ordem original influencia o resultado.' },
        ] as { id: DuplicateStrategy; title: string; desc: string }[]).map(opt => (
          <button key={opt.id} onClick={() => onChange({ duplicateStrategy: opt.id })}
            className={`text-left p-3 rounded-lg border-2 transition ${settings.duplicateStrategy === opt.id ? 'border-accent bg-accent/10' : 'border-edge hover:border-fg-subtle'}`}>
            <p className={`font-bold text-xs ${settings.duplicateStrategy === opt.id ? 'text-accent' : 'text-fg'}`}>{opt.title}</p>
            <p className="text-xs text-fg-subtle mt-1">{opt.desc}</p>
          </button>
        ))}
      </div>
      {settings.duplicateStrategy === 'row-by-row' && (
        <div className="mt-3 flex items-start gap-2 p-2.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg text-xs">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>A ordem das linhas no arquivo original influencia diretamente o pareamento e o resultado.</span>
        </div>
      )}
      <p className="text-xs text-fg-subtle mt-2">Duplicados nunca são descartados silenciosamente — o painel de resultados mostra quantas chaves duplicadas existem em cada base.</p>
    </div>

    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-3">Normalização padrão</h2>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm text-fg-muted">Comparação de texto diferencia maiúsculas/minúsculas</span>
          <input type="checkbox" checked={settings.defaultCaseSensitive} onChange={e => onChange({ defaultCaseSensitive: e.target.checked })} className="accent-accent w-4 h-4" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Tolerância absoluta padrão</label>
            <input type="number" min={0} step={0.01} value={settings.defaultToleranceAbsolute}
              onChange={e => onChange({ defaultToleranceAbsolute: Math.max(0, Number(e.target.value)) })}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm font-mono bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Tolerância percentual padrão (%)</label>
            <input type="number" min={0} step={0.1} value={settings.defaultTolerancePercent}
              onChange={e => onChange({ defaultTolerancePercent: Math.max(0, Number(e.target.value)) })}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm font-mono bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
        </div>
        <p className="text-xs text-fg-subtle">Zero por padrão — cada campo pode sobrescrever com sua própria tolerância na etapa de mapeamento.</p>
      </div>
    </div>
  </div>
);

export default ComparisonSettings;
