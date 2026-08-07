import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { History } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { listSnapshotDates, getSnapshotForDate } from '../../lib/warehouseTimelineService';
import { LiveWarehouseMap } from './LiveWarehouseMap';
import type { WarehouseLayout, WarehouseCell, WarehouseSnapshot, WarehouseLiveLayer } from '../../lib/supabase';

interface WarehouseTimelinePanelProps {
  companyId: string;
  layoutId: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  onSelectPosition: (cell: WarehouseCell) => void;
}

const EMPTY_TRAFFIC = new Map<string, number>();
/** Índices (dias atrás) usados como marcas do scrubber — curadoria de listSnapshotDates(30)
 *  em vez das 30 datas inteiras, para o controle ficar legível ("Hoje | 15/07 | 01/07..."). */
const TICK_DAYS_AGO = [0, 1, 3, 7, 14, 21, 29];

function tickLabel(date: string, daysAgo: number): string {
  if (daysAgo === 0) return 'Hoje';
  if (daysAgo === 1) return 'Ontem';
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Arquitetura preparada para reconstruir o CD numa data passada — hoje retorna sempre o
 *  snapshot vivo atual rotulado como prévia (warehouseTimelineService.ts é mock por
 *  decisão explícita do pedido); quando existir snapshot histórico real persistido, só o
 *  serviço muda, este componente continua igual. Scrubber horizontal ("voltar no tempo")
 *  em vez de select — clicar numa marca já reconstrói, sem passo extra de confirmação. */
export function WarehouseTimelinePanel({ companyId, layoutId, layout, cells, onSelectPosition }: WarehouseTimelinePanelProps) {
  const [dates] = useState(() => listSnapshotDates());
  const ticks = TICK_DAYS_AGO.map(daysAgo => ({ daysAgo, date: dates[daysAgo] })).filter(t => !!t.date);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [snapshot, setSnapshot] = useState<WarehouseSnapshot | null>(null);
  const [layer, setLayer] = useState<WarehouseLiveLayer>('ocupacao');
  const [loading, setLoading] = useState(false);

  const handleReconstruct = async (date: string) => {
    setSelectedDate(date);
    setLoading(true);
    const result = await getSnapshotForDate(companyId, layoutId, cells, date);
    setSnapshot(result);
    setLoading(false);
  };

  useEffect(() => { handleReconstruct(selectedDate); }, []);

  return (
    <Panel>
      <PanelSection padding="md" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-section flex items-center gap-1.5"><History size={14} /> Timeline Histórica — voltar no tempo</p>
          {loading && <span className="text-xs text-fg-subtle animate-pulse">Reconstruindo...</span>}
        </div>

        <div className="relative flex items-center justify-between px-2">
          <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-px bg-edge" />
          {ticks.map(t => {
            const active = t.date === selectedDate;
            return (
              <button
                key={t.date}
                onClick={() => handleReconstruct(t.date)}
                disabled={loading}
                className="relative z-10 flex flex-col items-center gap-1.5 px-1.5 group"
              >
                <span className={`relative w-3 h-3 rounded-full border-2 transition-colors ${
                  active ? 'border-accent bg-accent' : 'border-edge bg-surface group-hover:border-accent/50'
                }`}>
                  {active && (
                    <motion.span
                      layoutId="timeline-active-ring"
                      className="absolute -inset-1.5 rounded-full ring-2 ring-accent/40"
                      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    />
                  )}
                </span>
                <span className={`text-[11px] font-medium whitespace-nowrap ${active ? 'text-accent' : 'text-fg-subtle'}`}>
                  {tickLabel(t.date, t.daysAgo)}
                </span>
              </button>
            );
          })}
        </div>

        {snapshot?.isMock && (
          <Badge variant="warning">Prévia — histórico real ainda não persistido, mostrando estado atual</Badge>
        )}

        {snapshot ? (
          <LiveWarehouseMap
            layout={layout}
            cells={snapshot.cells}
            liveData={snapshot.liveData}
            traffic={EMPTY_TRAFFIC}
            layer={layer}
            onLayerChange={setLayer}
            onSelectPosition={onSelectPosition}
          />
        ) : (
          <p className="text-xs text-fg-subtle">Selecione uma data e clique em "Reconstruir".</p>
        )}
      </PanelSection>
    </Panel>
  );
}
