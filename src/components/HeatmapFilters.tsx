// Heatmap Filters Component

import React from 'react';
import { Filter, SortAsc, SortDesc, Search, X } from 'lucide-react';
import type { HeatmapFilters as HeatmapFiltersType, StatusFilter, SortOption, CriticalityLevel, ViewMode } from '../lib/heatmapTypes';
import { Card, Select } from './ui';

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
  { value: 'all', label: 'Todas', color: 'bg-fg-subtle' },
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
    <Card className="mb-6">
      {/* Search Bar */}
      <div className="flex flex-col lg:flex-row gap-4 mb-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="text"
            placeholder="Buscar por nome, marca ou responsável..."
            value={filters.busca}
            onChange={(e) => onFilterChange({ busca: e.target.value })}
            className="w-full pl-10 pr-4 py-2.5 bg-surface-3 border border-edge rounded-control text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-transparent"
          />
          {filters.busca && (
            <button
              onClick={() => onFilterChange({ busca: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-1 bg-surface-3 p-1 rounded-control">
          {viewModeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onViewModeChange(option.value)}
              className={`px-4 py-1.5 text-sm font-medium rounded-control transition ${
                viewMode === option.value
                  ? 'bg-surface-2 text-fg shadow-control'
                  : 'text-fg-subtle hover:text-fg-muted'
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
          <Filter size={16} className="text-fg-muted" />
          <Select value={filters.status} onChange={(e) => onFilterChange({ status: e.target.value as StatusFilter })}>
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Brand Filter */}
        <Select value={filters.marca} onChange={(e) => onFilterChange({ marca: e.target.value })}>
          <option value="">Todas as marcas</option>
          {marcas.map((marca) => (
            <option key={marca.id} value={marca.id}>
              {marca.nome}
            </option>
          ))}
        </Select>

        {/* Sort */}
        <div className="flex items-center gap-2">
          {filters.ordenacao === 'nome' ? <SortAsc size={16} className="text-fg-muted" /> : <SortDesc size={16} className="text-fg-muted" />}
          <Select value={filters.ordenacao} onChange={(e) => onFilterChange({ ordenacao: e.target.value as SortOption })}>
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Criticality Pills */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-fg-subtle mr-2">Criticidade:</span>
          {criticalityOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onFilterChange({ criticidade: opt.value })}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition ${
                filters.criticidade === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-surface-3 text-fg-muted hover:bg-edge'
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
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 rounded-control transition"
          >
            <X size={14} />
            Limpar filtros
          </button>
        )}
      </div>
    </Card>
  );
};
