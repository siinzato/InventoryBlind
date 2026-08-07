import { Fragment } from 'react';
import type { AbcClass, XyzClass, AbcXyzCombo } from '../../lib/supabase';
import { combineAbcXyz } from '../../lib/abcXyzAlgorithm';

const ABC_ROWS: AbcClass[] = ['A', 'B', 'C'];
const XYZ_COLS: XyzClass[] = ['X', 'Y', 'Z'];

const CELL_TONE: Record<AbcXyzCombo, string> = {
  AX: 'bg-emerald-500/10 border-emerald-500/30',
  AY: 'bg-amber-500/10 border-amber-500/30',
  AZ: 'bg-red-500/15 border-red-500/40',
  BX: 'bg-emerald-500/10 border-emerald-500/20',
  BY: 'bg-amber-500/10 border-amber-500/20',
  BZ: 'bg-red-500/10 border-red-500/30',
  CX: 'bg-surface-3 border-edge',
  CY: 'bg-surface-3 border-edge',
  CZ: 'bg-amber-500/5 border-amber-500/20',
};

interface ClassificationMatrixProps {
  counts: Record<AbcXyzCombo, { count: number; value: number }>;
  selected: AbcXyzCombo | null;
  onSelect: (combo: AbcXyzCombo | null) => void;
}

export function ClassificationMatrix({ counts, selected, onSelect }: ClassificationMatrixProps) {
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-2 min-w-[420px]">
        <div />
        {XYZ_COLS.map(x => (
          <div key={x} className="text-center text-xs font-semibold text-fg-subtle uppercase">{x}</div>
        ))}
        {ABC_ROWS.map(a => (
          <Fragment key={a}>
            <div className="flex items-center text-xs font-semibold text-fg-subtle uppercase">{a}</div>
            {XYZ_COLS.map(x => {
              const combo = combineAbcXyz(a, x);
              const cell = counts[combo] ?? { count: 0, value: 0 };
              const isSelected = selected === combo;
              return (
                <button
                  key={combo}
                  onClick={() => onSelect(isSelected ? null : combo)}
                  className={`rounded-xl border p-3 text-left transition-all ${CELL_TONE[combo]} ${
                    isSelected ? 'ring-2 ring-accent scale-[1.02]' : 'hover:scale-[1.01]'
                  }`}
                >
                  <p className="text-sm font-bold text-fg">{combo}</p>
                  <p className="text-xs text-fg-muted mt-1">{cell.count} SKU(s)</p>
                  <p className="text-[10px] text-fg-subtle">
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
