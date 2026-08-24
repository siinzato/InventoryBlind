import type { LayoutPattern, PlacedBox } from '../../lib/palletCalc/layoutEngine';
import type { PalletSpec } from '../../lib/palletCalc/types';

interface PalletDiagramProps {
  pallet: PalletSpec;
  pattern: LayoutPattern;
  showNumbers?: boolean;
  showDimensions?: boolean;
  selectedIndex?: number | null;
  onSelectBox?: (index: number) => void;
}

/** Vista superior 2D obrigatória (spec §7) — SVG à mão em escala real de mm
 *  (mesmo espírito de src/components/rca/ParetoChart.tsx: sem lib de
 *  gráficos no projeto), 1 unidade do viewBox = 1mm, o que faz a proporção
 *  entre palete/caixas/overhang sair correta de graça. */
export function PalletDiagram({ pallet, pattern, showNumbers = true, showDimensions = true, selectedIndex = null, onSelectBox }: PalletDiagramProps) {
  const pad = Math.max(pallet.lengthMm, pallet.widthMm) * 0.12;
  const overhangExtra = pattern.overhangUsedMm;
  const viewX = -pad - overhangExtra;
  const viewY = -pad - overhangExtra;
  const viewW = pallet.lengthMm + 2 * (pad + overhangExtra);
  const viewH = pallet.widthMm + 2 * (pad + overhangExtra);

  const fontSize = Math.max(10, Math.min(pallet.lengthMm, pallet.widthMm) * 0.04);

  return (
    <div className="overflow-x-auto rounded-container border border-edge bg-surface-3 p-2">
      <svg viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`} className="w-full" style={{ minWidth: 280, maxHeight: 520 }}>
        {/* base do palete */}
        <rect x={0} y={0} width={pallet.lengthMm} height={pallet.widthMm} className="fill-surface-2 stroke-fg-subtle" strokeWidth={pad * 0.04} />

        {/* overhang liberado (área tracejada além do palete) */}
        {(pallet.overhangMm.left || pallet.overhangMm.right || pallet.overhangMm.front || pallet.overhangMm.back) > 0 && (
          <rect
            x={-pallet.overhangMm.left} y={-pallet.overhangMm.front}
            width={pallet.lengthMm + pallet.overhangMm.left + pallet.overhangMm.right}
            height={pallet.widthMm + pallet.overhangMm.front + pallet.overhangMm.back}
            fill="none" className="stroke-amber-500/60" strokeDasharray={`${pad * 0.06} ${pad * 0.06}`} strokeWidth={pad * 0.02}
          />
        )}

        {pattern.placements.map((box: PlacedBox) => {
          const isSelected = selectedIndex === box.index;
          return (
            <g key={box.index} onClick={() => onSelectBox?.(box.index)} className={onSelectBox ? 'cursor-pointer' : undefined}>
              <rect
                x={box.x} y={box.y} width={box.w} height={box.h}
                className={isSelected ? 'fill-accent/40 stroke-accent' : box.rotated ? 'fill-accent/15 stroke-accent/70' : 'fill-accent/25 stroke-accent/70'}
                strokeWidth={pad * 0.025}
                rx={pad * 0.03}
              />
              {showNumbers && (
                <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" dominantBaseline="middle" className="fill-fg font-semibold select-none" style={{ fontSize }}>
                  {box.index + 1}
                </text>
              )}
            </g>
          );
        })}

        {showDimensions && (
          <>
            <text x={pallet.lengthMm / 2} y={-pad * 0.25} textAnchor="middle" className="fill-fg-muted" style={{ fontSize }}>
              {pallet.lengthMm.toFixed(0)} mm
            </text>
            <text x={-pad * 0.15} y={pallet.widthMm / 2} textAnchor="middle" className="fill-fg-muted" style={{ fontSize }} transform={`rotate(-90 ${-pad * 0.15} ${pallet.widthMm / 2})`}>
              {pallet.widthMm.toFixed(0)} mm
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
