// Heatmap Stats Component

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CheckCircle,
  MinusCircle,
  TrendingDown,
  Target,
  Layers,
  RefreshCcw,
  Gauge,
} from 'lucide-react';
import type { HeatmapStats } from '../lib/heatmapTypes';
import { Panel, PanelSection } from './ui';

interface HeatmapStatsProps {
  stats: HeatmapStats;
}

interface StatItem {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  valueClassName?: string;
  isText?: boolean;
}

function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 divide-y divide-edge md:divide-y-0 md:divide-x">
      {items.map((stat, i) => (
        <div key={stat.title} className={`px-0 md:px-6 py-4 md:py-0 ${i === 0 ? 'md:pl-0' : ''}`}>
          <p className="text-section flex items-center gap-1.5">
            <stat.icon size={12} />
            {stat.title}
          </p>
          <p className={`mt-1.5 ${stat.isText ? 'text-title truncate' : 'text-display'} ${stat.valueClassName ?? ''}`}>
            {stat.value}
          </p>
          <p className="text-caption mt-1">{stat.subtitle}</p>
        </div>
      ))}
    </div>
  );
}

export const HeatmapStatsComponent: React.FC<HeatmapStatsProps> = ({ stats }) => {
  // Mesma escala de 4 cores de getRiskLevelColor (heatmapUtils.ts) — sem
  // laranja, fora da paleta aprovada (§5/§23).
  const riskColor =
    stats.mediaGeracaoRisco >= 60 ? 'text-red-700 dark:text-red-400' :
    stats.mediaGeracaoRisco >= 40 ? 'text-amber-700 dark:text-amber-400' :
    stats.mediaGeracaoRisco >= 20 ? 'text-accent' :
    'text-emerald-700 dark:text-emerald-400';

  const accuracyColor =
    stats.mediaAcuracidade >= 80 ? 'text-emerald-700 dark:text-emerald-400' :
    stats.mediaAcuracidade >= 60 ? 'text-amber-700 dark:text-amber-400' :
    'text-red-700 dark:text-red-400';

  const mainStats: StatItem[] = [
    {
      title: 'Áreas Críticas',
      value: stats.areasCriticas,
      subtitle: 'Precisam de atenção urgente',
      icon: AlertTriangle,
      valueClassName: 'text-red-700 dark:text-red-400',
    },
    {
      title: 'Áreas Saudáveis',
      value: stats.areasSaudaveis,
      subtitle: 'Com bom desempenho',
      icon: CheckCircle,
      valueClassName: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      title: 'Não Iniciadas',
      value: stats.areasNaoIniciadas,
      subtitle: 'Aguardando contagem',
      icon: MinusCircle,
    },
    {
      title: 'Maior Risco',
      value: stats.maiorPontoRisco || 'Nenhum',
      subtitle: 'Ponto crítico atual',
      icon: TrendingDown,
      valueClassName: 'text-amber-700 dark:text-amber-400',
      isText: true,
    },
  ];

  const summaryStats: StatItem[] = [
    {
      title: 'Média Risco Geral',
      value: `${stats.mediaGeracaoRisco.toFixed(0)}/100`,
      subtitle: 'Score médio',
      icon: Gauge,
      valueClassName: riskColor,
    },
    {
      title: 'Para Recontagem',
      value: stats.areasParaRecontagem,
      subtitle: 'Na fila de prioridade',
      icon: RefreshCcw,
    },
    {
      title: 'Total Áreas',
      value: stats.totalAreas,
      subtitle: `${stats.totalDivergencias} divergências`,
      icon: Layers,
    },
    {
      title: 'Média Acuracidade',
      value: `${stats.mediaAcuracidade.toFixed(1)}%`,
      subtitle: 'Média geral',
      icon: Target,
      valueClassName: accuracyColor,
    },
  ];

  return (
    <Panel className="mb-6">
      <PanelSection padding="lg">
        <StatGrid items={mainStats} />
      </PanelSection>
      <PanelSection padding="lg">
        <StatGrid items={summaryStats} />
      </PanelSection>
    </Panel>
  );
};
