import { useEffect, useRef, useState } from 'react';
import { Panel, PanelSection, Badge } from '../ui';
import { formatFriendlyDuration } from '../../lib/countManagementUtils';

export interface LiveCountStats {
  linha: string;
  totalSku: number;
  contados: number;
  divergencias: number;
  acuracidade: number | null;
  active: boolean;
  // Contagem Manual usa início/término explícitos em vez do cronômetro por
  // seleção de linha; Importar Contagem não define isto e mantém o Tempo
  // legado abaixo, sem qualquer mudança de comportamento para essa aba.
  mode?: 'range';
  startedAt?: string | null;
  finishedAt?: string | null;
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

const formatMoment = (date: Date | null): string =>
  date
    ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

/** Live "in progress" readout for the count currently being filled in — resets whenever resetKey changes. */
export function CountSidePanel({ stats, resetKey }: CountSidePanelProps) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRangeMode = stats.mode === 'range';

  useEffect(() => {
    setSeconds(0);
  }, [resetKey]);

  useEffect(() => {
    // Cronômetro legado — só roda para Importar Contagem (não usa mode: 'range').
    if (!isRangeMode && stats.active) {
      intervalRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRangeMode, stats.active]);

  const pendentes = Math.max(0, stats.totalSku - stats.contados);

  const startedDate = isRangeMode && stats.startedAt ? new Date(stats.startedAt) : null;
  const finishedDate = isRangeMode && stats.finishedAt ? new Date(stats.finishedAt) : null;
  const durationLabel = startedDate && finishedDate
    ? formatFriendlyDuration(Math.max(0, finishedDate.getTime() - startedDate.getTime()))
    : 'Aguardando início e término';

  let status: string;
  let statusVariant: 'success' | 'accent' | 'neutral';
  if (isRangeMode) {
    if (!startedDate) { status = 'Não iniciada'; statusVariant = 'neutral'; }
    else if (!finishedDate) { status = 'Em andamento'; statusVariant = 'accent'; }
    else { status = 'Finalizada'; statusVariant = 'success'; }
  } else {
    status = !stats.active ? 'Aguardando' : pendentes === 0 && stats.totalSku > 0 ? 'Concluída' : 'Em andamento';
    statusVariant = status === 'Concluída' ? 'success' : status === 'Em andamento' ? 'accent' : 'neutral';
  }

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
        {isRangeMode ? (
          <>
            <div>
              <p className="text-xs text-fg-subtle">Início</p>
              <p className="text-sm font-semibold text-fg">{formatMoment(startedDate)}</p>
            </div>
            <div>
              <p className="text-xs text-fg-subtle">Término</p>
              <p className="text-sm font-semibold text-fg">{finishedDate ? formatMoment(finishedDate) : startedDate ? 'Aguardando término' : '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-fg-subtle">Duração</p>
              <p className="text-base font-semibold text-fg font-mono">{durationLabel}</p>
            </div>
          </>
        ) : (
          <div>
            <p className="text-xs text-fg-subtle">Tempo</p>
            <p className="text-base font-semibold text-fg font-mono">{formatDuration(seconds)}</p>
          </div>
        )}
      </PanelSection>
      <PanelSection padding="md">
        <Badge variant={statusVariant}>
          {status}
        </Badge>
      </PanelSection>
    </Panel>
  );
}
