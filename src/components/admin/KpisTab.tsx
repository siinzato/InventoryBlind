// Aba "KPIs e Indicadores" — cockpit compacto: resumo operacional, grade de até 6 cards,
// um gráfico de evolução e até 3 alertas. Toda a classificação (saudável/atenção/crítico) vem
// de src/lib/adminKpis/kpiHealth.ts (regras puras, sem IA). Criação/exclusão de KPI (custom_kpis)
// preserva exatamente o fluxo e o contrato que já existiam em AdminDashboardPage.tsx.

import { useMemo, useState } from 'react';
import { Target, Plus, Trash2, AlertTriangle, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Select, Modal, Stat, StatRow, StatCell } from '../ui';
import type { CustomKPI, InventorySnapshot } from '../../lib/supabase';
import {
  computeAccuracyTrend, classifyAccuracyByTarget, isKpiStale, computeOperationalSummary, buildPriorityAlerts,
  ACCURACY_TARGET_PCT, ACCURACY_WARNING_FLOOR_PCT, ACCURACY_HISTORY_LIMIT,
  type AccuracyPoint, type HealthStatus, type OperationalAlert,
} from '../../lib/adminKpis/kpiHealth';

interface KpisTabProps {
  customKPIs: CustomKPI[];
  onAddKPI: (kpi: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>) => Promise<void>;
  onDeleteKPI: (id: string) => Promise<void>;
  snapshots: InventorySnapshot[];
  onNavigateToInventories: () => void;
}

const MAX_GRID_CARDS = 6;

const STATUS_META: Record<HealthStatus, { label: string; badge: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  saudavel: { label: 'Saudável', badge: 'success' },
  atencao: { label: 'Atenção', badge: 'warning' },
  critico: { label: 'Crítica', badge: 'danger' },
  insuficiente: { label: 'Dados insuficientes', badge: 'neutral' },
};

const SEVERITY_META: Record<OperationalAlert['severity'], { icon: typeof AlertTriangle; badge: 'danger' | 'warning' | 'neutral' }> = {
  critico: { icon: AlertTriangle, badge: 'danger' },
  atencao: { icon: AlertTriangle, badge: 'warning' },
  info: { icon: Info, badge: 'neutral' },
};

const VALUE_TONE: Record<HealthStatus, 'default' | 'positive' | 'warning' | 'critical'> = {
  saudavel: 'positive', atencao: 'warning', critico: 'critical', insuficiente: 'default',
};

function AccuracySparkbars({ points, targetPct }: { points: AccuracyPoint[]; targetPct: number }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-fg-subtle text-center py-8">
        Histórico insuficiente para exibir a evolução — são necessários pelo menos 2 inventários fechados.
      </p>
    );
  }
  const shown = points.slice(-ACCURACY_HISTORY_LIMIT);
  return (
    <div>
      <div className="relative h-32">
        <div
          className="absolute left-0 right-0 border-t border-dashed border-accent/60"
          style={{ bottom: `${Math.min(100, targetPct)}%` }}
          title={`Meta: ${targetPct}%`}
        />
        <div className="flex items-end gap-1.5 h-full">
          {shown.map(p => (
            <div key={p.date} className="flex flex-col items-center gap-1 flex-1 min-w-0 h-full justify-end">
              <div
                className={`w-full rounded-t ${p.accuracy >= targetPct ? 'bg-emerald-500/70' : p.accuracy >= ACCURACY_WARNING_FLOOR_PCT ? 'bg-amber-500/70' : 'bg-red-500/70'}`}
                style={{ height: `${Math.max(0, Math.min(100, p.accuracy))}%`, minHeight: 2 }}
                title={`${new Date(p.date).toLocaleDateString('pt-BR')}: ${p.accuracy.toFixed(1)}%`}
              />
              <p className="text-[10px] text-fg-subtle truncate w-full text-center">
                {new Date(p.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
              </p>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-fg-subtle mt-2">Linha tracejada = meta de {targetPct}%.</p>
    </div>
  );
}

export function KpisTab({ customKPIs, onAddKPI, onDeleteKPI, snapshots, onNavigateToInventories }: KpisTabProps) {
  const [showAddKPIModal, setShowAddKPIModal] = useState(false);
  const [newKPI, setNewKPI] = useState<Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>>({
    titulo: '', valor: '', unidade: '', variacao: '', tipo_variacao: 'up', cor_icone: 'blue',
  });
  const [expandedExtras, setExpandedExtras] = useState(false);
  const [selectedChartKey, setSelectedChartKey] = useState('acuracidade');

  const referenceDate = useMemo(() => new Date(), []);

  const completedSnapshots = useMemo(
    () => [...snapshots].filter(s => s.status === 'completed').sort((a, b) => a.end_date.localeCompare(b.end_date)),
    [snapshots]
  );
  const latestSnapshot = completedSnapshots[completedSnapshots.length - 1] ?? null;
  const accuracyPoints: AccuracyPoint[] = useMemo(
    () => completedSnapshots.map(s => ({ date: s.end_date, accuracy: s.accuracy })),
    [completedSnapshots]
  );
  const accuracyTrend = useMemo(() => computeAccuracyTrend(accuracyPoints), [accuracyPoints]);
  const accuracyStatus = classifyAccuracyByTarget(latestSnapshot?.accuracy ?? null);

  const staleKpis = useMemo(() => customKPIs.filter(k => isKpiStale(k.updated_at, referenceDate)), [customKPIs, referenceDate]);
  const staleKpiNames = staleKpis.map(k => k.titulo);

  const summary = useMemo(
    () => computeOperationalSummary({ customKpiCount: customKPIs.length, accuracyStatus, staleKpiNames }),
    [customKPIs.length, accuracyStatus, staleKpiNames]
  );
  const alerts = useMemo(
    () => buildPriorityAlerts({ accuracyStatus, accuracyTrend, staleKpiNames, semMetaCount: customKPIs.length }),
    [accuracyStatus, accuracyTrend, staleKpiNames, customKPIs.length]
  );

  const lastUpdatedIso = useMemo(() => {
    const timestamps = customKPIs.map(k => k.updated_at);
    if (latestSnapshot) timestamps.push(latestSnapshot.updated_at);
    return timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;
  }, [customKPIs, latestSnapshot]);

  const gridCustomKpis = customKPIs.slice(0, MAX_GRID_CARDS - 1);
  const extraCustomKpis = customKPIs.slice(MAX_GRID_CARDS - 1);

  const handleAddKPISubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKPI.titulo || !newKPI.valor) return;
    await onAddKPI(newKPI);
    setNewKPI({ titulo: '', valor: '', unidade: '', variacao: '', tipo_variacao: 'up', cor_icone: 'blue' });
    setShowAddKPIModal(false);
  };

  const handleAlertAction = (alert: OperationalAlert) => {
    if (alert.actionKey === 'open-inventories') onNavigateToInventories();
    if (alert.actionKey === 'manage-kpis') setShowAddKPIModal(true);
  };

  const chartOptions = [{ value: 'acuracidade', label: 'Acuracidade' }, ...customKPIs.map(k => ({ value: k.id, label: k.titulo }))];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-title flex items-center gap-2"><Target size={16} className="text-fg-subtle" /> KPIs e Indicadores</h3>
            <p className="text-caption mt-0.5">Acompanhamento operacional dos indicadores da empresa.</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            {latestSnapshot && (
              <p className="text-xs text-fg-subtle">Período analisado: {new Date(latestSnapshot.start_date).toLocaleDateString('pt-BR')} a {new Date(latestSnapshot.end_date).toLocaleDateString('pt-BR')}</p>
            )}
            {lastUpdatedIso && <p className="text-xs text-fg-subtle">Atualizado em {new Date(lastUpdatedIso).toLocaleDateString('pt-BR')}</p>}
            <Button size="sm" onClick={() => setShowAddKPIModal(true)}><Plus size={14} /> Adicionar KPI</Button>
          </div>
        </PanelSection>

        <PanelSection padding="sm" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-edge/60">
          <Badge variant={STATUS_META[summary.status].badge}>{STATUS_META[summary.status].label}</Badge>
          <span className="text-xs text-fg-muted">{summary.criticos} crítico(s)</span>
          <span className="text-xs text-fg-muted">{summary.emAtencao} em atenção</span>
          <span className="text-xs text-fg-muted">{summary.semMeta} sem meta configurada</span>
          {summary.destaque && (
            <span className="text-xs text-fg-muted">Atenção primeiro: <strong className="text-fg">{summary.destaque}</strong></span>
          )}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection>
          <StatRow className="sm:grid-cols-2 lg:grid-cols-3">
            <StatCell>
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge variant={STATUS_META[accuracyStatus].badge}>{STATUS_META[accuracyStatus].label}</Badge>
              </div>
              <Stat
                label="Acuracidade"
                value={latestSnapshot ? `${latestSnapshot.accuracy.toFixed(1)}%` : '—'}
                context={`Meta: ${ACCURACY_TARGET_PCT}%`}
                valueTone={VALUE_TONE[accuracyStatus]}
                trend={
                  accuracyTrend.deltaPoints !== null
                    ? { value: `${accuracyTrend.deltaPoints >= 0 ? '+' : ''}${accuracyTrend.deltaPoints.toFixed(1)} p.p.`, direction: accuracyTrend.deltaPoints > 0 ? 'up' : accuracyTrend.deltaPoints < 0 ? 'down' : 'flat', intent: accuracyTrend.deltaPoints > 0 ? 'positive' : accuracyTrend.deltaPoints < 0 ? 'negative' : 'neutral' }
                    : undefined
                }
              />
            </StatCell>

            {gridCustomKpis.map(kpi => (
              <StatCell key={kpi.id}>
                <div className="group">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge variant="neutral">Sem meta</Badge>
                    <button
                      onClick={() => onDeleteKPI(kpi.id)}
                      aria-label={`Excluir KPI ${kpi.titulo}`}
                      className="text-fg-subtle hover:text-red-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Stat
                    label={kpi.titulo}
                    value={`${kpi.valor}${kpi.unidade ? ` ${kpi.unidade}` : ''}`}
                    context="Meta: —"
                    trend={kpi.variacao ? { value: kpi.variacao, direction: kpi.tipo_variacao === 'neutral' ? 'flat' : kpi.tipo_variacao, intent: 'neutral' } : undefined}
                  />
                </div>
              </StatCell>
            ))}
          </StatRow>
        </PanelSection>
      </Panel>

      {extraCustomKpis.length > 0 && (
        <Panel>
          <PanelSection padding="sm">
            <button
              type="button"
              onClick={() => setExpandedExtras(v => !v)}
              className="flex items-center gap-2 text-sm font-medium text-fg"
              aria-expanded={expandedExtras}
            >
              {expandedExtras ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              Mais {extraCustomKpis.length} indicador(es)
            </button>
          </PanelSection>
          {expandedExtras && (
            <PanelSection className="divide-y divide-edge">
              {extraCustomKpis.map(kpi => (
                <div key={kpi.id} className="flex items-center justify-between gap-3 py-3 group">
                  <div className="min-w-0">
                    <p className="text-caption uppercase">{kpi.titulo}</p>
                    <p className="text-lg font-semibold text-fg mt-1">{kpi.valor} <span className="text-sm font-normal text-fg-muted">{kpi.unidade}</span></p>
                    <p className="text-caption mt-1 truncate">{kpi.variacao}</p>
                  </div>
                  <button
                    onClick={() => onDeleteKPI(kpi.id)}
                    aria-label={`Excluir KPI ${kpi.titulo}`}
                    className="text-fg-subtle hover:text-red-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </PanelSection>
          )}
        </Panel>
      )}

      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-title">Evolução do indicador</h3>
          <Select value={selectedChartKey} onChange={e => setSelectedChartKey(e.target.value)} className="max-w-xs">
            {chartOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </PanelSection>
        <PanelSection>
          {selectedChartKey === 'acuracidade' ? (
            <AccuracySparkbars points={accuracyPoints} targetPct={ACCURACY_TARGET_PCT} />
          ) : (
            <p className="text-sm text-fg-subtle text-center py-8">
              Este indicador ainda não tem histórico registrado — apenas o valor atual está disponível.
            </p>
          )}
        </PanelSection>
      </Panel>

      {alerts.length > 0 && (
        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title">Alertas prioritários</h3>
          </PanelSection>
          <PanelSection className="space-y-3">
            {alerts.map(alert => {
              const meta = SEVERITY_META[alert.severity];
              const Icon = meta.icon;
              return (
                <div key={alert.id} className="flex items-start gap-3">
                  <Icon size={16} className="flex-shrink-0 mt-0.5 text-fg-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={meta.badge}>{alert.severity === 'critico' ? 'Crítico' : alert.severity === 'atencao' ? 'Atenção' : 'Info'}</Badge>
                      <p className="text-sm text-fg">{alert.description}</p>
                    </div>
                    <p className="text-xs text-fg-subtle mt-1">{alert.evidence}</p>
                  </div>
                  {alert.actionKey && (
                    <Button variant="ghost" size="sm" onClick={() => handleAlertAction(alert)}>{alert.actionLabel}</Button>
                  )}
                </div>
              );
            })}
          </PanelSection>
        </Panel>
      )}

      {showAddKPIModal && (
        <KpiFormModal
          value={newKPI}
          onChange={setNewKPI}
          onSubmit={handleAddKPISubmit}
          onClose={() => setShowAddKPIModal(false)}
        />
      )}
    </div>
  );
}

interface KpiFormModalProps {
  value: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>;
  onChange: (kpi: Omit<CustomKPI, 'id' | 'order_index' | 'created_at' | 'updated_at'>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

function KpiFormModal({ value, onChange, onSubmit, onClose }: KpiFormModalProps) {
  return (
    <Modal open onClose={onClose} title="Novo KPI / Indicador" maxWidth="max-w-md">
      <div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="kpi-titulo" className="block text-sm font-medium text-fg mb-1">Título do KPI</label>
            <input
              id="kpi-titulo" type="text" required value={value.titulo}
              onChange={e => onChange({ ...value, titulo: e.target.value })}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: Taxa de Aprovação"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="kpi-valor" className="block text-sm font-medium text-fg mb-1">Valor</label>
              <input
                id="kpi-valor" type="text" required value={value.valor}
                onChange={e => onChange({ ...value, valor: e.target.value })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: 95.5"
              />
            </div>
            <div>
              <label htmlFor="kpi-unidade" className="block text-sm font-medium text-fg mb-1">Unidade</label>
              <input
                id="kpi-unidade" type="text" value={value.unidade}
                onChange={e => onChange({ ...value, unidade: e.target.value })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
                placeholder="Ex: %"
              />
            </div>
          </div>
          <div>
            <label htmlFor="kpi-variacao" className="block text-sm font-medium text-fg mb-1">Variação / Descrição</label>
            <input
              id="kpi-variacao" type="text" value={value.variacao}
              onChange={e => onChange({ ...value, variacao: e.target.value })}
              className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              placeholder="Ex: +5% vs mês anterior"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="kpi-tipo" className="block text-sm font-medium text-fg mb-1">Tipo de Variação</label>
              <select
                id="kpi-tipo" value={value.tipo_variacao}
                onChange={e => onChange({ ...value, tipo_variacao: e.target.value as 'up' | 'down' | 'neutral' })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="up">Subiu (↑)</option>
                <option value="down">Caiu (↓)</option>
                <option value="neutral">Neutro</option>
              </select>
            </div>
            <div>
              <label htmlFor="kpi-cor" className="block text-sm font-medium text-fg mb-1">Cor do Ícone</label>
              <select
                id="kpi-cor" value={value.cor_icone}
                onChange={e => onChange({ ...value, cor_icone: e.target.value as 'blue' | 'red' | 'amber' | 'emerald' })}
                className="w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 bg-surface text-fg"
              >
                <option value="blue">Azul</option>
                <option value="red">Vermelho</option>
                <option value="amber">Âmbar</option>
                <option value="emerald">Verde</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit"><Plus size={18} /> Cadastrar KPI</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
