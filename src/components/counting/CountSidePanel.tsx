import { useEffect, useRef, useState } from 'react';
import { Panel, PanelSection, Badge } from '../ui';

export interface LiveCountStats {
  linha: string;
  totalSku: number;
  contados: number;
  divergencias: number;
  acuracidade: number | null;
  active: boolean;
}

interface CountSidePanelProps {
  stats: LiveCountStats;
  resetKey: number;
}

const formatDuration = (seconds: number): string => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

/** Live "in progress" readout for the count currently being filled in — resets whenever resetKey changes. */
export function CountSidePanel({ stats, resetKey }: CountSidePanelProps) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSeconds(0);
  }, [resetKey]);

  useEffect(() => {
    if (stats.active) {
      intervalRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [stats.active]);

  const pendentes = Math.max(0, stats.totalSku - stats.contados);
  const status = !stats.active ? 'Aguardando' : pendentes === 0 && stats.totalSku > 0 ? 'Concluída' : 'Em andamento';

  return (
    <Panel>
      <PanelSection padding="md">
        <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Painel ao vivo</p>
        <p className="text-title mt-1 truncate">{stats.linha || 'Nenhuma linha selecionada'}</p>
      </PanelSection>
      <PanelSection padding="md" className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-fg-subtle">Total SKU</p>
          <p className="text-base font-semibold text-fg">{stats.totalSku}</p>
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Contados</p>
          <p className="text-base font-semibold text-fg">{stats.contados}</p>
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Pendentes</p>
          <p className="text-base font-semibold text-fg">{pendentes}</p>
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Divergências</p>
          <p className="text-base font-semibold text-fg">{stats.divergencias}</p>
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Acuracidade</p>
          <p className="text-base font-semibold text-fg">{stats.acuracidade !== null ? `${stats.acuracidade.toFixed(1)}%` : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Tempo</p>
          <p className="text-base font-semibold text-fg font-mono">{formatDuration(seconds)}</p>
        </div>
      </PanelSection>
      <PanelSection padding="md">
        <Badge variant={status === 'Concluída' ? 'success' : status === 'Em andamento' ? 'accent' : 'neutral'}>
          {status}
        </Badge>
      </PanelSection>
    </Panel>
  );
}
