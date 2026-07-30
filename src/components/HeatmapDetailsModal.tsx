// Heatmap Details Modal Component

import React, { useState, useMemo } from 'react';
import {
  X,
  MapPin,
  Package,
  CheckCircle,
  AlertTriangle,
  Clock,
  User,
  Tag,
  MapPinned,
  Plus,
  Trash2,
  Save,
  Lock,
  AlertOctagon,
  FileDown,
  RefreshCcw,
  Flag,
  TrendingUp,
  Activity,
} from 'lucide-react';
import type { HeatmapArea, LocalFisico } from '../lib/heatmapTypes';
import {
  getCriticalityLevel,
  getCriticalityBgClass,
  getCriticalityTextClass,
  calculatePending,
  formatDateTime,
  calculateRiskScore,
  getRiskLevel,
  getRiskLevelLabel,
  getRiskLevelColor,
  generateDiagnosis,
} from '../lib/heatmapUtils';

interface HeatmapDetailsModalProps {
  area: HeatmapArea | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestAdminAccess: () => void;
  isAdmin: boolean;
  onSaveLocais: (areaId: string, locais: LocalFisico[]) => void;
  onToggleRecontagem: (areaId: string) => void;
  onExportReport: (area: HeatmapArea) => void;
}

export const HeatmapDetailsModal: React.FC<HeatmapDetailsModalProps> = ({
  area,
  isOpen,
  onClose,
  onRequestAdminAccess,
  isAdmin,
  onSaveLocais,
  onToggleRecontagem,
  onExportReport,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [locaisEditados, setLocaisEditados] = useState<LocalFisico[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  if (!isOpen || !area) return null;

  const criticality = getCriticalityLevel(area);
  const bgClass = getCriticalityBgClass(criticality);
  const textClass = getCriticalityTextClass(criticality);
  const pending = calculatePending(area.totalSku, area.concluidos);

  // Calculate risk score and diagnosis
  const riskScore = calculateRiskScore(area);
  const riskLevel = getRiskLevel(riskScore);
  const riskLabel = getRiskLevelLabel(riskLevel);
  const riskColorClass = getRiskLevelColor(riskLevel);
  const diagnosis = useMemo(() => generateDiagnosis(area), [area]);

  const handleStartEdit = () => {
    if (isAdmin) {
      setLocaisEditados([...area.locaisFisicos]);
      setEditMode(true);
      setHasChanges(false);
    } else {
      onRequestAdminAccess();
    }
  };

  const handleAddLocal = () => {
    setLocaisEditados([
      ...locaisEditados,
      {
        id: `lf-new-${Date.now()}`,
        nome: '',
        descricao: '',
      },
    ]);
    setHasChanges(true);
  };

  const handleRemoveLocal = (index: number) => {
    setLocaisEditados(locaisEditados.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const handleLocalChange = (index: number, field: 'nome' | 'descricao', value: string) => {
    const novos = [...locaisEditados];
    novos[index] = { ...novos[index], [field]: value };
    setLocaisEditados(novos);
    setHasChanges(true);
  };

  const handleSave = () => {
    const locaisValidos = locaisEditados.filter(l => l.nome.trim() !== '').map((l, i) => ({
      ...l,
      id: l.id || `lf-${area.id}-${i + 1}`,
    }));
    onSaveLocais(area.id, locaisValidos);
    setEditMode(false);
    setHasChanges(false);
  };

  const handleCancel = () => {
    setEditMode(false);
    setLocaisEditados([]);
    setHasChanges(false);
  };

  const criticalityLabels: Record<string, string> = {
    success: 'Saudável',
    warning: 'Atenção',
    danger: 'Risco',
    critical: 'Crítico',
    neutral: 'Não iniciado',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`${bgClass} border-b-2 p-5`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/50 rounded-lg relative">
                <MapPin size={24} className={textClass} />
                {area.marcadoRecontagem && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center">
                    <RefreshCcw size={10} className="text-white" />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-xl font-bold text-zinc-800">{area.nome}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Tag size={14} className="text-zinc-500" />
                  <span className="text-sm text-zinc-500">{area.marcaNome}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full bg-white/50 ${textClass} font-medium`}>
                    {area.tipo.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/50 transition"
            >
              <X size={24} className="text-zinc-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Risk Score Section */}
          {area.progresso > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-zinc-700 flex items-center gap-2">
                  <AlertOctagon size={18} className="text-zinc-500" />
                  Score de Risco
                </h4>
                {area.marcadoRecontagem && (
                  <span className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                    <RefreshCcw size={14} />
                    Marcado para recontagem
                  </span>
                )}
              </div>

              <div className={`rounded-xl p-4 border-2 ${
                riskLevel === 'critical' ? 'bg-red-50 border-red-300' :
                riskLevel === 'high' ? 'bg-orange-50 border-orange-300' :
                riskLevel === 'medium' ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-4xl font-black ${
                      riskLevel === 'critical' ? 'text-red-600' :
                      riskLevel === 'high' ? 'text-orange-600' :
                      riskLevel === 'medium' ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {riskScore}
                    </div>
                    <div>
                      <div className={`text-sm font-bold ${
                        riskLevel === 'critical' ? 'text-red-600' :
                        riskLevel === 'high' ? 'text-orange-600' :
                        riskLevel === 'medium' ? 'text-amber-600' : 'text-emerald-600'
                      }`}>
                        {riskLabel.toUpperCase()}
                      </div>
                      <div className="text-xs text-zinc-500">de 0 a 100</div>
                    </div>
                  </div>
                  {(riskLevel === 'critical' || riskLevel === 'high') && (
                    <div className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded-full text-sm font-bold animate-pulse">
                      <Flag size={14} />
                      PRIORIDADE
                    </div>
                  )}
                </div>

                {/* Risk Factors */}
                {diagnosis.factors.length > 0 && (
                  <div className="border-t border-white/50 pt-3 mt-3">
                    <p className="text-xs text-zinc-500 mb-2">Fatores de risco:</p>
                    <div className="flex flex-wrap gap-2">
                      {diagnosis.factors.map((factor, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            factor.impact === 'alta' ? 'bg-red-200 text-red-700' :
                            factor.impact === 'média' ? 'bg-amber-200 text-amber-700' :
                            'bg-zinc-200 text-zinc-600'
                          }`}
                        >
                          {factor.name}: {factor.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Automatic Diagnosis */}
          {area.progresso > 0 && (
            <div className="mb-6">
              <h4 className="font-semibold text-zinc-700 flex items-center gap-2 mb-3">
                <Activity size={18} className="text-zinc-500" />
                Diagnóstico Automático
              </h4>

              <div className="bg-zinc-50 rounded-xl p-4">
                {/* Issues */}
                {diagnosis.issues.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-zinc-500 mb-2">Problemas identificados:</p>
                    <div className="flex flex-wrap gap-2">
                      {diagnosis.issues.map((issue, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium"
                        >
                          <AlertTriangle size={12} />
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation */}
                <div className="bg-white rounded-lg p-3 border border-zinc-200">
                  <p className="text-xs text-zinc-500 mb-1">Recomendação:</p>
                  <p className="text-sm text-zinc-700">{diagnosis.recommendation}</p>
                </div>

                {/* Suggested Actions */}
                <div className="mt-3">
                  <p className="text-xs text-zinc-500 mb-2">Ações sugeridas:</p>
                  <div className="flex flex-wrap gap-2">
                    {diagnosis.suggestedActions.map((action, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-zinc-50 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Total de SKUs</p>
              <p className="text-2xl font-bold text-zinc-800">{area.totalSku}</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">SKUs Contados</p>
              <p className="text-2xl font-bold text-zinc-800">{area.concluidos}</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Pendentes</p>
              <p className="text-2xl font-bold text-amber-600">{pending}</p>
            </div>
            <div className="bg-zinc-50 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Divergências</p>
              <p className={`text-2xl font-bold ${area.divergencias > 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                {area.divergencias}
              </p>
            </div>
          </div>

          {/* Progress & Accuracy */}
          <div className="bg-zinc-50 rounded-xl p-4 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-500">Progresso</span>
                  <span className="font-bold text-zinc-800">{area.progresso.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(area.progresso, 100)}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-zinc-500">Acuracidade</span>
                  <span className={`font-bold ${textClass}`}>{area.acuracidade.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      area.acuracidade >= 90 ? 'bg-emerald-500' :
                      area.acuracidade >= 70 ? 'bg-amber-500' :
                      area.acuracidade >= 50 ? 'bg-orange-500' : 'bg-red-500'
                    } transition-all`}
                    style={{ width: `${Math.min(area.acuracidade, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Physical Locations */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-zinc-700 flex items-center gap-2">
                <MapPinned size={18} className="text-zinc-500" />
                Locais Físicos
              </h4>
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
              >
                {!isAdmin && <Lock size={12} />}
                {editMode ? 'Cancelar' : 'Editar'}
              </button>
            </div>

            {editMode ? (
              <div className="space-y-3">
                {locaisEditados.map((local, index) => (
                  <div key={local.id} className="bg-zinc-50 rounded-lg p-3">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Nome do local (ex: Rua A)"
                        value={local.nome}
                        onChange={(e) => handleLocalChange(index, 'nome', e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => handleRemoveLocal(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Descrição (ex: Corredor principal, vão 3)"
                      value={local.descricao}
                      onChange={(e) => handleLocalChange(index, 'descricao', e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
                <button
                  onClick={handleAddLocal}
                  disabled={locaisEditados.length >= 3}
                  className="w-full py-2 border-2 border-dashed border-zinc-300 rounded-lg text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-600 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={16} />
                  Adicionar local ({locaisEditados.length}/3)
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {area.locaisFisicos.length > 0 ? (
                  area.locaisFisicos.map((local) => (
                    <div
                      key={local.id}
                      className="bg-zinc-50 rounded-lg p-3 flex items-center gap-3"
                    >
                      <MapPin size={16} className="text-zinc-400" />
                      <div>
                        <p className="font-medium text-zinc-800">{local.nome}</p>
                        {local.descricao && (
                          <p className="text-sm text-zinc-500">{local.descricao}</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500 italic">
                    Nenhum local físico cadastrado. Clique em Editar para adicionar.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Divergent Products */}
          {area.produtosDivergentes.length > 0 && (
            <div className="mb-6">
              <h4 className="font-semibold text-zinc-700 mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" />
                Produtos Divergentes
              </h4>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="flex flex-wrap gap-2">
                  {area.produtosDivergentes.map((sku, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-red-100 text-red-700 text-xs font-mono rounded"
                    >
                      {sku}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Additional Info */}
          <div className="bg-zinc-50 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-zinc-500 mb-1 flex items-center gap-1">
                  <User size={14} />
                  Responsável
                </p>
                <p className="font-medium text-zinc-800">{area.responsavel || 'Não definido'}</p>
              </div>
              <div>
                <p className="text-zinc-500 mb-1 flex items-center gap-1">
                  <Clock size={14} />
                  Última atualização
                </p>
                <p className="font-medium text-zinc-800">{formatDateTime(area.ultimaAtualizacao)}</p>
              </div>
            </div>
            {area.observacoes && (
              <div className="mt-4 pt-4 border-t border-zinc-200">
                <p className="text-zinc-500 mb-1">Observações</p>
                <p className="text-sm text-zinc-700">{area.observacoes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-zinc-200 p-4 bg-zinc-50">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => onToggleRecontagem(area.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${
                area.marcadoRecontagem
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-white border-2 border-blue-300 text-blue-700 hover:bg-blue-50'
              }`}
            >
              <RefreshCcw size={18} />
              {area.marcadoRecontagem ? 'Remover da Fila' : 'Marcar para Recontagem'}
            </button>
            <button
              onClick={() => onExportReport(area)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition"
            >
              <FileDown size={18} />
              Exportar Relatório
            </button>
          </div>
        </div>

        {/* Edit Footer */}
        {editMode && (
          <div className="border-t border-zinc-200 p-4 bg-zinc-100 flex justify-between">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-zinc-600 hover:bg-zinc-200 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              Salvar alterações
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
