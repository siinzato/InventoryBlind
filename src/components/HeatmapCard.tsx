// Heatmap Card Component

import React from 'react';
import { MapPin, Package, AlertTriangle, CheckCircle, TrendingUp, ChevronRight, AlertOctagon, Flag } from 'lucide-react';
import type { HeatmapArea, RiskLevel } from '../lib/heatmapTypes';
import {
  getCriticalityLevel,
  getCriticalityBgClass,
  getCriticalityTextClass,
  getProgressBgClass,
  calculatePending,
  calculateRiskScore,
  getRiskLevel,
  getRiskLevelLabel,
  getRiskLevelColor,
  getRiskGradient,
} from '../lib/heatmapUtils';

interface HeatmapCardProps {
  area: HeatmapArea;
  onClick: (area: HeatmapArea) => void;
  viewMode: 'grid' | 'list' | 'ranking';
  rank?: number;
}

// Plain-text color for the numeric risk score — one shared mapping so the
// same figure renders identically across grid/list/ranking instead of three
// hand-rolled ternaries (the ranking view previously dropped the "low" tier).
const RISK_SCORE_TEXT_CLASS: Record<RiskLevel, string> = {
  none: 'text-fg-subtle',
  low: 'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
};

export const HeatmapCard: React.FC<HeatmapCardProps> = ({ area, onClick, viewMode, rank }) => {
  const criticality = getCriticalityLevel(area);
  const bgClass = getCriticalityBgClass(criticality);
  const textClass = getCriticalityTextClass(criticality);
  const progressBg = getProgressBgClass(criticality);
  const pending = calculatePending(area.totalSku, area.concluidos);
  const progress = area.progresso;
  const accuracy = area.acuracidade;

  // Calculate risk score
  const riskScore = calculateRiskScore(area);
  const riskLevel = getRiskLevel(riskScore);
  const riskLabel = getRiskLevelLabel(riskLevel);
  const riskGradient = getRiskGradient(riskLevel);

  const isHighRisk = riskLevel === 'high' || riskLevel === 'critical';
  const showPriorityBadge = riskLevel === 'critical';

  // Grid View
  if (viewMode === 'grid') {
    return (
      <button
        onClick={() => onClick(area)}
        className={`${riskGradient} border-2 rounded-xl p-5 text-left transition-all hover:shadow-sm hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent/40 group relative overflow-hidden`}
      >
        {/* Priority Badge */}
        {showPriorityBadge && (
          <div className="absolute top-2 right-2">
            <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold bg-red-600 text-white rounded-full animate-pulse">
              <Flag size={12} />
              PRIORIDADE
            </span>
          </div>
        )}

        {/* Recontagem Badge */}
        {area.marcadoRecontagem && (
          <div className="absolute top-2 left-2">
            <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-accent text-white rounded-full">
              <AlertOctagon size={12} />
              Recontagem
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPin size={18} className={isHighRisk ? 'text-red-600 dark:text-red-400' : textClass} />
            <span className={`font-bold text-fg group-hover:text-fg ${showPriorityBadge ? 'pr-16' : ''}`}>
              {area.nome}
            </span>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full bg-surface-2/70 ${textClass} font-medium`}>
            {area.tipo.toUpperCase()}
          </span>
        </div>

        {/* Risk Score */}
        {area.progresso > 0 && (
          <div className={`rounded-lg p-2 mb-3 ${isHighRisk ? 'bg-red-500/10' : 'bg-surface-2/70'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-subtle">Score de Risco</span>
              <div className="flex items-center gap-2">
                {isHighRisk && <AlertOctagon size={14} className="text-red-600 dark:text-red-400 animate-pulse" />}
                <span className={`font-bold text-sm ${RISK_SCORE_TEXT_CLASS[riskLevel]}`}>
                  {riskScore}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${getRiskLevelColor(riskLevel)}`}>
                  {riskLevel === 'critical' ? 'CRÍTICO' : riskLevel === 'high' ? 'ALTO' : riskLevel === 'medium' ? 'MÉDIO' : 'BAIXO'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface-2/70 rounded-lg p-2">
            <p className="text-xs text-fg-subtle">Total SKUs</p>
            <p className="font-bold text-fg">{area.totalSku}</p>
          </div>
          <div className="bg-surface-2/70 rounded-lg p-2">
            <p className="text-xs text-fg-subtle">Contados</p>
            <p className="font-bold text-fg">{area.concluidos}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-fg-subtle">Progresso</span>
            <span className={`font-medium ${textClass}`}>{progress.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-surface-2/70 rounded-full overflow-hidden">
            <div
              className={`h-full ${progressBg} transition-all duration-300`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Accuracy & Divergences */}
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-1">
            <CheckCircle size={14} className={textClass} />
            <span className={textClass}>
              {accuracy >= 90 ? 'Saudável' : accuracy >= 70 ? 'Atenção' : accuracy >= 50 ? 'Risco' : 'Crítico'}
            </span>
          </div>
          {area.divergencias > 0 && (
            <div className="flex items-center gap-1">
              <AlertTriangle size={14} className="text-red-600 dark:text-red-400" />
              <span className="text-red-600 dark:text-red-400 font-medium text-xs">{area.divergencias}</span>
            </div>
          )}
        </div>
      </button>
    );
  }

  // List View
  if (viewMode === 'list') {
    return (
      <button
        onClick={() => onClick(area)}
        className={`w-full ${riskGradient} border-2 rounded-xl p-5 text-left transition-all hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40 flex items-center gap-4 relative`}
      >
        {/* Priority Badge */}
        {showPriorityBadge && (
          <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-xs font-bold bg-red-600 text-white rounded-full animate-pulse">
            <Flag size={12} />
            PRIORIDADE
          </span>
        )}

        <div className="flex-shrink-0">
          <div className={`w-12 h-12 rounded-lg ${progressBg} flex items-center justify-center relative`}>
            <MapPin size={28} className="text-white" />
            {isHighRisk && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center animate-pulse">
                <AlertOctagon size={10} className="text-white" />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-fg">{area.nome}</span>
            {area.marcadoRecontagem && (
              <span className="px-2 py-0.5 text-xs font-medium bg-accent text-white rounded-full">
                Recontagem
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full bg-surface-2/70 ${textClass}`}>
              {area.tipo.toUpperCase()}
            </span>
          </div>
          <p className="text-sm text-fg-subtle">
            {area.marcaNome || 'Sem marca'} · {area.responsavel}
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-6">
          {/* Risk Score */}
          {area.progresso > 0 && (
            <div className="text-center">
              <p className="text-xs text-fg-subtle">Score Risco</p>
              <div className="flex items-center gap-1">
                <span className={`font-bold ${RISK_SCORE_TEXT_CLASS[riskLevel]}`}>
                  {riskScore}
                </span>
                {isHighRisk && <AlertOctagon size={12} className="text-red-600 dark:text-red-400" />}
              </div>
            </div>
          )}
          <div className="text-center">
            <p className="text-xs text-fg-subtle">SKUs</p>
            <p className="font-bold text-fg">{area.totalSku}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-fg-subtle">Progresso</p>
            <p className={`font-bold ${textClass}`}>{progress.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-fg-subtle">Acuracidade</p>
            <p className={`font-bold ${textClass}`}>{accuracy.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-fg-subtle">Divergências</p>
            <p className={`font-bold ${area.divergencias > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}>
              {area.divergencias}
            </p>
          </div>
        </div>

        <ChevronRight size={20} className="text-fg-subtle" />
      </button>
    );
  }

  // Ranking View (now by risk score)
  return (
    <button
      onClick={() => onClick(area)}
      className={`w-full ${riskGradient} border-2 rounded-xl p-5 text-left transition-all hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40`}
    >
      <div className="flex items-center gap-4">
        {/* Rank Badge */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
            rank === 1 ? 'bg-red-600' : rank === 2 ? 'bg-orange-500' : rank === 3 ? 'bg-amber-500' : 'bg-fg-subtle'
          }`}
        >
          #{rank}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-fg">{area.nome}</span>
            {area.marcadoRecontagem && (
              <span className="px-2 py-0.5 text-xs font-medium bg-accent text-white rounded-full">
                Recontagem
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {/* Risk Score */}
            <span className={`font-bold ${RISK_SCORE_TEXT_CLASS[riskLevel]}`}>
              <AlertOctagon size={14} className="inline mr-1" />
              Score: {riskScore} ({riskLabel})
            </span>
            <span className={textClass}>
              <TrendingUp size={14} className="inline mr-1" />
              Acuracidade: {accuracy.toFixed(1)}%
            </span>
            <span className={area.divergencias > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}>
              <AlertTriangle size={14} className="inline mr-1" />
              {area.divergencias} divergências
            </span>
            <span className="text-fg-subtle">
              <Package size={14} className="inline mr-1" />
              {pending} pendentes
            </span>
          </div>
        </div>

        <ChevronRight size={20} className="text-fg-subtle" />
      </div>
    </button>
  );
};
