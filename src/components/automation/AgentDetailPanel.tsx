import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, Pause, Play, X } from 'lucide-react';
import { Badge, Button, Panel, PanelSection } from '../ui';
import { listExecutions, listNodeExecutions, setAutomationStatus, updateAutomation } from '../../lib/automation/automationService';
import { addNode, removeNode, updateNode } from '../../lib/automation/flowAdapter';
import { TRIGGERS, isKnownTrigger } from '../../lib/automation/registry';
import { validateWorkflow } from '../../lib/automation/workflow';
import { AGENT_STATUS_LABEL, agentStatus, type AgentBlueprint } from '../../lib/automation/agents';
import type { Automation, AutomationWorkflow, NodeExecution } from '../../lib/automation/types';
import { NodeConfigPanel } from './flow/NodeConfigPanel';
import { AgentLogicSummary } from './AgentLogicSummary';

interface Props {
  blueprint: AgentBlueprint;
  automation: Automation;
  canManage: boolean;
  onChanged: () => void;
  onOpenWorkflow: (automation: Automation) => void;
}

const STATUS_BADGE = {
  active: 'success',
  inactive: 'neutral',
  attention: 'danger',
} as const;

interface ActivityEntry {
  id: string;
  at: string;
  label: string;
  status: NodeExecution['status'];
  durationMs: number | null;
}

/** Vista de negócio de UM agente (§5/§6/§7/§8) — o mesmo NodeConfigPanel da
 *  Fase 1 (nenhum segundo componente de configuração), a mesma listagem de
 *  execuções da Fase 2 para a atividade recente, e "Abrir workflow" leva ao
 *  editor de canvas completo sem nenhuma mudança nele. */
export function AgentDetailPanel({ blueprint, automation, canManage, onChanged, onOpenWorkflow }: Props) {
  const [workflow, setWorkflow] = useState<AutomationWorkflow>(automation.workflow);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => { setWorkflow(automation.workflow); setSelectedNodeId(null); }, [automation.id, automation.workflow]);

  useEffect(() => {
    setLoadingActivity(true);
    listExecutions({ automationId: automation.id, limit: 3 })
      .then(async executions => {
        const steps = await Promise.all(executions.map(e => listNodeExecutions(e.id).catch(() => [] as NodeExecution[])));
        const flat = steps.flat().filter(s => s.status !== 'skipped');
        flat.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        setActivity(flat.slice(0, 8).map(s => ({
          id: s.id,
          at: s.startedAt,
          label: s.nodeLabel ?? s.nodeType,
          status: s.status,
          durationMs: s.durationMs,
        })));
      })
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false));
  }, [automation.id]);

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);
  const selectedNode = workflow.nodes.find(n => n.id === selectedNodeId) ?? null;
  const triggerNode = workflow.nodes.find(n => n.type === 'trigger');
  const triggerType = (triggerNode as { triggerType?: string } | undefined)?.triggerType ?? 'manual';
  const status = agentStatus(automation);

  async function persist(next: AutomationWorkflow) {
    setWorkflow(next);
    setSaving(true);
    setFeedback(null);
    try {
      await updateAutomation(automation.id, { name: automation.name, description: automation.description, workflow: next });
      setFeedback('Alteração salva.');
      onChanged();
    } catch (thrown) {
      setFeedback(thrown instanceof Error ? thrown.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  function changeTrigger(newTrigger: string) {
    const triggerId = workflow.nodes.find(n => n.type === 'trigger')?.id ?? 'trigger';
    void persist({
      nodes: [{ id: triggerId, type: 'trigger', triggerType: newTrigger, label: isKnownTrigger(newTrigger) ? TRIGGERS[newTrigger].label : newTrigger, config: {} }],
      edges: [],
    });
    setSelectedNodeId(triggerId);
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await setAutomationStatus(automation.id, automation.status === 'active' ? 'inactive' : 'active');
      onChanged();
    } catch (thrown) {
      setFeedback(thrown instanceof Error ? thrown.message : 'Não foi possível alterar a situação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelSection className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-section">{blueprint.name}</h3>
            <Badge variant={STATUS_BADGE[status]}>{AGENT_STATUS_LABEL[status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-fg-muted">{blueprint.objective}</p>
          <p className="mt-1 text-xs text-fg-subtle">{blueprint.scope}</p>
        </div>

        {canManage && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || (automation.status !== 'active' && !validation.valid)}
              title={automation.status !== 'active' && !validation.valid ? 'Corrija a configuração antes de ativar' : undefined}
              onClick={() => void toggleActive()}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : automation.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
              {automation.status === 'active' ? 'Desativar' : 'Ativar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenWorkflow(automation)}>
              <ExternalLink size={13} />
              Abrir workflow
            </Button>
          </div>
        )}
      </PanelSection>

      {!validation.valid && (
        <PanelSection className="text-sm text-red-600 dark:text-red-400">
          {validation.problems.find(p => p.severity === 'error')?.message}
        </PanelSection>
      )}

      <div className="flex flex-col lg:flex-row">
        <PanelSection className="flex-1">
          <p className="text-label mb-2">Lógica do agente</p>
          <AgentLogicSummary workflow={workflow} triggerType={triggerType} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
        </PanelSection>

        {selectedNode && (
          <div className="lg:w-80 lg:flex-shrink-0 lg:border-l lg:border-edge">
            <NodeConfigPanel
              node={selectedNode}
              triggerType={triggerType}
              canManage={canManage}
              problems={validation.problems.filter(p => p.nodeId === selectedNode.id)}
              onChangeTrigger={changeTrigger}
              onChange={patch => void persist(updateNode(workflow, selectedNode.id, patch))}
              onDuplicate={() => {
                if (selectedNode.type === 'trigger') return;
                const clone = { ...selectedNode, id: `${selectedNode.id}-copia-${Date.now().toString(36)}` };
                void persist(addNode(workflow, clone));
              }}
              onRemove={() => { void persist(removeNode(workflow, selectedNode.id)); setSelectedNodeId(null); }}
              onClose={() => setSelectedNodeId(null)}
            />
          </div>
        )}
      </div>

      {feedback && (
        <PanelSection className="flex items-center gap-2 text-xs text-fg-subtle">
          {saving && <Loader2 size={12} className="animate-spin" />}
          {feedback}
        </PanelSection>
      )}

      <PanelSection>
        <p className="text-label mb-2">Atividade recente</p>
        {loadingActivity ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} className="animate-spin" />Carregando…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhuma atividade registrada ainda.</p>
        ) : (
          <ol className="space-y-2">
            {activity.map(entry => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 w-12 flex-shrink-0 text-xs tabular-nums text-fg-subtle">
                  {new Date(entry.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {entry.status === 'success' ? <Check size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" /> : <X size={14} className="mt-0.5 flex-shrink-0 text-red-500" />}
                <span className="text-fg">{entry.label}</span>
              </li>
            ))}
          </ol>
        )}
      </PanelSection>
    </Panel>
  );
}
