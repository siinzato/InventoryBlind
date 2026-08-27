// Heatmap Legend Component

import React from 'react';
import { Info } from 'lucide-react';
import { Card } from './ui';

export const HeatmapLegend: React.FC = () => {
  const legendItems = [
    {
      color: 'bg-emerald-500',
      border: 'border-emerald-300',
      label: 'Saudável',
      description: 'Acuracidade ≥ 90%, baixa divergência',
    },
    {
      color: 'bg-amber-500',
      border: 'border-amber-300',
      label: 'Atenção',
      description: 'Acuracidade entre 70% e 89%',
    },
    {
      // accent em vez de laranja (fora da paleta aprovada, §5/§23) — precisa
      // continuar distinguível de "Atenção" (âmbar) nesta legenda de 5 itens.
      color: 'bg-accent',
      border: 'border-accent/40',
      label: 'Risco',
      description: 'Acuracidade entre 50% e 69%',
    },
    {
      color: 'bg-red-500',
      border: 'border-red-300',
      label: 'Crítico',
      description: 'Acuracidade < 50% ou alta divergência',
    },
    {
      color: 'bg-fg-subtle',
      border: 'border-edge',
      label: 'Não iniciado',
      description: 'Área ainda não contabilizada',
    },
  ];

  return (
    <Card className="mb-6">
      <p className="text-section flex items-center gap-1.5 mb-3">
        <Info size={12} /> Legenda de Criticidade
      </p>

      <div className="flex flex-wrap gap-4">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div
              className={`w-4 h-4 rounded ${item.color} ${item.border} border-2`}
            />
            <div>
              <span className="text-sm font-medium text-fg-muted">{item.label}</span>
              <span className="text-xs text-fg-subtle ml-1 hidden sm:inline">
                ({item.description})
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
