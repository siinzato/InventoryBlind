// Main Heatmap Component

import React, { useState, useMemo, useCallback } from 'react';
import { Grid3X3, List, BarChart3, Map, RefreshCw, AlertTriangle, FileDown, Download } from 'lucide-react';
import type { HeatmapArea, HeatmapFilters, ViewMode } from '../lib/heatmapTypes';
import {
  filterHeatmapAreas,
  calculateHeatmapStats,
  generateMockHeatmapData,
  getTopCriticalAreas,
  calculateRiskScore,
} from '../lib/heatmapUtils';
import { HeatmapFiltersComponent } from './HeatmapFilters';
import { HeatmapLegend } from './HeatmapLegend';
import { HeatmapCard } from './HeatmapCard';
import { HeatmapDetailsModal } from './HeatmapDetailsModal';
import { HeatmapStatsComponent } from './HeatmapStats';

interface HeatmapEstoqueProps {
  brandsData: Array<{
    id: string;
    brand: string;
    total_sku: number;
    done_sku: number;
    divergences: number;
    updated_at?: string;
  }>;
  onRequestAdminAccess: () => void;
  isAdmin: boolean;
  onLogout: () => void;
}

const defaultFilters: HeatmapFilters = {
  status: 'all',
  marca: '',
  criticidade: 'all',
  ordenacao: 'risk_desc',
  busca: '',
};

export const HeatmapEstoque: React.FC<HeatmapEstoqueProps> = ({
  brandsData,
  onRequestAdminAccess,
  isAdmin,
  onLogout,
}) => {
  const [filters, setFilters] = useState<HeatmapFilters>(defaultFilters);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedArea, setSelectedArea] = useState<HeatmapArea | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [areas, setAreas] = useState<HeatmapArea[]>(() => generateMockHeatmapData(brandsData));

  // Generate heatmap data from brands
  const heatmapAreas = useMemo(() => {
    if (areas.length === 0 && brandsData.length > 0) {
      return generateMockHeatmapData(brandsData);
    }
    return areas;
  }, [brandsData, areas]);

  // Filter and sort areas
  const filteredAreas = useMemo(() => {
    return filterHeatmapAreas(heatmapAreas, filters);
  }, [heatmapAreas, filters]);

  // Top critical areas for ranking
  const topCriticalAreas = useMemo(() => {
    return getTopCriticalAreas(heatmapAreas, 10);
  }, [heatmapAreas]);

  // Calculate statistics
  const stats = useMemo(() => {
    return calculateHeatmapStats(heatmapAreas);
  }, [heatmapAreas]);

  // Get unique brands for filter
  const marcas = useMemo(() => {
    return Array.from(new Set(heatmapAreas.map(a => ({ id: a.marcaId || '', nome: a.marcaNome || a.nome }))))
      .filter(m => m.id && m.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [heatmapAreas]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<HeatmapFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  // Reset filters
  const handleResetFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  // Handle area click
  const handleAreaClick = useCallback((area: HeatmapArea) => {
    setSelectedArea(area);
    setIsModalOpen(true);
  }, []);

  // Handle modal close
  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setSelectedArea(null);
  }, []);

  // Handle save locais fisicos
  const handleSaveLocais = useCallback((areaId: string, locais: Array<{ id: string; nome: string; descricao: string }>) => {
    setAreas(prev => prev.map(area => {
      if (area.id === areaId) {
        return { ...area, locaisFisicos: locais };
      }
      return area;
    }));
  }, []);

  // Toggle recontagem
  const handleToggleRecontagem = useCallback((areaId: string) => {
    setAreas(prev => prev.map(area => {
      if (area.id === areaId) {
        return { ...area, marcadoRecontagem: !area.marcadoRecontagem };
      }
      return area;
    }));
    // Update selected area if it's the same
    setSelectedArea(prev => {
      if (prev && prev.id === areaId) {
        return { ...prev, marcadoRecontagem: !prev.marcadoRecontagem };
      }
      return prev;
    });
  }, []);

  // Export report
  const handleExportReport = useCallback((area: HeatmapArea) => {
    const riskScore = calculateRiskScore(area);
    const report = `
RELATÓRIO DE ÁREA - HEATMAP DO ESTOQUE
=====================================

Área: ${area.nome}
Tipo: ${area.tipo.toUpperCase()}
Marca: ${area.marcaNome || 'Não definida'}
Responsável: ${area.responsavel}
Última atualização: ${area.ultimaAtualizacao}

MÉTRICAS
--------
Total de SKUs: ${area.totalSku}
SKUs Contados: ${area.concluidos}
Pendentes: ${area.totalSku - area.concluidos}
Divergências: ${area.divergencias}
Progresso: ${area.progresso.toFixed(1)}%
Acuracidade: ${area.acuracidade.toFixed(1)}%

SCORE DE RISCO: ${riskScore}
${
  riskScore >= 81 ? 'CRÍTICO - Ação imediata necessária!' :
  riskScore >= 61 ? 'ALTO RISCO - Atenção prioritária!' :
  riskScore >= 31 ? 'RISCO MÉDIO - Monitorar de perto.' :
  riskScore > 0 ? 'BAIXO RISCO - Situação estável.' : 'Não avaliado.'
}

LOCAIS FÍSICOS
-------------
${area.locaisFisicos.length > 0
  ? area.locaisFisicos.map((l, i) => `${i + 1}. ${l.nome}${l.descricao ? ` - ${l.descricao}` : ''}`).join('\n')
  : 'Nenhum local cadastrado.'
}

${area.produtosDivergentes.length > 0 ? `
PRODUTOS DIVERGENTES
--------------------
${area.produtosDivergentes.join(', ')}
` : ''}

GERADO EM: ${new Date().toLocaleString('pt-BR')}
=====================================
`;

    // Create and download file
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${area.nome.replace(/\s+/g, '-').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Refresh data
  const handleRefresh = useCallback(() => {
    setAreas(generateMockHeatmapData(brandsData));
  }, [brandsData]);

  // Count areas marked for recount
  const areasParaRecontagem = useMemo(() => {
    return heatmapAreas.filter(a => a.marcadoRecontagem);
  }, [heatmapAreas]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-600 rounded-xl">
            <Map size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-800">Heatmap do Estoque</h1>
            <p className="text-zinc-500">Visualize a saúde do seu estoque com score de risco inteligente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="text-sm text-emerald-600 font-medium bg-emerald-100 px-3 py-1 rounded-full">
              Admin
            </span>
          )}
          {areasParaRecontagem.length > 0 && (
            <span className="text-sm text-blue-600 font-medium bg-blue-100 px-3 py-1 rounded-full flex items-center gap-1">
              <RefreshCw size={14} />
              {areasParaRecontagem.length} para recontagem
            </span>
          )}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition text-sm font-medium text-zinc-700"
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
          {isAdmin ? (
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition text-sm font-medium"
            >
              Sair do Admin
            </button>
          ) : (
            <button
              onClick={onRequestAdminAccess}
              className="px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition text-sm font-medium"
            >
              Acesso Admin
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <HeatmapStatsComponent stats={stats} />

      {/* Top Critical Areas Alert */}
      {topCriticalAreas.length > 0 && topCriticalAreas[0] && calculateRiskScore(topCriticalAreas[0]) >= 60 && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <h4 className="font-bold text-red-800">Top 5 Áreas Mais Críticas</h4>
              <p className="text-sm text-red-600">Requerem atenção imediata</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {topCriticalAreas.slice(0, 5).map((area, idx) => {
              const score = calculateRiskScore(area);
              return (
                <button
                  key={area.id}
                  onClick={() => handleAreaClick(area)}
                  className="bg-white rounded-lg p-3 text-left border border-red-200 hover:border-red-400 transition"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-500">#{idx + 1}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      score >= 81 ? 'bg-red-600 text-white' :
                      score >= 61 ? 'bg-orange-500 text-white' : 'bg-amber-500 text-white'
                    }`}>
                      {score}
                    </span>
                  </div>
                  <p className="font-medium text-zinc-800 text-sm truncate">{area.nome}</p>
                  <p className="text-xs text-zinc-500">{area.divergencias} div.</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <HeatmapFiltersComponent
        filters={filters}
        onFilterChange={handleFilterChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        marcas={marcas}
        onReset={handleResetFilters}
      />

      {/* Legend */}
      <HeatmapLegend />

      {/* Results Count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-500">
          Mostrando <span className="font-semibold text-zinc-700">{filteredAreas.length}</span> de {heatmapAreas.length} áreas
        </p>
      </div>

      {/* Heatmap Grid/List/Ranking */}
      {filteredAreas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-12 text-center">
          <BarChart3 size={48} className="mx-auto text-zinc-300 mb-4" />
          <h3 className="text-lg font-semibold text-zinc-700 mb-2">Nenhuma área encontrada</h3>
          <p className="text-zinc-500">Tente ajustar os filtros para ver mais resultados.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredAreas.map((area) => (
            <HeatmapCard
              key={area.id}
              area={area}
              onClick={handleAreaClick}
              viewMode="grid"
            />
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-3">
          {filteredAreas.map((area) => (
            <HeatmapCard
              key={area.id}
              area={area}
              onClick={handleAreaClick}
              viewMode="list"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={20} className="text-orange-600" />
              <div>
                <h4 className="font-bold text-orange-800">Ranking por Score de Risco</h4>
                <p className="text-sm text-orange-600">Top 10 áreas com maior risco</p>
              </div>
            </div>
          </div>
          {topCriticalAreas.map((area, index) => (
            <HeatmapCard
              key={area.id}
              area={area}
              onClick={handleAreaClick}
              viewMode="ranking"
              rank={index + 1}
            />
          ))}
        </div>
      )}

      {/* Details Modal */}
      <HeatmapDetailsModal
        area={selectedArea}
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onRequestAdminAccess={onRequestAdminAccess}
        isAdmin={isAdmin}
        onSaveLocais={handleSaveLocais}
        onToggleRecontagem={handleToggleRecontagem}
        onExportReport={handleExportReport}
      />
    </div>
  );
};
