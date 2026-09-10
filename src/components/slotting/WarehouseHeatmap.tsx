import { FloorPlanBackground } from './FloorPlanBackground';
import type { WarehouseLayout, WarehouseCell, WarehouseCellType } from '../../lib/supabase';

interface WarehouseHeatmapProps {
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  traffic: Map<string, number>;
}

/** Mesma grade do editor, mas colorida por tráfego calculado (verde→vermelho) em vez de
 *  por tipo de célula — heatmap real de deslocamento, derivado dos caminhos BFS. */
export function WarehouseHeatmap({ layout, cells, traffic }: WarehouseHeatmapProps) {
  const cellByKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
  const maxTraffic = Math.max(1, ...Array.from(traffic.values()));

  const colorFor = (key: string, type: WarehouseCellType): string => {
    if (type === 'modulo') return 'bg-fg-subtle/30';
    if (type === 'vazio') return 'bg-transparent';
    if (type === 'expedicao') return 'bg-emerald-500/40';
    if (type === 'porta') return 'bg-amber-500/40';
    if (type === 'doca') return 'bg-sky-500/40';
    const intensity = (traffic.get(key) ?? 0) / maxTraffic;
    if (intensity === 0) return 'bg-surface-3';
    if (intensity < 0.33) return 'bg-emerald-500/25';
    if (intensity < 0.66) return 'bg-amber-500/35';
    return 'bg-red-500/55';
  };

  return (
    <div className="overflow-auto border border-edge rounded-xl p-2 bg-surface" style={{ maxHeight: 420 }}>
      <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${layout.grid_width}, 16px)` }}>
        <FloorPlanBackground layout={layout} cellPixelSize={16.5} />
        {Array.from({ length: layout.grid_height }).map((_, y) =>
          Array.from({ length: layout.grid_width }).map((_, x) => {
            const key = `${x},${y}`;
            const cell = cellByKey.get(key);
            return (
              <div
                key={key}
                title={`(${x},${y}) — ${traffic.get(key) ?? 0} passagens estimadas`}
                className={`w-4 h-4 ${colorFor(key, cell?.cell_type ?? 'vazio')}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
