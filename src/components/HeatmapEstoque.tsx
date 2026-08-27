// Main Heatmap Component

import React, { useState, useMemo, useCallback, useEffect } from 'react';
// `Map as MapIcon`: o ícone homônimo sombreava o Map nativo, e o estado de detalhes por
// marca é um Map de verdade.
import { Grid3X3, List, BarChart3, Map as MapIcon, RefreshCw, AlertTriangle, FileDown, Download } from 'lucide-react';
import type { HeatmapArea, HeatmapFilters, ViewMode } from '../lib/heatmapTypes';
import {
  filterHeatmapAreas,
  calculateHeatmapStats,
  buildHeatmapAreas,
  getTopCriticalAreas,
  calculateRiskScore,
} from '../lib/heatmapUtils';
import { getBrandCountDetails, type BrandCountDetail } from '../lib/heatmapService';
import { HeatmapFiltersComponent } from './HeatmapFilters';
import { HeatmapLegend } from './HeatmapLegend';
import { HeatmapCard } from './HeatmapCard';
import { HeatmapDetailsModal } from './HeatmapDetailsModal';
import { HeatmapStatsComponent } from './HeatmapStats';
import { Badge, Button, Card, Panel, PanelSection } from './ui';

interface HeatmapEstoqueProps {
  brandsData: Array<{
    id: string;
    brand: string;
    total_sku: number;
    done_sku: number;
    divergences: number;
    updated_at?: string;
  }>;
  companyId: string;
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
  companyId,
  onRequestAdminAccess,
  isAdmin,
  onLogout,
}) => {
  const [filters, setFilters] = useState<HeatmapFilters>(defaultFilters);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedArea, setSelectedArea] = useState<HeatmapArea | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  /** Edições locais do modal (locais físicos, recontagem). `null` = ainda não editado,
   *  e nesse caso as áreas vêm direto das marcas + contagens reais. */
  const [areas, setAreas] = useState<HeatmapArea[] | null>(null);
  /** Responsável, SKUs divergentes e locais reais, por marca. */
  const [details, setDetails] = useState<Map<string, BrandCountDetail>>(new Map());

  useEffect(() => {
    let cancelled = false;
    getBrandCountDetails(companyId).then(loaded => {
      if (!cancelled) setDetails(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Áreas derivadas das marcas reais + o que foi realmente contado.
  const heatmapAreas = useMemo(
    () => areas ?? buildHeatmapAreas(brandsData, details),
    [areas, brandsData, details]
  );

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
    // `prev ?? heatmapAreas`: a primeira edição parte das áreas derivadas dos dados
    // reais, e não de um array vazio.
    setAreas(prev => (prev ?? heatmapAreas).map(area => {
      if (area.id === areaId) {
        return { ...area, locaisFisicos: locais };
      }
      return area;
    }));
  }, [heatmapAreas]);

  // Toggle recontagem
  const handleToggleRecontagem = useCallback((areaId: string) => {
    setAreas(prev => (prev ?? heatmapAreas).map(area => {
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
  }, [heatmapAreas]);

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

  // Refresh data — descarta as edições locais e recarrega as contagens do banco.
  const handleRefresh = useCallback(() => {
    setAreas(null);
    void getBrandCountDetails(companyId).then(setDetails);
  }, [companyId]);

  // Count areas marked for recount
  const areasParaRecontagem = useMemo(() => {
    return heatmapAreas.filter(a => a.marcadoRecontagem);
  }, [heatmapAreas]);

  return (
    <div className="min-h-screen bg-surface p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <MapIcon size={24} className="text-accent flex-shrink-0" />
          <div>
            <h1 className="text-display">Heatmap do Estoque</h1>
            <p className="text-sm text-fg-muted mt-1">Visualize a saúde do seu estoque com score de risco inteligente</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && <Badge variant="success">Admin</Badge>}
          {areasParaRecontagem.length > 0 && (
            <Badge variant="accent">
              <RefreshCw size={14} />
              {areasParaRecontagem.length} para recontagem
            </Badge>
          )}
          <Button variant="secondary" onClick={handleRefresh}>
            <RefreshCw size={16} />
            Atualizar
          </Button>
          {isAdmin ? (
            <Button variant="secondary" onClick={onLogout}>
              Sair do Admin
            </Button>
          ) : (
            <Button variant="secondary" onClick={onRequestAdminAccess}>
              Acesso Admin
            </Button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <HeatmapStatsComponent stats={stats} />

      {/* Top Critical Areas Alert — o texto e o score de cada área já
          comunicam a gravidade; não precisa de ícone gigante nem de fundo
          colorido cobrindo o painel inteiro (§3/§7). */}
      {topCriticalAreas.length > 0 && topCriticalAreas[0] && calculateRiskScore(topCriticalAreas[0]) >= 60 && (
        <Panel className="mb-6">
          <PanelSection>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-fg-subtle" />
              <div>
                <h4 className="text-section">Top 5 áreas mais críticas</h4>
                <p className="text-xs text-fg-subtle">Requerem atenção imediata</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {topCriticalAreas.slice(0, 5).map((area, idx) => {
                const score = calculateRiskScore(area);
                return (
                  <button
                    key={area.id}
                    onClick={() => handleAreaClick(area)}
                    className="rounded-control p-3 text-left border border-edge hover:bg-surface-3/40 transition"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-fg-subtle">#{idx + 1}</span>
                      <Badge variant={score >= 81 ? 'danger' : 'warning'}>{score}</Badge>
                    </div>
                    <p className="font-medium text-fg text-sm truncate">{area.nome}</p>
                    <p className="text-xs text-fg-subtle">{area.divergencias} div.</p>
                  </button>
                );
              })}
            </div>
          </PanelSection>
        </Panel>
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
        <p className="text-sm text-fg-subtle">
          Mostrando <span className="font-semibold text-fg-muted">{filteredAreas.length}</span> de {heatmapAreas.length} áreas
        </p>
      </div>

      {/* Heatmap Grid/List/Ranking */}
      {filteredAreas.length === 0 ? (
        <Card padding="none" className="p-12 text-center">
          <BarChart3 size={48} className="mx-auto text-fg-subtle mb-4" />
          <h3 className="text-lg font-semibold text-fg-muted mb-2">Nenhuma área encontrada</h3>
          <p className="text-fg-subtle">Tente ajustar os filtros para ver mais resultados.</p>
        </Card>
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
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-fg-subtle" />
            <div>
              <h4 className="text-section">Ranking por Score de Risco</h4>
              <p className="text-xs text-fg-subtle">Top 10 áreas com maior risco</p>
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
