import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { Badge, Panel, PanelSection, Table, Td, Th, Thead, Tr } from '../ui';
import { listExecutions, listNodeExecutions } from '../../lib/automation/automationService';
import { EXECUTION_STATUS_LABEL, type Automation, type AutomationExecution, type NodeExecution } from '../../lib/automation/types';

const STATUS_VARIANT = {
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  running: 'accent',
  cancelled: 'neutral',
} as const;

const NODE_KIND_LABEL: Record<string, string> = {
  trigger: 'Gatilho',
  condition: 'Condição',
  branch: 'Ramificação',
  action: 'Ação',
};

/** Histórico de execuções, com o log por bloco.
 *
 *  O detalhe é carregado ao expandir, não junto da lista: a maioria das execuções
 *  nunca é aberta, e trazer o log de todas faria cada visita pagar por isso. */
export function ExecutionHistory({ automations }: { automations: Automation[] }) {
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, NodeExecution[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExecutions(await listExecutions({ limit: 50 }));
      setFailure(null);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível carregar o histórico.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(executionId: string) {
    if (expanded === executionId) {
      setExpanded(null);
      return;
    }

    setExpanded(executionId);

    if (nodes[executionId] == null) {
      setLoadingNodes(executionId);
      try {
        const rows = await listNodeExecutions(executionId);
        setNodes(current => ({ ...current, [executionId]: rows }));
      } catch {
        setNodes(current => ({ ...current, [executionId]: [] }));
      } finally {
        setLoadingNodes(null);
      }
    }
  }

  function automationName(id: string): string {
    return automations.find(a => a.id === id)?.name ?? 'Automação removida';
  }

  if (loading) {
    return (
      <Panel>
        <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
          <Loader2 size={16} className="animate-spin" />
          Carregando execuções…
        </PanelSection>
      </Panel>
    );
  }

  if (failure != null) {
    return (
      <Panel>
        <PanelSection className="text-sm text-red-600 dark:text-red-400">{failure}</PanelSection>
      </Panel>
    );
  }

  if (executions.length === 0) {
    return (
      <Panel>
        <PanelSection className="text-sm leading-relaxed text-fg-muted">
          Nenhuma execução registrada. As execuções aparecem aqui quando um evento aciona uma
          automação ativa, ou quando você executa manualmente.
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Quando</Th>
              <Th>Automação</Th>
              <Th>Origem</Th>
              <Th>Resultado</Th>
              <Th>Duração</Th>
              <Th />
            </Tr>
          </Thead>
          <tbody>
            {executions.map(execution => (
              <>
                <Tr key={execution.id}>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {new Date(execution.startedAt).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    })}
                  </Td>
                  <Td className="text-fg">{automationName(execution.automationId)}</Td>
                  <Td className="text-fg-muted">
                    {execution.triggerSource === 'manual' ? 'Manual' : 'Evento'}
                    {execution.dryRun && (
                      <Badge variant="neutral" className="ml-2">
                        Teste
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[execution.status]}>
                      {EXECUTION_STATUS_LABEL[execution.status]}
                    </Badge>
                    {execution.errorMessage && (
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-fg-subtle">
                        {execution.errorMessage}
                      </p>
                    )}
                  </Td>
                  <Td className="tabular-nums text-fg-muted">
                    {execution.durationMs == null ? '—' : `${execution.durationMs} ms`}
                  </Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => void toggle(execution.id)}
                      className="flex min-h-[44px] items-center gap-1 text-sm font-medium text-accent"
                    >
                      {expanded === execution.id ? 'Fechar' : 'Detalhe'}
                      <ChevronRight
                        size={13}
                        className={`transition-transform ${expanded === execution.id ? 'rotate-90' : ''}`}
                      />
                    </button>
                  </Td>
                </Tr>

                {expanded === execution.id && (
                  <Tr key={`${execution.id}-detail`}>
                    <Td colSpan={6} className="bg-surface-3/40">
                      {loadingNodes === execution.id ? (
                        <p className="flex items-center gap-2 text-sm text-fg-muted">
                          <Loader2 size={14} className="animate-spin" />
                          Carregando passos…
                        </p>
                      ) : (nodes[execution.id] ?? []).length === 0 ? (
                        <p className="text-sm text-fg-muted">Nenhum passo registrado.</p>
                      ) : (
                        <ol className="space-y-2">
                          {(nodes[execution.id] ?? []).map(node => (
                            <li key={node.id} className="flex items-start gap-3">
                              <span className="mt-0.5 flex-shrink-0">
                                {node.status === 'success' ? (
                                  <Check size={14} className="text-emerald-500" />
                                ) : node.status === 'failed' ? (
                                  <X size={14} className="text-red-500" />
                                ) : (
                                  <span className="block h-3.5 w-3.5 rounded-full border border-edge" />
                                )}
                              </span>

                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-fg">
                                  <span className="text-fg-subtle">{NODE_KIND_LABEL[node.nodeType] ?? node.nodeType}</span>
                                  {' · '}
                                  {node.nodeLabel ?? node.nodeId}
                                  {/* A avaliação da condição é o que explica por que a
                                      automação seguiu ou parou. */}
                                  {node.conditionResult != null && (
                                    <span className={node.conditionResult ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-muted'}>
                                      {' → '}
                                      {node.conditionResult ? 'SIM' : 'NÃO'}
                                    </span>
                                  )}
                                </p>

                                {typeof node.output?.evaluation === 'string' && (
                                  <p className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
                                    {node.output.evaluation}
                                  </p>
                                )}

                                {node.errorMessage && (
                                  <p className="mt-0.5 text-xs leading-relaxed text-red-600 dark:text-red-400">
                                    {node.errorMessage}
                                    {node.attempts > 1 && ` (${node.attempts} tentativas)`}
                                  </p>
                                )}

                                {Array.isArray(node.output?.unresolvedVariables) &&
                                  node.output.unresolvedVariables.length > 0 && (
                                    <p className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                                      Variáveis sem valor: {(node.output.unresolvedVariables as string[]).join(', ')}
                                    </p>
                                  )}

                                {node.output?.simulated === true && (
                                  <p className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
                                    Simulado — a ação não foi aplicada.
                                  </p>
                                )}
                              </div>

                              <span className="flex-shrink-0 text-xs tabular-nums text-fg-subtle">
                                {node.durationMs == null ? '' : `${node.durationMs} ms`}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </Td>
                  </Tr>
                )}
              </>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
}
