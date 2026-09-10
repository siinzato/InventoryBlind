import { Fragment } from 'react';
import type { AbcClass, XyzClass, AbcXyzCombo } from '../../lib/supabase';
import { combineAbcXyz } from '../../lib/abcXyzAlgorithm';

const ABC_ROWS: { value: AbcClass; label: string }[] = [
  { value: 'A', label: 'Maior impacto' },
  { value: 'B', label: 'Impacto intermediário' },
  { value: 'C', label: 'Menor impacto' },
];
const XYZ_COLS: { value: XyzClass; label: string }[] = [
  { value: 'X', label: 'Previsível' },
  { value: 'Y', label: 'Variável' },
  { value: 'Z', label: 'Irregular' },
];

interface ClassificationMatrixProps {
  counts: Record<AbcXyzCombo, { count: number; value: number }>;
  selected: AbcXyzCombo | null;
  onSelect: (combo: AbcXyzCombo | null) => void;
}

/** Matriz 3×3 neutra — sem heatmap multicolorido. A única cor é a borda azul discreta da
 *  célula selecionada (pedido explícito: ABC/XYZ são categorias analíticas, não estados). */
export function ClassificationMatrix({ counts, selected, onSelect }: ClassificationMatrixProps) {
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[110px_repeat(3,1fr)] gap-2 min-w-[520px]">
        <div />
        {XYZ_COLS.map(x => (
          <div key={x.value} className="text-center">
            <p className="text-xs font-semibold text-fg-subtle uppercase">{x.value}</p>
            <p className="text-[11px] text-fg-subtle">{x.label}</p>
          </div>
        ))}
        {ABC_ROWS.map(a => (
          <Fragment key={a.value}>
            <div className="flex flex-col justify-center">
              <p className="text-xs font-semibold text-fg-subtle uppercase">{a.value}</p>
              <p className="text-[11px] text-fg-subtle">{a.label}</p>
            </div>
            {XYZ_COLS.map(x => {
              const combo = combineAbcXyz(a.value, x.value);
              const cell = counts[combo] ?? { count: 0, value: 0 };
              const isSelected = selected === combo;
              return (
                <button
                  key={combo}
                  onClick={() => onSelect(isSelected ? null : combo)}
                  className={`rounded-md border p-3 text-left transition-colors bg-surface ${
                    isSelected ? 'border-accent ring-1 ring-accent' : 'border-edge hover:border-fg-subtle'
                  }`}
                >
                  <p className="text-sm font-semibold text-fg">{combo}</p>
                  <p className="text-xs text-fg-muted mt-1">{cell.count.toLocaleString('pt-BR')} SKUs</p>
                  <p className="text-[11px] text-fg-subtle">
                    R$ {cell.value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </p>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
