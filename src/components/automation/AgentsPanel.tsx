import { useEffect, useMemo, useState } from 'react';
import { Bot, Copy, Loader2, MoreVertical, Pause, Play, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Modal, Panel, PanelSection, Select } from '../ui';
import {
  createAutomation,
  deleteAutomation,
  duplicateAutomation,
  listExecutions,
  setAutomationStatus,
} from '../../lib/automation/automationService';
import { computeExecutionMetrics } from '../../lib/automation/executionMetrics';
import { validateWorkflow } from '../../lib/automation/workflow';
import {
  AGENT_BLUEPRINTS,
  AGENT_STATUS_LABEL,
  agentStatus,
  buildAgentWorkflow,
  findAgentAutomation,
  templateForBlueprint,
  type AgentBlueprint,
  type AgentStatus,
} from '../../lib/automation/agents';
import type { Automation, AutomationExecution } from '../../lib/automation/types';
import { AgentDetailPanel } from './AgentDetailPanel';

interface Props {
  automations: Automation[];
  canManage: boolean;
  onChanged: () => void;
  onOpenWorkflow: (automation: Automation) => void;
}

const STATUS_BADGE: Record<AgentStatus, 'success' | 'neutral' | 'danger'> = {
  active: 'success',
  inactive: 'neutral',
  attention: 'danger',
};

/** Central de Agentes — cada agente nativo é um AUTOMATION_TEMPLATES já
 *  existente, reapresentado com nome/objetivo/escopo de negócio (agents.ts).
 *  Nenhuma tabela nova, nenhum executor novo: criar/ativar/desativar/excluir
 *  usa exatamente os mesmos serviços que a aba Automações já usa. */
export function AgentsPanel({ automations, canManage, onChanged, onOpenWorkflow }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AgentStatus>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState<AgentBlueprint | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [executionsByAutomation, setExecutionsByAutomation] = useState<Record<string, AutomationExecution[]>>({});

  const installed = useMemo(
    () => AGENT_BLUEPRINTS.map(blueprint => ({ blueprint, automation: findAgentAutomation(blueprint, automations) })),
    [automations]
  );

  useEffect(() => {
    const ids = installed.map(i => i.automation?.id).filter((id): id is string => id != null);
    Promise.all(ids.map(id => listExecutions({ automationId: id, limit: 30 }).catch(() => [] as AutomationExecution[])))
      .then(results => {
        const map: Record<string, AutomationExecution[]> = {};
        ids.forEach((id, index) => { map[id] = results[index]; });
        setExecutionsByAutomation(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automations]);

  const filtered = installed.filter(({ blueprint, automation }) => {
    const query = search.trim().toLowerCase();
    if (query !== '' && !blueprint.name.toLowerCase().includes(query)) return false;
    if (statusFilter !== 'all') {
      if (automation == null) return false;
      if (agentStatus(automation) !== statusFilter) return false;
    }
    return true;
  });

  const selected = installed.find(i => i.blueprint.key === selectedKey && i.automation != null) ?? null;

  async function toggleActive(automation: Automation) {
    setBusyKey(automation.id);
    try {
      await setAutomationStatus(automation.id, automation.status === 'active' ? 'inactive' : 'active');
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(automation: Automation) {
    if (!window.confirm(`Excluir "${automation.name}"? O histórico de execuções também será apagado.`)) return;
    setBusyKey(automation.id);
    try {
      await deleteAutomation(automation.id);
      if (selectedKey && installed.find(i => i.automation?.id === automation.id)?.blueprint.key === selectedKey) setSelectedKey(null);
      onChanged();
    } finally {
      setBusyKey(null);
      setOpenMenuKey(null);
    }
  }

  async function duplicate(automation: Automation) {
    setBusyKey(automation.id);
    try {
      await duplicateAutomation(automation.id);
      onChanged();
    } finally {
      setBusyKey(null);
      setOpenMenuKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection>
          <h3 className="text-section">Central de Agentes</h3>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            Um agente monitora um evento, avalia uma condição e executa uma ação — a mesma automação de
            sempre, só apresentada do jeito que a operação pensa nela.
          </p>
        </PanelSection>

        <PanelSection className="flex flex-wrap items-center gap-2">
          <Input icon={<Search size={14} />} placeholder="Buscar agente…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-[180px] flex-1" />
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | AgentStatus)} className="w-auto">
            <option value="all">Status: Todos</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="attention">Atenção</option>
          </Select>
          {canManage && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={AGENT_BLUEPRINTS.every(b => findAgentAutomation(b, automations) != null)}
              onClick={() => setCreating(AGENT_BLUEPRINTS.find(b => findAgentAutomation(b, automations) == null) ?? null)}
            >
              <Plus size={14} />
              Novo agente
            </Button>
          )}
        </PanelSection>

        <PanelSection className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.length === 0 && (
            <p className="col-span-full text-sm text-fg-muted">Nenhum agente encontrado para esses filtros.</p>
          )}
          {filtered.map(({ blueprint, automation }) => {
            const executions = automation ? executionsByAutomation[automation.id] ?? [] : [];
            const metrics = computeExecutionMetrics(executions);
            const status = automation ? agentStatus(automation) : null;

            return (
              <div key={blueprint.key} className="relative rounded-container border border-edge bg-surface-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Bot size={16} className="mt-0.5 flex-shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-fg">{blueprint.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{blueprint.objective}</p>
                    </div>
                  </div>
                  {status && <Badge variant={STATUS_BADGE[status]}>{AGENT_STATUS_LABEL[status]}</Badge>}
                </div>

                {automation ? (
                  <>
                    <div className="mt-3 flex items-center gap-4 text-xs text-fg-subtle">
                      <span>Execuções recentes: <span className="tabular-nums text-fg">{executions.length}</span></span>
                      <span>Taxa de sucesso: <span className="tabular-nums text-fg">{metrics.successRate == null ? '—' : `${metrics.successRate}%`}</span></span>
                    </div>
                    <p className="mt-1 text-xs text-fg-subtle">
                      Última atividade: {automation.lastExecutedAt == null ? '—' : new Date(automation.lastExecutedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>

                    <div className="mt-3 flex items-center gap-1">
                      <Button variant="secondary" size="sm" onClick={() => setSelectedKey(blueprint.key)}>Abrir</Button>
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyKey === automation.id}
                            title={automation.status !== 'active' && !validateWorkflow(automation.workflow).valid ? 'Corrija a configuração antes de ativar' : undefined}
                            onClick={() => void toggleActive(automation)}
                          >
                            {busyKey === automation.id ? <Loader2 size={13} className="animate-spin" /> : automation.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                          </Button>
                          <div className="relative">
                            <Button variant="ghost" size="sm" onClick={() => setOpenMenuKey(k => (k === blueprint.key ? null : blueprint.key))} aria-label="Mais ações">
                              <MoreVertical size={13} />
                            </Button>
                            {openMenuKey === blueprint.key && (
                              <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-container border border-edge bg-surface-2 py-1 shadow-panel">
                                <button type="button" onClick={() => void duplicate(automation)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-muted hover:bg-surface-3">
                                  <Copy size={12} /> Duplicar
                                </button>
                                <button type="button" onClick={() => void remove(automation)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-surface-3 dark:text-red-400">
                                  <Trash2 size={12} /> Excluir
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  canManage && (
                    <div className="mt-3">
                      <Button variant="secondary" size="sm" onClick={() => setCreating(blueprint)}>
                        <Plus size={13} />
                        Criar agente
                      </Button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </PanelSection>
      </Panel>

      {selected?.automation && (
        <AgentDetailPanel
          key={selected.automation.id}
          blueprint={selected.blueprint}
          automation={selected.automation}
          canManage={canManage}
          onChanged={onChanged}
          onOpenWorkflow={onOpenWorkflow}
        />
      )}

      <NewAgentModal
        blueprint={creating}
        onClose={() => setCreating(null)}
        onCreated={() => { setCreating(null); onChanged(); }}
      />
    </div>
  );
}

function NewAgentModal({ blueprint, onClose, onCreated }: { blueprint: AgentBlueprint | null; onClose: () => void; onCreated: () => void }) {
  const template = blueprint ? templateForBlueprint(blueprint) : null;
  const [threshold, setThreshold] = useState(template?.defaultThreshold ?? 10);
  const [activateNow, setActivateNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => { setThreshold(template?.defaultThreshold ?? 10); setFailure(null); }, [template]);

  if (blueprint == null || template == null) return null;

  // TS não estreita `blueprint`/`template` dentro de uma function declaration
  // aninhada mesmo depois do guard acima — capturado em const para o closure.
  const activeBlueprint = blueprint;
  const activeTemplate = template;

  async function create() {
    setSaving(true);
    setFailure(null);
    try {
      const workflow = buildAgentWorkflow(activeBlueprint, activeTemplate.defaultThreshold != null ? threshold : undefined);
      const created = await createAutomation({ name: activeBlueprint.name, description: activeBlueprint.objective, workflow });
      if (activateNow) await setAutomationStatus(created.id, 'active');
      onCreated();
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível criar o agente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={blueprint != null} onClose={onClose} title={`Criar ${blueprint.name}`}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-fg-muted">{blueprint.objective}</p>
          <p className="mt-1 text-xs text-fg-subtle">{blueprint.scope}</p>
        </div>

        {template.defaultThreshold != null && (
          <label className="block">
            <span className="text-overline">{template.thresholdLabel ?? 'Limite'}</span>
            <Input className="mt-2 w-32" type="number" min={0.1} step={0.1} value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={activateNow} onChange={e => setActivateNow(e.target.checked)} className="h-4 w-4 rounded border-edge" />
          Ativar imediatamente após criar
        </label>

        {failure && <p className="text-sm text-red-600 dark:text-red-400">{failure}</p>}

        <div className="flex items-center gap-2">
          <Button disabled={saving} onClick={() => void create()}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Criar agente
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Modal>
  );
}
