import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { Badge, Button, Panel, PanelSection, SegmentedControl } from '../ui';
import { listNodeExecutions, runAutomationManually } from '../../lib/automation/automationService';
import { isKnownTrigger, TRIGGERS } from '../../lib/automation/registry';
import { NODE_META } from '../../lib/automation/nodeMeta';
import {
  EXECUTION_STATUS_LABEL,
  type Automation,
  type AutomationExecution,
  type NodeExecution,
} from '../../lib/automation/types';
import { ExecutionTrace } from './flow/ExecutionTrace';

interface Props {
  execution: AutomationExecution;
  automation: Automation | undefined;
  canManage: boolean;
  /** Chamado depois de um "Testar novamente" bem-sucedido, para a lista de
   *  execuções recarregar e mostrar a nova execução de teste. */
  onRetested: () => void;
}

const STATUS_VARIANT = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'neutral',
  cancelled: 'neutral',
} as const;

const EXECUTED_BY_LABEL: Record<AutomationExecution['triggerSource'], string> = {
  manual: 'Manual',
  event: 'Sistema',
  schedule: 'Sistema (agendamento)',
  webhook: 'Sistema (webhook)',
};

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

type StepTab = 'detalhes' | 'entrada' | 'saida' | 'logs';

/** Painel de detalhes de UMA execução — resumo, trace de leitura (reaproveitando
 *  ExecutionTrace/FlowNode/FlowEdge do editor, §3) e detalhe do passo selecionado
 *  em abas que só aparecem quando há dado real para mostrar (§4). */
export function ExecutionDetailPanel({ execution, automation, canManage, onRetested }: Props) {
  const [nodeExecutions, setNodeExecutions] = useState<NodeExecution[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<StepTab>('detalhes');
  const [retesting, setRetesting] = useState(false);
  const [retestFeedback, setRetestFeedback] = useState<string | null>(null);

  useEffect(() => {
    setLoadingSteps(true);
    setSelectedNodeId(null);
    setRetestFeedback(null);
    listNodeExecutions(execution.id)
      .then(rows => {
        setNodeExecutions(rows);
        // Foca automaticamente no primeiro passo com erro — é o que a pessoa
        // veio ver quando abriu uma execução com resultado ruim; sem erro,
        // fica no último passo (onde o fluxo parou).
        const firstFailed = rows.find(r => r.status === 'failed');
        setSelectedNodeId((firstFailed ?? rows[rows.length - 1])?.nodeId ?? null);
      })
      .catch(() => setNodeExecutions([]))
      .finally(() => setLoadingSteps(false));
  }, [execution.id]);

  useEffect(() => { setTab('detalhes'); }, [selectedNodeId]);

  // Loop pode revisitar o mesmo nodeId — mesma regra de "o mais recente vence"
  // do resto do módulo (computeTraceNodeStatuses / AutomationEditor.tsx).
  const selectedStep = useMemo(() => {
    const matches = nodeExecutions.filter(ne => ne.nodeId === selectedNodeId);
    return matches[matches.length - 1] ?? null;
  }, [nodeExecutions, selectedNodeId]);

  const executedSteps = nodeExecutions.filter(ne => ne.status !== 'skipped').length;
  const totalNodes = automation?.workflow.nodes.length ?? nodeExecutions.length;
  const triggerLabel = isKnownTrigger(execution.triggerType) ? TRIGGERS[execution.triggerType].label : execution.triggerType;

  const hasEntrada = execution.context?.trigger != null && Object.keys(execution.context.trigger as object).length > 0;
  const hasSaida = selectedStep?.output != null && Object.keys(selectedStep.output).length > 0;
  const hasLogs = selectedStep != null && (
    selectedStep.errorMessage != null ||
    typeof selectedStep.output?.evaluation === 'string' ||
    (Array.isArray(selectedStep.output?.unresolvedVariables) && (selectedStep.output.unresolvedVariables as unknown[]).length > 0) ||
    selectedStep.conditionResult != null ||
    selectedStep.attempts > 1
  );

  const tabOptions = useMemo(() => {
    const options: { value: StepTab; label: string }[] = [{ value: 'detalhes', label: 'Detalhes do passo' }];
    if (hasEntrada) options.push({ value: 'entrada', label: 'Entrada do evento' });
    if (hasSaida) options.push({ value: 'saida', label: 'Saída do passo' });
    if (hasLogs) options.push({ value: 'logs', label: 'Logs' });
    return options;
  }, [hasEntrada, hasSaida, hasLogs]);

  const activeTab = tabOptions.some(o => o.value === tab) ? tab : tabOptions[0]?.value ?? 'detalhes';

  async function retest() {
    if (automation == null) return;
    setRetesting(true);
    setRetestFeedback(null);
    try {
      const outcome = await runAutomationManually(automation.id, { dryRun: true, context: (execution.context?.trigger as Record<string, unknown>) ?? {} });
      setRetestFeedback(outcome.message);
      onRetested();
    } finally {
      setRetesting(false);
    }
  }

  const canRetest = canManage && automation != null && (execution.status === 'failed' || execution.status === 'partial');

  return (
    <Panel>
      <PanelSection className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-section">Detalhes da execução</h3>
            <Badge variant={STATUS_VARIANT[execution.status]}>{EXECUTION_STATUS_LABEL[execution.status]}</Badge>
            {execution.dryRun && <Badge variant="neutral">Teste</Badge>}
          </div>
          <p className="mt-1 text-xs text-fg-subtle">
            Iniciada em {new Date(execution.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}
          </p>
        </div>

        {canRetest && (
          <div className="flex flex-col items-end gap-1">
            <Button variant="secondary" size="sm" disabled={retesting} onClick={() => void retest()} title="Roda de novo com o mesmo evento original, sem aplicar ações — mesma proteção do teste do editor.">
              {retesting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Testar novamente (sem aplicar)
            </Button>
            {retestFeedback && <p className="text-xs text-fg-subtle">{retestFeedback}</p>}
          </div>
        )}
      </PanelSection>

      <PanelSection className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <SummaryField label="Automação" value={automation?.name ?? 'Automação removida'} />
        <SummaryField label="Gatilho" value={triggerLabel} />
        <SummaryField label="Duração total" value={formatMs(execution.durationMs)} />
        <SummaryField label="Passos executados" value={`${executedSteps} de ${totalNodes}`} />
        <SummaryField label="Executado por" value={EXECUTED_BY_LABEL[execution.triggerSource]} />
        <SummaryField label="ID da execução" value={execution.id} mono />
      </PanelSection>

      {execution.errorMessage && (
        <PanelSection>
          <div className="flex items-start gap-2 rounded-container border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{execution.errorMessage}</span>
          </div>
        </PanelSection>
      )}

      <PanelSection>
        <p className="text-label mb-2">Trace do fluxo</p>
        {automation == null ? (
          <p className="text-sm text-fg-muted">Automação removida — o trace não pode ser reconstruído, mas o resumo acima usa os dados gravados na execução.</p>
        ) : loadingSteps ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 size={14} className="animate-spin" />Carregando trace…</p>
        ) : (
          <>
            {nodeExecutions.length === 0 && (
              <p className="mb-2 text-xs text-fg-subtle">Nenhum passo registrado para esta execução — mostrando apenas a estrutura do fluxo atual.</p>
            )}
            <ExecutionTrace
              workflow={automation.workflow}
              triggerType={execution.triggerType}
              nodeExecutions={nodeExecutions}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          </>
        )}
      </PanelSection>

      {selectedStep && (
        <PanelSection>
          <SegmentedControl label="Detalhe do passo" value={activeTab} onChange={setTab} options={tabOptions} className="mb-3" />

          {activeTab === 'detalhes' && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <SummaryField label="Passo" value={selectedStep.nodeLabel ?? NODE_META[selectedStep.nodeType as keyof typeof NODE_META]?.kindLabel ?? selectedStep.nodeType} />
              <SummaryField label="Tipo" value={selectedStep.nodeType} />
              <SummaryField label="Status" value={statusLabelForStep(selectedStep.status)} />
              <SummaryField label="Início" value={new Date(selectedStep.startedAt).toLocaleTimeString('pt-BR')} />
              <SummaryField label="Duração" value={formatMs(selectedStep.durationMs)} />
              <SummaryField label="Tentativas" value={String(selectedStep.attempts)} />
            </div>
          )}

          {activeTab === 'entrada' && (
            <pre className="max-h-64 overflow-auto rounded-container border border-edge bg-surface-3 p-3 text-xs text-fg-muted">
              {JSON.stringify(execution.context.trigger, null, 2)}
            </pre>
          )}

          {activeTab === 'saida' && (
            <pre className="max-h-64 overflow-auto rounded-container border border-edge bg-surface-3 p-3 text-xs text-fg-muted">
              {JSON.stringify(selectedStep.output, null, 2)}
            </pre>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-2 text-sm">
              {selectedStep.conditionResult != null && (
                <p className="text-fg-muted">Avaliação da condição: <span className={selectedStep.conditionResult ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'}>{selectedStep.conditionResult ? 'SIM' : 'NÃO'}</span></p>
              )}
              {typeof selectedStep.output?.evaluation === 'string' && (
                <p className="text-fg-muted">{selectedStep.output.evaluation}</p>
              )}
              {Array.isArray(selectedStep.output?.unresolvedVariables) && (selectedStep.output.unresolvedVariables as string[]).length > 0 && (
                <p className="text-amber-700 dark:text-amber-400">Variáveis sem valor: {(selectedStep.output.unresolvedVariables as string[]).join(', ')}</p>
              )}
              {selectedStep.attempts > 1 && (
                <p className="text-amber-700 dark:text-amber-400">Precisou de {selectedStep.attempts} tentativas até {selectedStep.status === 'success' ? 'ter sucesso' : 'desistir'}.</p>
              )}
              {selectedStep.errorMessage && (
                <p className="text-red-600 dark:text-red-400">{selectedStep.errorMessage}</p>
              )}
            </div>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}

function SummaryField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-caption">{label}</p>
      <p className={`mt-0.5 truncate text-fg ${mono ? 'font-mono text-xs' : ''}`} title={value}>{value}</p>
    </div>
  );
}

function statusLabelForStep(status: NodeExecution['status']): string {
  if (status === 'success') return 'Sucesso';
  if (status === 'failed') return 'Erro';
  return 'Ignorado';
}
