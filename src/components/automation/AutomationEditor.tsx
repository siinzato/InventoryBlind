import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2, Play } from 'lucide-react';
import { Button, Input, Page, PageHeader, Panel, PanelSection } from '../ui';
import {
  createAutomation,
  listNodeExecutions,
  runAutomationManually,
  setAutomationStatus,
  updateAutomation,
} from '../../lib/automation/automationService';
import { edgeStatusesFromExecutions } from '../../lib/automation/flowAdapter';
import { useFlowHistory } from '../../lib/automation/useFlowHistory';
import { validateWorkflow } from '../../lib/automation/workflow';
import { AutomationCanvas } from './AutomationCanvas';
import type { Automation, AutomationWorkflow, NodeExecutionStatus } from '../../lib/automation/types';

interface Props {
  automation: Automation | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const BLANK_WORKFLOW: AutomationWorkflow = {
  nodes: [{ id: 'trigger', type: 'trigger', triggerType: 'count.item_counted', label: 'Item contado', config: {} }],
  edges: [],
};

/** Editor de workflow — canvas React Flow (§1–§29 do refinamento visual).
 *
 *  O que muda em relação à versão anterior é só a experiência de montar o
 *  fluxo: biblioteca de blocos, painel de configuração lateral, zoom/pan real,
 *  desfazer/refazer. O dado continua sendo nodes + edges com saídas nomeadas,
 *  salvo do mesmo jeito por `save()` abaixo — motor, validação e persistência
 *  não foram tocados. */
export function AutomationEditor({ automation, canManage, onClose, onSaved }: Props) {
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const history = useFlowHistory(automation?.workflow ?? BLANK_WORKFLOW);
  const workflow = history.workflow;

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [lastTestStatuses, setLastTestStatuses] = useState<Record<string, NodeExecutionStatus> | null>(null);
  const [lastTestEdgeStatuses, setLastTestEdgeStatuses] = useState<Record<string, NodeExecutionStatus> | null>(null);

  const triggerNode = workflow.nodes.find(n => n.type === 'trigger');
  const triggerType = (triggerNode as { triggerType?: string } | undefined)?.triggerType ?? 'manual';

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);

  async function save(): Promise<Automation | null> {
    setSaving(true);
    setFeedback(null);
    try {
      const input = { name, description, workflow };
      const saved = automation == null ? await createAutomation(input) : await updateAutomation(automation.id, input);
      setFeedback({ tone: 'ok', text: 'Automação salva como rascunho. Ative quando estiver pronta.' });
      return saved;
    } catch (thrown) {
      setFeedback({ tone: 'error', text: thrown instanceof Error ? thrown.message : 'Não foi possível salvar.' });
      return null;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Automações"
        title={automation == null ? 'Nova automação' : automation.name}
        description="Quando isso acontecer, avalie as condições e execute as ações."
        actions={
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft size={14} />
            Voltar
          </Button>
        }
      />

      {feedback && (
        <div
          className={`rounded-container border px-4 py-3 text-sm ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <Panel>
        <PanelSection className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-overline">Nome</span>
            <Input className="mt-2" value={name} disabled={!canManage} onChange={e => setName(e.target.value)} placeholder="Recontagem automática" />
          </label>
          <label className="block">
            <span className="text-overline">Descrição</span>
            <Input className="mt-2" value={description} disabled={!canManage} onChange={e => setDescription(e.target.value)} placeholder="O que esta automação resolve" />
          </label>
        </PanelSection>
      </Panel>

      {validation.problems.length > 0 && (
        <Panel>
          <PanelSection>
            <h3 className="text-section flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-500" />
              {validation.valid ? 'Avisos' : 'Corrija para poder ativar'}
            </h3>
            <ul className="mt-3 space-y-1.5">
              {validation.problems.map((problem, index) => (
                <li key={index}>
                  <button
                    type="button"
                    disabled={problem.nodeId == null}
                    onClick={() => problem.nodeId && setFocusNodeId(problem.nodeId)}
                    className={`text-left text-sm leading-relaxed transition-opacity ${
                      problem.nodeId ? 'hover:opacity-80' : 'cursor-default'
                    } ${problem.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}
                  >
                    {problem.message}
                  </button>
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>
      )}

      <Panel>
        <PanelSection>
          <h3 className="text-section">Fluxo</h3>
          <p className="mt-1 text-sm text-fg-muted">Clique em um bloco para configurá-lo, ou use os botões “+” das saídas.</p>
        </PanelSection>

        <PanelSection>
          <AutomationCanvas
            workflow={workflow}
            triggerType={triggerType}
            canManage={canManage}
            problems={validation.problems}
            focusNodeId={focusNodeId}
            lastTestNodeStatuses={lastTestStatuses}
            lastTestEdgeStatuses={lastTestEdgeStatuses}
            onChange={history.set}
            onCommit={history.commit}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
          />
        </PanelSection>
      </Panel>

      {canManage && (
        <Panel>
          <PanelSection className="flex flex-wrap items-center gap-2">
            <Button disabled={saving || name.trim() === ''} onClick={() => void save()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              Salvar
            </Button>

            <Button
              variant="secondary"
              disabled={saving || !validation.valid || name.trim() === ''}
              title={!validation.valid ? 'Corrija os erros acima para poder ativar' : undefined}
              onClick={async () => {
                const saved = await save();
                if (saved == null) return;
                try {
                  await setAutomationStatus(saved.id, 'active');
                  setFeedback({ tone: 'ok', text: 'Automação ativada.' });
                  await onSaved();
                } catch (thrown) {
                  setFeedback({ tone: 'error', text: thrown instanceof Error ? thrown.message : 'Não foi possível ativar.' });
                }
              }}
            >
              <Check size={14} />
              Salvar e ativar
            </Button>

            {automation != null && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setFeedback(null);
                  setLastTestStatuses(null);
                  setLastTestEdgeStatuses(null);
                  try {
                    const result = await runAutomationManually(automation.id, { dryRun: true });
                    setFeedback({ tone: result.ok ? 'ok' : 'error', text: result.message });
                    // Resultado real do teste (§19) — nunca inventado. Se não vier
                    // executionId (ex.: falha antes de abrir uma execução), não há
                    // nada para destacar, e nada é destacado.
                    if (result.executionId) {
                      const nodeExecutions = await listNodeExecutions(result.executionId).catch(() => []);
                      const byNode: Record<string, NodeExecutionStatus> = {};
                      for (const ne of nodeExecutions) byNode[ne.nodeId] = ne.status;
                      setLastTestStatuses(byNode);
                      setLastTestEdgeStatuses(edgeStatusesFromExecutions(workflow, nodeExecutions));
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Play size={14} />
                Testar sem aplicar
              </Button>
            )}

            <p className="text-xs leading-relaxed text-fg-subtle">
              O teste avalia o fluxo e registra a execução, mas não aplica as ações que alteram dados.
            </p>
          </PanelSection>
        </Panel>
      )}
    </Page>
  );
}
