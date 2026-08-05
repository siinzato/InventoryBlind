// Dashboard Ranking Preview — rendered as PanelSection children inside the
// parent Panel (App.tsx), so it stays part of one surface, not its own card.

import React from 'react';
import { Trophy, AlertTriangle, Clock, ArrowRight } from 'lucide-react';
import { PanelSection } from './ui';

interface BrandRow {
  id: string;
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  status: string;
}

interface RankingItem {
  nome: string;
  valor: string;
}

interface DashboardRankingPreviewProps {
  melhores: RankingItem[];
  piores: RankingItem[];
  inProgress: BrandRow[];
  onViewAll: () => void;
}

const TOP_N = 5;

function RankRow({ label, value, valueClassName = 'text-fg' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-fg-muted truncate">{label}</span>
      <span className={`text-sm font-semibold whitespace-nowrap ${valueClassName}`}>{value}</span>
    </div>
  );
}

export const DashboardRankingPreview: React.FC<DashboardRankingPreviewProps> = ({
  melhores,
  piores,
  inProgress,
  onViewAll,
}) => {
  const top5Best = melhores.slice(0, TOP_N);
  const top5Worst = piores.slice(0, TOP_N);
  const top5Progress = inProgress.slice(0, TOP_N);

  return (
    <>
      <PanelSection>
        <p className="text-section flex items-center gap-1.5">
          <Trophy size={12} /> Melhores
        </p>
        {top5Best.length === 0 ? (
          <p className="text-caption mt-2">Nenhuma linha concluída ainda.</p>
        ) : (
          <div className="mt-1 divide-y divide-edge/60">
            {top5Best.map((m, i) => (
              <RankRow key={i} label={m.nome} value={m.valor} valueClassName="text-emerald-600 dark:text-emerald-400" />
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection>
        <p className="text-section flex items-center gap-1.5">
          <AlertTriangle size={12} /> Críticas
        </p>
        {top5Worst.length === 0 ? (
          <p className="text-caption mt-2">Nenhuma linha concluída ainda.</p>
        ) : (
          <div className="mt-1 divide-y divide-edge/60">
            {top5Worst.map((m, i) => (
              <RankRow key={i} label={m.nome} value={m.valor} valueClassName="text-red-600 dark:text-red-400" />
            ))}
          </div>
        )}
      </PanelSection>

      {top5Progress.length > 0 && (
        <PanelSection>
          <p className="text-section flex items-center gap-1.5">
            <Clock size={12} /> Em andamento
          </p>
          <div className="mt-1 divide-y divide-edge/60">
            {top5Progress.map((b) => (
              <RankRow key={b.id} label={b.brand} value={`${b.progress.toFixed(1)}%`} />
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection padding="sm">
        <button
          onClick={onViewAll}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong transition-colors py-1"
        >
          Ver rankings completos <ArrowRight size={14} />
        </button>
      </PanelSection>
    </>
  );
};
