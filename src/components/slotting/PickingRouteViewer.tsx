import { useEffect, useState } from 'react';
import { Route as RouteIcon } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { getRecentOperations, getOperationLocations, RecentOperationSummary } from '../../lib/slottingLayoutService';
import { computeRouteThroughStops, findExpeditionCell, estimatePickingTimeSeconds, GridPoint } from '../../lib/slottingEngine';
import { FloorPlanBackground } from './FloorPlanBackground';
import type { WarehouseLayout, WarehouseCell } from '../../lib/supabase';

interface PickingRouteViewerProps {
  companyId: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
}

/** Desenha a rota real de picking de uma operação Full concluída: expedição → cada
 *  posição visitada, na ordem cronológica dos picks → volta à expedição — encadeando o
 *  BFS já existente (computeRouteThroughStops), não uma linha reta fingida. */
export function PickingRouteViewer({ companyId, layout, cells }: PickingRouteViewerProps) {
  const [operations, setOperations] = useState<RecentOperationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [routeCells, setRouteCells] = useState<Set<string>>(new Set());
  const [stopOrder, setStopOrder] = useState<Map<string, number>>(new Map());
  const [totalMeters, setTotalMeters] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => { getRecentOperations(companyId).then(setOperations); }, [companyId]);

  useEffect(() => {
    if (!selectedId) { setRouteCells(new Set()); setStopOrder(new Map()); return; }
    const expedition = findExpeditionCell(cells);
    if (!expedition) return;

    setLoading(true);
    setNotFound(false);
    getOperationLocations(companyId, selectedId).then(locations => {
      const cellByLocation = new Map(cells.filter(c => c.location_code).map(c => [c.location_code!, c]));
      const stops: GridPoint[] = [];
      const order = new Map<string, number>();
      locations.forEach(loc => {
        const cell = cellByLocation.get(loc);
        if (!cell) return;
        stops.push({ x: cell.x, y: cell.y });
        order.set(`${cell.x},${cell.y}`, stops.length);
      });

      if (stops.length === 0) {
        setRouteCells(new Set()); setStopOrder(new Map()); setTotalMeters(0); setTotalSeconds(0); setNotFound(true); setLoading(false);
        return;
      }

      const route = computeRouteThroughStops(cells, stops, { x: expedition.x, y: expedition.y });
      if (!route) {
        setRouteCells(new Set()); setStopOrder(new Map()); setTotalMeters(0); setTotalSeconds(0); setNotFound(true); setLoading(false);
        return;
      }

      setRouteCells(new Set(route.fullPath.map(p => `${p.x},${p.y}`)));
      setStopOrder(order);
      const meters = route.totalLengthCells * layout.cell_size_meters;
      setTotalMeters(meters);
      setTotalSeconds(estimatePickingTimeSeconds(meters, stops.length));
      setLoading(false);
    });
  }, [selectedId, companyId, cells, layout.cell_size_meters]);

  const cellByKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));

  return (
    <Panel>
      <PanelSection padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-section flex items-center gap-1.5"><RouteIcon size={14} /> Rota de Picking</p>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="p-2 border border-edge rounded-lg bg-surface text-sm text-fg min-w-[220px]"
          >
            <option value="">Selecione uma operação Full...</option>
            {operations.map(op => (
              <option key={op.id} value={op.id}>{op.fullNumber} — {new Date(op.createdAt).toLocaleDateString('pt-BR')} ({op.itemCount} SKUs)</option>
            ))}
          </select>
        </div>

        {loading && <p className="text-xs text-fg-subtle">Calculando rota...</p>}
        {!loading && notFound && selectedId && <p className="text-xs text-fg-subtle">Não foi possível reconstruir a rota — endereços da operação não batem com células do layout atual.</p>}

        {!loading && routeCells.size > 0 && (
          <>
            <div className="flex gap-4 text-xs text-fg-subtle">
              <span>Distância total: <strong className="text-fg">{Math.round(totalMeters)} m</strong></span>
              <span>Tempo estimado: <strong className="text-fg">{Math.round(totalSeconds / 60)} min</strong></span>
              <span>Paradas: <strong className="text-fg">{stopOrder.size}</strong></span>
            </div>
            <div className="overflow-auto border border-edge rounded-xl p-2 bg-surface" style={{ maxHeight: 420 }}>
              <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${layout.grid_width}, 20px)` }}>
                <FloorPlanBackground layout={layout} cellPixelSize={20.5} />
                {Array.from({ length: layout.grid_height }).map((_, y) =>
                  Array.from({ length: layout.grid_width }).map((_, x) => {
                    const key = `${x},${y}`;
                    const cell = cellByKey.get(key);
                    const onRoute = routeCells.has(key);
                    const stopNumber = stopOrder.get(key);
                    return (
                      <div
                        key={key}
                        title={cell?.location_code ?? key}
                        className={`w-5 h-5 flex items-center justify-center text-[8px] font-bold ${
                          onRoute ? 'bg-accent text-white' : cell?.cell_type === 'modulo' ? 'bg-fg-subtle/30' : cell?.cell_type === 'expedicao' ? 'bg-emerald-500/40' : 'bg-surface-3'
                        }`}
                      >
                        {stopNumber ?? ''}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {!selectedId && <p className="text-xs text-fg-subtle">Escolha uma operação para ver o percurso real do picker sobre a grade.</p>}
        {operations.length === 0 && <Badge variant="neutral">Nenhuma operação Full concluída encontrada ainda</Badge>}
      </PanelSection>
    </Panel>
  );
}
