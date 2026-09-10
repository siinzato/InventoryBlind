import { Panel, PanelSection, Stat, type StatProps } from '../ui';
import { UserProductivityStats } from '../../lib/supabase';

interface ProductivityCardsProps {
  stats: UserProductivityStats;
  rank?: number;
  totalPeers?: number;
}

const formatSeconds = (s: number | null): string => {
  if (s === null) return '—';
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}min ${rem}s`;
};

export function ProductivityCards({ stats, rank, totalPeers }: ProductivityCardsProps) {
  const items: StatProps[] = [
    { label: 'SKUs Contados', value: stats.skus_contados.toLocaleString('pt-BR') },
    { label: 'Contagens', value: stats.contagens.toLocaleString('pt-BR') },
    { label: 'Recontagens', value: stats.recontagens.toLocaleString('pt-BR') },
    { label: 'Divergências Encontradas', value: stats.divergencias_encontradas.toLocaleString('pt-BR') },
    {
      label: 'Divergências Reais',
      value: stats.divergencias_reais.toLocaleString('pt-BR'),
      context: stats.divergencias_encontradas
        ? `de ${stats.divergencias_encontradas.toLocaleString('pt-BR')} encontradas`
        : undefined,
    },
    { label: 'Acuracidade Média', value: stats.acuracidade_media !== null ? `${stats.acuracidade_media.toFixed(1)}%` : '—' },
    { label: 'Tempo Médio/Contagem', value: formatSeconds(stats.tempo_medio_segundos) },
    { label: 'Fulls Realizados', value: stats.fulls_realizados.toLocaleString('pt-BR') },
    { label: 'Itens Separados', value: stats.itens_separados.toLocaleString('pt-BR') },
    { label: 'Etiquetas Geradas', value: stats.etiquetas_geradas.toLocaleString('pt-BR') },
    {
      label: 'Ranking Interno',
      value: rank ? `#${rank}` : '—',
      context: rank && totalPeers ? `de ${totalPeers} operadores` : undefined,
    },
  ];

  // Eleven stats in one Panel with a single internal grid — one grouped surface
  // with generous column gaps, not eleven bordered boxes.
  return (
    <Panel>
      <PanelSection padding="md" className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(item => (
          <Stat key={item.label} {...item} />
        ))}
      </PanelSection>
    </Panel>
  );
}
