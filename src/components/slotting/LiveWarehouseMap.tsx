import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { SegmentedControl } from '../ui';
import { FloorPlanBackground } from './FloorPlanBackground';
import type {
  WarehouseLayout, WarehouseCell, WarehouseZone, LocationLiveStatus, WarehouseLiveLayer, RiskBand, RiskLevel, AbcClass,
} from '../../lib/supabase';

interface LiveWarehouseMapProps {
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  liveData: Map<string, LocationLiveStatus>;
  traffic: Map<string, number>;
  layer: WarehouseLiveLayer;
  onLayerChange?: (layer: WarehouseLiveLayer) => void;
  onSelectPosition: (cell: WarehouseCell) => void;
  /** Esconde o seletor de camadas — usado pelas abas Ocupação/Divergências, que embutem
   *  o mapa já fixado numa camada específica em vez de deixar o usuário trocar. */
  lockLayer?: boolean;
  /** Endereço para a câmera focar automaticamente: zoom + centraliza + pulso de destaque.
   *  Muda a cada clique (mesmo endereço duas vezes seguidas) deve reacionar — o chamador é
   *  responsável por variar a referência/trigger se precisar refocar no mesmo lugar. */
  focusLocationCode?: string | null;
  /** Rótulos de zona (ZONA A/B/C) desenhados sobre a grade — puramente visual, não afeta
   *  cor/seleção de célula. */
  zones?: WarehouseZone[];
}

// Pitch real da grade (w-5 h-5 = 20px + gap-0.5 = 2px).
const CELL_PX = 22;
const MIN_SCALE = 1;
const MAX_SCALE = 2.5;
const FOCUS_SCALE = 2;

const LAYERS: { id: WarehouseLiveLayer; label: string; hint: string }[] = [
  { id: 'ocupacao', label: 'Ocupação', hint: 'Escala de cinza a navy: quanto mais escuro, mais ocupado. Contorno tracejado = endereço cadastrado sem produto atual.' },
  { id: 'divergencia', label: 'Divergência', hint: 'Intensidade por nº de divergências (RCA) já classificadas para o SKU da posição.' },
  { id: 'picking', label: 'Picking', hint: 'Intensidade por nº de picks no período (mesma base do heatmap de tráfego).' },
  { id: 'giro', label: 'Giro', hint: 'Intensidade por valor movimentado (ABC/XYZ) — proxy de giro do SKU.' },
  { id: 'risk', label: 'Risk Score', hint: 'Cor pela faixa de risco (Inventário por Risco): crítico/alto/médio/baixo.' },
  { id: 'confidence', label: 'Confidence', hint: 'Cor pela faixa de confiança (Confidence Based Counting).' },
  { id: 'abc_xyz', label: 'ABC/XYZ', hint: 'Cor pela classe ABC (importância de valor movimentado).' },
  { id: 'slotting', label: 'Slotting', hint: 'Destaca posições com recomendação de slotting pendente.' },
  { id: 'vazios', label: 'Endereços Vazios', hint: 'Destaca posições cadastradas sem produto atribuído.' },
  { id: 'congestionamento', label: 'Congestionamento', hint: 'Tráfego real (BFS) por corredor — mesma métrica do Heatmap do Armazém.' },
];

const RISK_COLOR: Record<RiskBand, string> = {
  critico: 'bg-red-500/55', alto: 'bg-amber-500/45', medio: 'bg-amber-500/25', baixo: 'bg-emerald-500/30',
};
const CONFIDENCE_COLOR: Record<RiskLevel, string> = {
  critico: 'bg-red-500/55', medio: 'bg-amber-500/35', bom: 'bg-emerald-500/25', excelente: 'bg-emerald-500/45',
};
const ABC_COLOR: Record<AbcClass, string> = {
  A: 'bg-emerald-500/45', B: 'bg-amber-500/35', C: 'bg-surface-3',
};

function intensityColor(ratio: number): string {
  if (ratio <= 0) return 'bg-surface-3';
  if (ratio < 0.33) return 'bg-emerald-500/25';
  if (ratio < 0.66) return 'bg-amber-500/35';
  return 'bg-red-500/55';
}

/** Quarta grade independente do módulo (Editor/Heatmap/RouteViewer já reimplementam o
 *  mesmo padrão cada um do seu jeito) — deliberadamente não extrai uma base compartilhada
 *  para não precisar tocar nos três componentes existentes que já funcionam. Mostra uma
 *  única camada por vez (não sobrepõe cores) para manter a leitura visual limpa. */
export function LiveWarehouseMap({
  layout, cells, liveData, traffic, layer, onLayerChange, onSelectPosition, lockLayer, focusLocationCode, zones = [],
}: LiveWarehouseMapProps) {
  const cellByKey = useMemo(() => new Map(cells.map(c => [`${c.x},${c.y}`, c])), [cells]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(MIN_SCALE);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  useEffect(() => {
    if (!focusLocationCode) return;
    const cell = cells.find(c => c.location_code === focusLocationCode);
    if (!cell) return;

    setScale(FOCUS_SCALE);
    setHighlightKey(`${cell.x},${cell.y}`);
    const centerX = (cell.x + 0.5) * CELL_PX;
    const centerY = (cell.y + 0.5) * CELL_PX;
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ left: centerX * FOCUS_SCALE - el.clientWidth / 2, top: centerY * FOCUS_SCALE - el.clientHeight / 2, behavior: 'smooth' });
    });
    const clearHighlight = setTimeout(() => setHighlightKey(null), 2000);
    return () => { cancelAnimationFrame(raf); clearTimeout(clearHighlight); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLocationCode]);

  const maxValues = useMemo(() => {
    const statuses = Array.from(liveData.values());
    return {
      divergence: Math.max(1, ...statuses.map(s => s.divergenceCount)),
      picking: Math.max(1, ...statuses.map(s => s.pickCount)),
      giro: Math.max(1, ...statuses.map(s => s.valueMoved ?? 0)),
    };
  }, [liveData]);

  const maxTraffic = useMemo(() => Math.max(1, ...Array.from(traffic.values())), [traffic]);

  const colorFor = (cell: WarehouseCell | undefined, key: string): string => {
    if (!cell) return 'bg-transparent';
    if (cell.cell_type === 'modulo') return 'bg-fg-subtle/30';
    if (cell.cell_type === 'vazio') return 'bg-transparent';
    if (cell.cell_type === 'expedicao') return 'bg-emerald-500/40';
    if (cell.cell_type === 'porta') return 'bg-amber-500/40';
    if (cell.cell_type === 'doca') return 'bg-sky-500/40';

    if (layer === 'congestionamento') return intensityColor((traffic.get(key) ?? 0) / maxTraffic);
    if (cell.cell_type === 'rua') return 'bg-surface-3';

    // A partir daqui só sobra cell_type === 'posicao'
    const status = cell.location_code ? liveData.get(cell.location_code) : undefined;

    switch (layer) {
      case 'ocupacao':
        // Monocromático (cinza → navy), sem verde/âmbar — só vermelho é reservado para
        // alerta real em outras camadas. Vazio cadastrado fica com contorno tracejado.
        if (!cell.location_code) return 'bg-surface-3';
        return status?.occupied ? 'bg-fg/60' : 'bg-surface-3 border-dashed';
      case 'vazios':
        return cell.location_code ? 'bg-surface-3' : 'bg-sky-500/35';
      case 'divergencia':
        return status ? intensityColor(status.divergenceCount / maxValues.divergence) : 'bg-surface-3';
      case 'picking':
        return status ? intensityColor(status.pickCount / maxValues.picking) : 'bg-surface-3';
      case 'giro':
        return status && status.valueMoved != null ? intensityColor(status.valueMoved / maxValues.giro) : 'bg-surface-3';
      case 'risk':
        return status?.riskLevel ? RISK_COLOR[status.riskLevel] : 'bg-surface-3';
      case 'confidence':
        return status?.confidenceLevel ? CONFIDENCE_COLOR[status.confidenceLevel] : 'bg-surface-3';
      case 'abc_xyz':
        return status?.abcClass ? ABC_COLOR[status.abcClass] : 'bg-surface-3';
      case 'slotting':
        return status?.recommendation ? 'bg-accent/40' : 'bg-surface-3';
      default:
        return 'bg-surface-3';
    }
  };

  const activeLayerMeta = LAYERS.find(l => l.id === layer);
  const gridWidthPx = layout.grid_width * CELL_PX;
  const gridHeightPx = layout.grid_height * CELL_PX;

  return (
    <div className="space-y-3">
      {!lockLayer && (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Camada do mapa"
            options={LAYERS.map(l => ({ value: l.id, label: l.label }))}
            value={layer}
            onChange={id => onLayerChange?.(id)}
          />
        </div>
      )}
      {activeLayerMeta && <p className="text-xs text-fg-subtle">{activeLayerMeta.hint}</p>}

      <div className="relative">
        {/* Viewport-relative height instead of a flat 480px: on a phone the map
            no longer eats the whole screen, and on a tablet/desktop it uses the
            space that's actually there. Clamped so it never collapses. */}
        <div
          ref={containerRef}
          className="overflow-auto rounded-container border border-edge bg-surface p-2"
          style={{ maxHeight: 'clamp(280px, 55vh, 620px)' }}
        >
          <div style={{ width: gridWidthPx * scale, height: gridHeightPx * scale }}>
            <motion.div
              className="relative inline-grid gap-0.5"
              style={{ gridTemplateColumns: `repeat(${layout.grid_width}, 20px)`, transformOrigin: '0 0', width: gridWidthPx, height: gridHeightPx }}
              animate={{ scale }}
              transition={{ type: 'spring', stiffness: 140, damping: 22 }}
            >
              <FloorPlanBackground layout={layout} cellPixelSize={20.5} />
              {Array.from({ length: layout.grid_height }).map((_, y) =>
                Array.from({ length: layout.grid_width }).map((_, x) => {
                  const key = `${x},${y}`;
                  const cell = cellByKey.get(key);
                  const clickable = cell?.cell_type === 'posicao';
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!clickable}
                      onClick={() => cell && onSelectPosition(cell)}
                      title={cell?.location_code ?? key}
                      className={`w-5 h-5 transition-transform ${colorFor(cell, key)} ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-accent/60 hover:scale-125 hover:z-10' : 'cursor-default'}`}
                    />
                  );
                })
              )}

              <AnimatePresence>
                {highlightKey && (() => {
                  const [hx, hy] = highlightKey.split(',').map(Number);
                  return (
                    <motion.div
                      key="focus-highlight"
                      className="absolute rounded-full ring-4 ring-accent pointer-events-none"
                      style={{ left: hx * CELL_PX - 4, top: hy * CELL_PX - 4, width: 28, height: 28 }}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.3, 1, 1] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 2, times: [0, 0.2, 0.8, 1] }}
                    />
                  );
                })()}
              </AnimatePresence>

              {zones.map(zone => (
                <div
                  key={zone.id}
                  className="absolute border-2 border-dashed border-fg-subtle/50 pointer-events-none"
                  style={{
                    left: zone.min_x * CELL_PX, top: zone.min_y * CELL_PX,
                    width: (zone.max_x - zone.min_x + 1) * CELL_PX, height: (zone.max_y - zone.min_y + 1) * CELL_PX,
                  }}
                >
                  <span className="absolute -top-0.5 left-0 -translate-y-full bg-surface/90 text-[10px] font-semibold text-fg-muted px-1 rounded-t">
                    {zone.name}
                  </span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>

        <div className="absolute top-2 right-2 flex flex-col gap-1 bg-surface/90 backdrop-blur border border-edge rounded-control p-1 shadow-control">
          <button type="button" onClick={() => setScale(s => Math.min(MAX_SCALE, s + 0.4))} className="p-1.5 text-fg-muted hover:text-fg hover:bg-surface-3 rounded transition-colors" title="Aproximar">
            <ZoomIn size={14} />
          </button>
          <button type="button" onClick={() => setScale(s => Math.max(MIN_SCALE, s - 0.4))} className="p-1.5 text-fg-muted hover:text-fg hover:bg-surface-3 rounded transition-colors" title="Afastar">
            <ZoomOut size={14} />
          </button>
          <button type="button" onClick={() => setScale(MIN_SCALE)} className="p-1.5 text-fg-muted hover:text-fg hover:bg-surface-3 rounded transition-colors" title="Ajustar à tela">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
