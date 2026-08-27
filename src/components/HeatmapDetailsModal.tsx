// Heatmap Details Modal Component

import React, { useState, useMemo } from 'react';
import {
  MapPin,
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
  generateDiagnosis,
} from '../lib/heatmapUtils';
import { Modal, Panel, PanelSection, Badge } from './ui';

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
    <Modal open={isOpen} onClose={onClose} title={area.nome} maxWidth="max-w-lg">
      {/* Identification: brand + type + recount state — was the full-bleed criticality header band */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Tag size={14} className="text-fg-subtle" />
          <span className="text-sm text-fg-subtle">{area.marcaNome}</span>
          <Badge variant="neutral">{area.tipo.toUpperCase()}</Badge>
        </div>
        {area.marcadoRecontagem && (
          <Badge variant="accent">
            <RefreshCcw size={12} />
            Recontagem
          </Badge>
        )}
      </div>

      {/* Risk Score Section — o rótulo de risco (badge) já comunica gravidade;
          não precisa também de um card cheio de cor + número gigante + badge
          pulsante repetindo o mesmo sinal (§3/§17). "Marcado para recontagem"
          já aparece no cabeçalho acima, então não se repete aqui. */}
      {area.progresso > 0 && (
        <Panel className="mb-6">
          <PanelSection>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-section flex items-center gap-2">
                <AlertOctagon size={14} className="text-fg-subtle" />
                Score de risco
              </h4>
              <Badge variant={
                riskLevel === 'critical' ? 'danger'
                : riskLevel === 'high' ? 'warning'
                : riskLevel === 'medium' ? 'accent'
                : riskLevel === 'low' ? 'success'
                : 'neutral'
              }>
                {riskLabel}
              </Badge>
            </div>

            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-display">{riskScore}</span>
              <span className="text-caption">de 0 a 100</span>
            </div>

            {/* Risk Factors */}
                {diagnosis.factors.length > 0 && (
                  <div className="border-t border-edge/60 pt-3 mt-3">
                    <p className="text-caption mb-2">Fatores de risco:</p>
                    <div className="flex flex-wrap gap-2">
                      {diagnosis.factors.map((factor, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            factor.impact === 'alta' ? 'bg-red-500/15 text-red-700 dark:text-red-400' :
                            factor.impact === 'média' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                            'bg-edge text-fg-muted'
                          }`}
                        >
                          {factor.name}: {factor.value}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
          </PanelSection>
        </Panel>
      )}

      {/* Automatic Diagnosis */}
          {area.progresso > 0 && (
            <div className="mb-6">
              <h4 className="font-semibold text-fg-muted flex items-center gap-2 mb-3">
                <Activity size={18} className="text-fg-subtle" />
                Diagnóstico Automático
              </h4>

              <div className="bg-surface-3 rounded-xl p-4">
                {/* Issues */}
                {diagnosis.issues.length > 0 && (
                  <div className="mb-4">
                    <p className="text-caption mb-2">Problemas identificados:</p>
                    <div className="flex flex-wrap gap-2">
                      {diagnosis.issues.map((issue, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-700 dark:text-red-400 rounded text-xs font-medium"
                        >
                          <AlertTriangle size={12} />
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation */}
                <div className="bg-surface-2 rounded-lg p-3 border border-edge">
                  <p className="text-caption mb-1">Recomendação:</p>
                  <p className="text-sm text-fg-muted">{diagnosis.recommendation}</p>
                </div>

                {/* Suggested Actions */}
                <div className="mt-3">
                  <p className="text-caption mb-2">Ações sugeridas:</p>
                  <div className="flex flex-wrap gap-2">
                    {diagnosis.suggestedActions.map((action, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 bg-accent/10 text-accent rounded text-xs font-medium"
                      >
                        {action}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Overview: KPIs + Progress, one Panel instead of five stacked boxes */}
          <Panel className="mb-6">
            <PanelSection>
              <div className="grid grid-cols-2">
                {[
                  { label: 'Total de SKUs', value: area.totalSku },
                  { label: 'SKUs Contados', value: area.concluidos },
                  { label: 'Pendentes', value: pending, valueClassName: 'text-amber-700 dark:text-amber-400' },
                  {
                    label: 'Divergências',
                    value: area.divergencias,
                    valueClassName: area.divergencias > 0 ? 'text-red-700 dark:text-red-400' : 'text-fg-subtle',
                  },
                ].map((kpi, i) => (
                  <div
                    key={kpi.label}
                    className={`${i % 2 === 1 ? 'pl-4 border-l border-edge' : 'pr-4'} ${i >= 2 ? 'pt-3 border-t border-edge' : 'pb-3'}`}
                  >
                    <p className="text-caption">{kpi.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${kpi.valueClassName ?? 'text-fg'}`}>{kpi.value}</p>
                  </div>
                ))}
              </div>
            </PanelSection>

            <PanelSection>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-fg-subtle">Progresso</span>
                    <span className="font-bold text-fg">{area.progresso.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 bg-edge rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${Math.min(area.progresso, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-fg-subtle">Acuracidade</span>
                    <span className={`font-bold ${textClass}`}>{area.acuracidade.toFixed(1)}%</span>
                  </div>
                  <div className="h-3 bg-edge rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        area.acuracidade >= 90 ? 'bg-emerald-500' :
                        area.acuracidade >= 70 ? 'bg-amber-500' :
                        area.acuracidade >= 50 ? 'bg-accent' : 'bg-red-500'
                      } transition-all`}
                      style={{ width: `${Math.min(area.acuracidade, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </PanelSection>
          </Panel>

          {/* Physical Locations */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-fg-muted flex items-center gap-2">
                <MapPinned size={18} className="text-fg-subtle" />
                Locais Físicos
              </h4>
              <button
                onClick={handleStartEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 rounded-lg transition"
              >
                {!isAdmin && <Lock size={12} />}
                {editMode ? 'Cancelar' : 'Editar'}
              </button>
            </div>

            {editMode ? (
              <div className="space-y-3">
                {locaisEditados.map((local, index) => (
                  <div key={local.id} className="bg-surface-3 rounded-lg p-3">
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Nome do local (ex: Rua A)"
                        value={local.nome}
                        onChange={(e) => handleLocalChange(index, 'nome', e.target.value)}
                        className="flex-1 px-3 py-2 bg-surface-3 border border-edge rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-transparent"
                      />
                      <button
                        onClick={() => handleRemoveLocal(index)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Descrição (ex: Corredor principal, vão 3)"
                      value={local.descricao}
                      onChange={(e) => handleLocalChange(index, 'descricao', e.target.value)}
                      className="w-full px-3 py-2 bg-surface-3 border border-edge rounded-lg text-sm text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-transparent"
                    />
                  </div>
                ))}
                <button
                  onClick={handleAddLocal}
                  disabled={locaisEditados.length >= 3}
                  className="w-full py-2 border-2 border-dashed border-edge rounded-lg text-sm text-fg-subtle hover:border-fg-subtle hover:text-fg-muted transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      className="bg-surface-3 rounded-lg p-3 flex items-center gap-3"
                    >
                      <MapPin size={16} className="text-fg-subtle" />
                      <div>
                        <p className="font-medium text-fg">{local.nome}</p>
                        {local.descricao && (
                          <p className="text-sm text-fg-subtle">{local.descricao}</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-fg-subtle italic">
                    Nenhum local físico cadastrado. Clique em Editar para adicionar.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Divergent Products */}
          {area.produtosDivergentes.length > 0 && (
            <div className="mb-6">
              <h4 className="font-semibold text-fg-muted mb-3 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" />
                Produtos Divergentes
              </h4>
              <div className="bg-red-500/10 rounded-xl p-3">
                <div className="flex flex-wrap gap-2">
                  {area.produtosDivergentes.map((sku, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 bg-red-500/10 text-red-700 dark:text-red-400 text-xs font-mono rounded"
                    >
                      {sku}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Additional Info */}
          <div className="bg-surface-3 rounded-xl p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-fg-subtle mb-1 flex items-center gap-1">
                  <User size={14} />
                  Responsável
                </p>
                <p className="font-medium text-fg">{area.responsavel || 'Não definido'}</p>
              </div>
              <div>
                <p className="text-fg-subtle mb-1 flex items-center gap-1">
                  <Clock size={14} />
                  Última atualização
                </p>
                <p className="font-medium text-fg">{formatDateTime(area.ultimaAtualizacao)}</p>
              </div>
            </div>
            {area.observacoes && (
              <div className="mt-4 pt-4 border-t border-edge">
                <p className="text-fg-subtle mb-1">Observações</p>
                <p className="text-sm text-fg-muted">{area.observacoes}</p>
              </div>
            )}
          </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-edge">
        <button
          onClick={() => onToggleRecontagem(area.id)}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition ${
            area.marcadoRecontagem
              ? 'bg-accent text-white hover:bg-accent-strong'
              : 'bg-surface-2 border-2 border-accent/40 text-accent hover:bg-accent/10'
          }`}
        >
          <RefreshCcw size={18} />
          {area.marcadoRecontagem ? 'Remover da Fila' : 'Marcar para Recontagem'}
        </button>
        <button
          onClick={() => onExportReport(area)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-3 text-fg rounded-lg font-medium hover:bg-edge transition"
        >
          <FileDown size={18} />
          Exportar Relatório
        </button>
      </div>

      {/* Edit Footer */}
      {editMode && (
        <div className="flex justify-between mt-4 pt-4 border-t border-edge">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-fg-muted hover:bg-edge rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={18} />
            Salvar alterações
          </button>
        </div>
      )}
    </Modal>
  );
};
