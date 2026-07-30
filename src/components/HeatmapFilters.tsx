// Heatmap Filters Component

import React from 'react';
import { Filter, SortAsc, SortDesc, Search, X } from 'lucide-react';
import type { HeatmapFilters as HeatmapFiltersType, StatusFilter, SortOption, CriticalityLevel, ViewMode } from '../lib/heatmapTypes';

interface HeatmapFiltersProps {
  filters: HeatmapFiltersType;
  onFilterChange: (filters: Partial<HeatmapFiltersType>) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  marcas: { id: string; nome: string }[];
  onReset: () => void;
}

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'andamento', label: 'Em andamento' },
  { value: 'pendente', label: 'Não iniciado' },
];

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'nome', label: 'Nome (A-Z)' },
  { value: 'risk_desc', label: 'Maior risco (score)' },
  { value: 'divergencia_desc', label: 'Maior divergência' },
  { value: 'acuracidade_asc', label: 'Menor acuracidade' },
  { value: 'progresso_desc', label: 'Maior progresso' },
];

const criticalityOptions: { value: CriticalityLevel | 'all'; label: string; color: string }[] = [
  { value: 'all', label: 'Todas', color: 'bg-zinc-500' },
  { value: 'success', label: 'Saudável', color: 'bg-emerald-500' },
  { value: 'warning', label: 'Atenção', color: 'bg-amber-500' },
  { value: 'danger', label: 'Risco', color: 'bg-orange-500' },
  { value: 'critical', label: 'Crítico', color: 'bg-red-500' },
];

const viewModeOptions: { value: ViewMode; label: string }[] = [
  { value: 'grid', label: 'Grade' },
  { value: 'list', label: 'Lista' },
  { value: 'ranking', label: 'Ranking' },
];

export const HeatmapFiltersComponent: React.FC<HeatmapFiltersProps> = ({
  filters,
  onFilterChange,
  viewMode,
  onViewModeChange,
  marcas,
  onReset,
}) => {
  const hasActiveFilters =
    filters.status !== 'all' ||
    filters.marca !== '' ||
    filters.criticidade !== 'all' ||
    filters.busca !== '' ||
    filters.ordenacao !== 'nome';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5 mb-6">
      {/* Search Bar */}
      <div className="flex flex-col lg:flex-row gap-4 mb-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar por nome, marca ou responsável..."
            value={filters.busca}
            onChange={(e) => onFilterChange({ busca: e.target.value })}
            className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {filters.busca && (
            <button
              onClick={() => onFilterChange({ busca: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg">
          {viewModeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onViewModeChange(option.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                viewMode === option.value
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-zinc-500" />
          <select
            value={filters.status}
            onChange={(e) => onFilterChange({ status: e.target.value as StatusFilter })}
            className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Brand Filter */}
        <select
          value={filters.marca}
          onChange={(e) => onFilterChange({ marca: e.target.value })}
          className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todas as marcas</option>
          {marcas.map((marca) => (
            <option key={marca.id} value={marca.id}>
              {marca.nome}
            </option>
          ))}
        </select>

        {/* Sort */}
        <div className="flex items-center gap-2">
          {filters.ordenacao === 'nome' ? <SortAsc size={16} className="text-zinc-500" /> : <SortDesc size={16} className="text-zinc-500" />}
          <select
            value={filters.ordenacao}
            onChange={(e) => onFilterChange({ ordenacao: e.target.value as SortOption })}
            className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Criticality Pills */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-zinc-500 mr-2">Criticidade:</span>
          {criticalityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFilterChange({ criticidade: opt.value })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition ${
                filters.criticidade === opt.value
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${opt.color}`} />
              {opt.label}
            </button>
          ))}
        </div>

        {/* Reset Button */}
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
          >
            <X size={14} />
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
};
