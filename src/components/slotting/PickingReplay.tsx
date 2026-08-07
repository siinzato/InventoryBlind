import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Play, Pause, RotateCcw, Footprints as FootprintsIcon } from 'lucide-react';
import { Panel, PanelSection, Badge, Button } from '../ui';
import { getRecentOperations, getOperationLocations, type RecentOperationSummary } from '../../lib/slottingLayoutService';
import { computeRouteThroughStops, findExpeditionCell, estimatePickingTimeSeconds, type GridPoint, type RouteResult } from '../../lib/slottingEngine';
import { FloorPlanBackground } from './FloorPlanBackground';
import type { WarehouseLayout, WarehouseCell } from '../../lib/supabase';

interface DemoRoute {
  label: string;
  stops: GridPoint[];
}

interface PickingReplayProps {
  companyId: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  /** Modo Apresentação: pula a busca de operações reais e reproduz uma rota fabricada
   *  sobre a MESMA grade (pathfinding real via computeRouteThroughStops) — undefined
   *  preserva o comportamento normal (seletor de operação real). */
  demoRoute?: DemoRoute | null;
}

const SPEEDS = [1, 2, 4] as const;
const BASE_STEP_MS = 180;
// Pitch real da grade (w-5 h-5 = 20px + gap-0.5 = 2px) — não o 20.5 aproximado que
// FloorPlanBackground usa só para alinhar a imagem de fundo por trás da grade.
const CELL_PX = 22;

function formatMinSec(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Modo de reprodução visual da rota — reusa o mesmo encadeamento de BFS já usado pelo
 *  PickingRouteViewer (computeRouteThroughStops), mas revela a grade progressivamente em
 *  vez de desenhar a rota inteira de uma vez, com play/pause/velocidade, linha de rota
 *  animada (SVG + motion) e marcador do picker se movendo célula a célula. */
export function PickingReplay({ companyId, layout, cells, demoRoute }: PickingReplayProps) {
  const [operations, setOperations] = useState<RecentOperationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [stopOrder, setStopOrder] = useState<Map<string, number>>(new Map());
  const [stopCount, setStopCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (demoRoute) return;
    getRecentOperations(companyId).then(setOperations);
  }, [companyId, demoRoute]);

  useEffect(() => {
    setPlaying(false);
    setStep(0);

    const expedition = findExpeditionCell(cells);
    if (!expedition) return;

    if (demoRoute) {
      const order = new Map<string, number>();
      demoRoute.stops.forEach((s, i) => order.set(`${s.x},${s.y}`, i + 1));
      const result = computeRouteThroughStops(cells, demoRoute.stops, { x: expedition.x, y: expedition.y });
      setRoute(result);
      setStopOrder(order);
      setStopCount(demoRoute.stops.length);
      return;
    }

    if (!selectedId) { setRoute(null); setStopOrder(new Map()); return; }

    setLoading(true);
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

      if (stops.length === 0) { setRoute(null); setStopOrder(new Map()); setLoading(false); return; }

      const result = computeRouteThroughStops(cells, stops, { x: expedition.x, y: expedition.y });
      setRoute(result);
      setStopOrder(order);
      setStopCount(stops.length);
      setLoading(false);
    });
  }, [selectedId, companyId, cells, demoRoute]);

  useEffect(() => {
    if (!playing || !route) return;
    intervalRef.current = setInterval(() => {
      setStep(s => {
        if (s >= route.fullPath.length - 1) { setPlaying(false); return s; }
        return s + 1;
      });
    }, BASE_STEP_MS / speed);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, route, speed]);

  const cellByKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
  const totalMeters = route ? route.totalLengthCells * layout.cell_size_meters : 0;
  const totalSeconds = route ? estimatePickingTimeSeconds(totalMeters, stopCount) : 0;
  const productivityPerHour = totalSeconds > 0 ? Math.round((stopCount / totalSeconds) * 3600) : 0;
  const visited = route ? new Set(route.fullPath.slice(0, step + 1).map(p => `${p.x},${p.y}`)) : new Set<string>();
  const current = route?.fullPath[step];
  const progress = route && route.fullPath.length > 1 ? step / (route.fullPath.length - 1) : 0;
  const elapsedSeconds = totalSeconds * progress;
  const pathD = route ? `M ${route.fullPath.map(p => `${(p.x + 0.5) * CELL_PX},${(p.y + 0.5) * CELL_PX}`).join(' L ')}` : '';
  const gridWidthPx = layout.grid_width * CELL_PX;
  const gridHeightPx = layout.grid_height * CELL_PX;

  return (
    <Panel>
      <PanelSection padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-section flex items-center gap-1.5"><FootprintsIcon size={14} /> Picking Replay</p>
          {demoRoute ? (
            <Badge variant="accent">{demoRoute.label}</Badge>
          ) : (
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
          )}
        </div>

        {loading && <p className="text-xs text-fg-subtle">Calculando rota...</p>}

        {!loading && route && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => setPlaying(p => !p)}>
                {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pausar' : 'Reproduzir'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setPlaying(false); setStep(0); }}>
                <RotateCcw size={14} /> Reiniciar
              </Button>
              <div className="flex gap-1">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                      speed === s ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-4 text-xs text-fg-subtle flex-wrap">
              <span>Distância total: <strong className="text-fg">{Math.round(totalMeters)} m</strong></span>
              <span>Tempo estimado: <strong className="text-fg">{Math.round(totalSeconds / 60)} min</strong></span>
              <span>SKUs: <strong className="text-fg">{stopCount}</strong></span>
              <span>Produtividade: <strong className="text-fg">{productivityPerHour} picks/h</strong></span>
              {(playing || step > 0) && (
                <span>Tempo decorrido: <strong className="text-accent">{formatMinSec(elapsedSeconds)}</strong> / {formatMinSec(totalSeconds)}</span>
              )}
            </div>

            <div className="overflow-auto border border-edge rounded-xl p-2 bg-surface" style={{ maxHeight: 420 }}>
              <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${layout.grid_width}, 20px)` }}>
                <FloorPlanBackground layout={layout} cellPixelSize={20.5} />
                {Array.from({ length: layout.grid_height }).map((_, y) =>
                  Array.from({ length: layout.grid_width }).map((_, x) => {
                    const key = `${x},${y}`;
                    const cell = cellByKey.get(key);
                    const isVisited = visited.has(key);
                    const isCurrent = !!current && current.x === x && current.y === y;
                    const stopNumber = stopOrder.get(key);
                    return (
                      <div
                        key={key}
                        title={cell?.location_code ?? key}
                        className={`w-5 h-5 flex items-center justify-center text-[8px] font-bold transition-colors ${
                          isCurrent ? 'bg-accent-strong text-white ring-2 ring-accent'
                          : isVisited ? 'bg-accent/60 text-white'
                          : cell?.cell_type === 'modulo' ? 'bg-fg-subtle/30'
                          : cell?.cell_type === 'expedicao' ? 'bg-emerald-500/40'
                          : 'bg-surface-3'
                        }`}
                      >
                        {stopNumber ?? ''}
                      </div>
                    );
                  })
                )}

                {route && (
                  <svg
                    className="absolute inset-0 pointer-events-none overflow-visible"
                    width={gridWidthPx}
                    height={gridHeightPx}
                  >
                    <path d={pathD} fill="none" stroke="currentColor" strokeWidth={1} className="text-fg-subtle/25" />
                    <motion.path
                      d={pathD}
                      fill="none"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      className="text-accent"
                      stroke="currentColor"
                      initial={false}
                      animate={{ pathLength: progress }}
                      transition={{ duration: playing ? BASE_STEP_MS / 1000 / speed : 0.3, ease: 'linear' }}
                    />
                  </svg>
                )}

                {current && (
                  <motion.div
                    className="absolute w-3 h-3 rounded-full bg-accent-strong ring-2 ring-white/80 shadow-lg pointer-events-none"
                    style={{ marginLeft: -6, marginTop: -6 }}
                    animate={{ left: (current.x + 0.5) * CELL_PX, top: (current.y + 0.5) * CELL_PX }}
                    transition={{ duration: playing ? BASE_STEP_MS / 1000 / speed : 0.3, ease: 'linear' }}
                  />
                )}
              </div>
            </div>
          </>
        )}

        {!selectedId && !demoRoute && <p className="text-xs text-fg-subtle">Escolha uma operação para reproduzir a rota do picker sobre a grade.</p>}
        {!demoRoute && operations.length === 0 && <Badge variant="neutral">Nenhuma operação Full concluída encontrada ainda</Badge>}
      </PanelSection>
    </Panel>
  );
}
