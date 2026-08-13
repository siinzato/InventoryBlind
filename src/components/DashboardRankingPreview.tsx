// Dashboard Ranking Preview — rendered as PanelSection children inside the
// parent Panel (App.tsx), so it stays part of one surface, not its own card.

import React from 'react';
import { Target, AlertTriangle, Clock, ArrowRight } from 'lucide-react';
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

/** One row of a preview list. The value is a plain figure: colouring all five
 *  "Melhores" green and all five "Críticas" red tinted by list identity rather
 *  than by state, so ten of the panel's rows were loud at once and none of them
 *  meant anything. The section heading already says which list you're reading. */
function RankRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="truncate text-sm text-fg-muted">{label}</span>
      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-fg">{value}</span>
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
          <Target size={12} /> Melhores
        </p>
        {top5Best.length === 0 ? (
          <p className="text-caption mt-2">Nenhuma linha concluída ainda.</p>
        ) : (
          <div className="mt-1 divide-y divide-edge/60">
            {top5Best.map((m, i) => (
              <RankRow key={i} label={m.nome} value={m.valor} />
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
              <RankRow key={i} label={m.nome} value={m.valor} />
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
