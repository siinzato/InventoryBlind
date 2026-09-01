import { useEffect, useMemo, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Footprints as FootprintsIcon, MapPin, ExternalLink } from 'lucide-react';
import { Panel, PanelSection, Badge, Button, SegmentedControl, Select, Input } from '../ui';
import { getReplayEvents, getRecentOperations, type RecentOperationSummary, type ReplayEventFilters } from '../../lib/slottingLayoutService';
import { buildReplayTimeline, type PositionedReplayEvent, type ReplayEventType } from '../../lib/warehouseReplayEngine';
import { FloorPlanBackground } from './FloorPlanBackground';
import type { WarehouseLayout, WarehouseCell } from '../../lib/supabase';

interface PickingReplayProps {
  companyId: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  /** Abre o painel de detalhe do endereço (mesmo drawer da aba Operação) — "Ver operação de
   *  origem" não tem para onde apontar hoje (não existe um visualizador de Operação Full
   *  reaproveitável fora do próprio Full Manager) e por isso não foi incluído aqui. */
  onSelectPosition?: (cell: WarehouseCell) => void;
}

const SPEEDS = [1, 2, 4] as const;
const BASE_STEP_MS = 900;
const CELL_PX = 22;

const TYPE_LABEL: Record<ReplayEventType, string> = { picking: 'Picking', contagem: 'Contagem', movimentacao: 'Movimentação', divergencia: 'Divergência' };
// Só picking/divergência têm endereço real hoje — ver comentário em slottingLayoutService.ts::getReplayEvents.
const AVAILABLE_TYPES: ReplayEventType[] = ['picking', 'divergencia'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function formatSeconds(seconds: number | null): string {
  if (seconds == null) return 'Indisponível';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}

/** Replay operacional (Imagem 3) — eventos REAIS ordenados por occurredAt, nunca uma rota
 *  fabricada. Reaproveita o BFS/distância de slottingEngine.ts (via warehouseReplayEngine)
 *  em vez de linha reta, e só calcula distância quando a escala foi calibrada. */
export function PickingReplay({ companyId, layout, cells, onSelectPosition }: PickingReplayProps) {
  const [operations, setOperations] = useState<RecentOperationSummary[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [operationId, setOperationId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [activeTypes, setActiveTypes] = useState<Set<ReplayEventType>>(new Set(AVAILABLE_TYPES));
  const [followOperator, setFollowOperator] = useState(false);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<PositionedReplayEvent[]>([]);
  const [coveragePct, setCoveragePct] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  useEffect(() => { getRecentOperations(companyId).then(setOperations); }, [companyId]);

  useEffect(() => {
    setLoading(true);
    setPlaying(false);
    setStep(0);
    const filters: ReplayEventFilters = {
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
      operationId: operationId || null,
      operatorId: operatorId || null,
      types: Array.from(activeTypes),
    };
    getReplayEvents(companyId, filters).then(raw => {
      const timeline = buildReplayTimeline(raw, { cells, cellSizeMeters: layout.scale_confirmed ? layout.cell_size_meters : null });
      setEvents(timeline.events);
      setCoveragePct(timeline.coveragePct);
      setLoading(false);
    });
  }, [companyId, dateFrom, dateTo, operationId, operatorId, activeTypes, cells, layout]);

  useEffect(() => {
    if (!playing || events.length === 0) return;
    const interval = setInterval(() => {
      setStep(s => {
        if (s >= events.length - 1) { setPlaying(false); return s; }
        return s + 1;
      });
    }, BASE_STEP_MS / speed);
    return () => clearInterval(interval);
  }, [playing, events.length, speed]);

  const current = events[step] ?? null;
  const operatorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) if (e.operatorId) seen.set(e.operatorId, e.operatorName ?? e.operatorId);
    return Array.from(seen.entries());
  }, [events]);

  const visibleEvents = followOperator && current?.operatorId
    ? events.filter(e => e.operatorId === current.operatorId)
    : events;
  const visitedKeys = new Set(events.slice(0, step + 1).filter(e => e.position).map(e => `${e.position!.x},${e.position!.y}`));
  const gridWidthPx = layout.grid_width * CELL_PX;
  const gridHeightPx = layout.grid_height * CELL_PX;
  const pathD = events.filter(e => e.position).map(e => `${(e.position!.x + 0.5) * CELL_PX},${(e.position!.y + 0.5) * CELL_PX}`).join(' L ');

  function toggleType(type: ReplayEventType) {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next.size > 0 ? next : prev;
    });
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="md" className="space-y-3">
          <p className="text-section flex items-center gap-1.5"><FootprintsIcon size={14} /> Replay</p>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="block text-xs font-medium text-fg-muted mb-1">De</label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-fg-muted mb-1">Até</label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Operação</label>
              <Select value={operationId} onChange={e => setOperationId(e.target.value)} className="min-w-[180px]">
                <option value="">Todas as operações</option>
                {operations.map(op => <option key={op.id} value={op.id}>{op.fullNumber} ({op.itemCount} SKUs)</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Operador</label>
              <Select value={operatorId} onChange={e => setOperatorId(e.target.value)} className="min-w-[160px]">
                <option value="">Todos os operadores</option>
                {operatorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              {AVAILABLE_TYPES.map(t => (
                <Button key={t} size="sm" variant={activeTypes.has(t) ? 'primary' : 'secondary'} onClick={() => toggleType(t)}>{TYPE_LABEL[t]}</Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-subtle">
            {events.length} evento(s) · cobertura de posição {Math.round(coveragePct)}%
            {!layout.scale_confirmed && ' · escala não calibrada — distâncias indisponíveis'}
          </p>
        </PanelSection>
      </Panel>

      {loading && <p className="text-xs text-fg-subtle">Carregando eventos...</p>}

      {!loading && events.length === 0 && (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle text-sm">Nenhum evento encontrado para os filtros selecionados.</PanelSection></Panel>
      )}

      {!loading && events.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}><SkipBack size={14} /></Button>
                <Button variant="secondary" size="sm" onClick={() => setPlaying(p => !p)}>
                  {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pausar' : 'Reproduzir'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setStep(s => Math.min(events.length - 1, s + 1))} disabled={step >= events.length - 1}><SkipForward size={14} /></Button>
                <SegmentedControl
                  label="Velocidade do replay"
                  options={SPEEDS.map(s => ({ value: String(s) as `${(typeof SPEEDS)[number]}`, label: `${s}x` }))}
                  value={String(speed) as `${(typeof SPEEDS)[number]}`}
                  onChange={v => setSpeed(Number(v) as (typeof SPEEDS)[number])}
                />
                <label className="flex items-center gap-1.5 text-xs text-fg-muted ml-auto">
                  <input type="checkbox" checked={followOperator} onChange={e => setFollowOperator(e.target.checked)} /> Seguir operador
                </label>
              </div>

              <input
                type="range" min={0} max={events.length - 1} value={step}
                onChange={e => setStep(Number(e.target.value))}
                className="w-full accent-accent"
              />

              <div className="overflow-auto border border-edge rounded-xl p-2 bg-surface" style={{ maxHeight: 420 }}>
                <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${layout.grid_width}, ${CELL_PX}px)` }}>
                  <FloorPlanBackground layout={layout} cellPixelSize={CELL_PX + 0.5} />
                  {Array.from({ length: layout.grid_height }).map((_, y) =>
                    Array.from({ length: layout.grid_width }).map((_, x) => {
                      const key = `${x},${y}`;
                      const cell = cells.find(c => c.x === x && c.y === y);
                      const isCurrent = current?.position?.x === x && current?.position?.y === y;
                      const isVisited = visitedKeys.has(key);
                      return (
                        <div
                          key={key}
                          title={cell?.location_code ?? key}
                          className={`flex items-center justify-center transition-colors ${
                            isCurrent ? 'bg-accent-strong ring-2 ring-accent'
                            : isVisited ? 'bg-accent/50'
                            : cell?.cell_type === 'modulo' ? 'bg-fg-subtle/30'
                            : cell?.cell_type === 'expedicao' ? 'bg-emerald-500/40'
                            : 'bg-surface-3'
                          }`}
                          style={{ width: CELL_PX, height: CELL_PX }}
                        />
                      );
                    })
                  )}
                  {pathD && (
                    <svg className="absolute inset-0 pointer-events-none overflow-visible" width={gridWidthPx} height={gridHeightPx}>
                      <path d={`M ${pathD}`} fill="none" stroke="currentColor" strokeWidth={1} className="text-fg-subtle/25" />
                    </svg>
                  )}
                </div>
              </div>

              {followOperator && current?.operatorId && (
                <p className="text-xs text-fg-subtle">Seguindo {current.operatorName ?? current.operatorId} — {visibleEvents.length} evento(s) deste operador nos filtros atuais.</p>
              )}
            </PanelSection>
          </Panel>

          {current && (
            <Panel>
              <PanelSection padding="md" className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-section">Evento selecionado</p>
                  <Badge variant="accent">{TYPE_LABEL[current.type]}</Badge>
                </div>
                <p className="text-lg font-semibold text-fg tabular-nums">{formatDateTime(current.occurredAt)}</p>

                <DetailRow label="Endereço" value={current.locationCode ?? 'Sem posição'} icon={current.position ? <MapPin size={12} /> : undefined} />
                <DetailRow label="Operador" value={current.operatorName ?? current.operatorId ?? '—'} />
                <DetailRow label="SKU" value={current.sku ?? '—'} />
                <DetailRow label="Quantidade" value={current.quantity != null ? current.quantity.toLocaleString('pt-BR') : '—'} />
                <DetailRow label="Sequência" value={current.operationLabel ?? '—'} />
                <DetailRow label="Espera desde o último evento" value={formatSeconds(current.waitSecondsSincePrevious)} />
                <DetailRow label="Distância desde o último ponto" value={current.distanceFromPreviousMeters != null ? `${Math.round(current.distanceFromPreviousMeters)} m` : 'Indisponível'} />
                <DetailRow label="Próximo destino" value={events[step + 1]?.locationCode ?? '—'} />

                {!current.position && <Badge variant="danger">Sem posição — endereço não corresponde a nenhuma célula da planta</Badge>}

                {current.position && onSelectPosition && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm" variant="secondary"
                      onClick={() => { const cell = cells.find(c => c.location_code === current.locationCode); if (cell) onSelectPosition(cell); }}
                    >
                      <ExternalLink size={13} /> Abrir endereço
                    </Button>
                  </div>
                )}
              </PanelSection>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-edge/50 last:border-0">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-sm font-medium text-fg text-right flex items-center gap-1">{icon}{value}</p>
    </div>
  );
}
