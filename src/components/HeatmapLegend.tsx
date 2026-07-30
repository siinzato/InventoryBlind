// Heatmap Legend Component

import React from 'react';
import { Info } from 'lucide-react';

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
      color: 'bg-orange-500',
      border: 'border-orange-300',
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
      color: 'bg-zinc-400',
      border: 'border-zinc-300',
      label: 'Não iniciado',
      description: 'Área ainda não contabilizada',
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Info size={18} className="text-zinc-500" />
        <h4 className="text-sm font-semibold text-zinc-700">Legenda de Criticidade</h4>
      </div>

      <div className="flex flex-wrap gap-4">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div
              className={`w-4 h-4 rounded ${item.color} ${item.border} border-2`}
            />
            <div>
              <span className="text-sm font-medium text-zinc-700">{item.label}</span>
              <span className="text-xs text-zinc-500 ml-1 hidden sm:inline">
                ({item.description})
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
