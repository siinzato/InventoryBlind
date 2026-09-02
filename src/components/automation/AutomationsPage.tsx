import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  CheckCircle2,
  Copy,
  History,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection, Select,
  SegmentedControl, Table, Td, Th, Thead, Tr,
} from '../ui';
import {
  createAutomation,
  deleteAutomation,
  duplicateAutomation,
  listAutomations,
  listExecutions,
  listNotifications,
  markNotificationRead,
  processAutomationQueue,
  setAutomationStatus,
} from '../../lib/automation/automationService';
import { AUTOMATION_TEMPLATES } from '../../lib/automation/templates';
import { validateWorkflow } from '../../lib/automation/workflow';
import { TRIGGERS, isKnownTrigger } from '../../lib/automation/registry';
import { AUTOMATION_STATUS_LABEL, type Automation, type AutomationExecution, type AutomationNotification } from '../../lib/automation/types';
import { AgentsPanel } from './AgentsPanel';
import { AutomationEditor } from './AutomationEditor';
import { AutomationKpiCard } from './AutomationKpiCard';
import { ExecutionHistory } from './ExecutionHistory';

interface Props {
  canManage: boolean;
  onBack?: () => void;
}

type View = 'list' | 'agents' | 'templates' | 'executions';
type Filter = 'all' | 'active' | 'inactive';

const STATUS_VARIANT = {
  active: 'success',
  draft: 'neutral',
  inactive: 'neutral',
  error: 'danger',
} as const;

/** Automações — lista, templates e histórico.
 *
 *  Uma automação é composta pelo usuário e interpretada pelo engine; nada aqui
 *  contém regra de negócio. A tela só monta, valida antes de ativar e mostra o que
 *  aconteceu. */
export function AutomationsPage({ canManage, onBack }: Props) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [notifications, setNotifications] = useState<AutomationNotification[]>([]);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, notices, recentExecutions] = await Promise.all([
        listAutomations(),
        // Não bloqueia a tela: sem as notificações a lista continua útil.
        listNotifications({ onlyUnread: true }).catch(() => [] as AutomationNotification[]),
        // Idem para a faixa de indicadores — sem execuções recentes a lista de
        // automações continua útil, só a faixa fica sem números.
        listExecutions({ limit: 200 }).catch(() => [] as AutomationExecution[]),
      ]);
      setAutomations(list);
      setNotifications(notices);
      setExecutions(recentExecutions);
    } catch (thrown) {
      setMessage({
        tone: 'error',
        text: thrown instanceof Error ? thrown.message : 'Não foi possível carregar as automações.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Faixa de indicadores (§1) — só números que já vêm de dados reais já buscados
  // acima; nada é inventado, e o que não puder ser derivado fica "—".
  const kpis = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const executionsToday = executions.filter(e => new Date(e.startedAt).getTime() >= startOfToday).length;
    const executionsYesterday = executions.filter(e => {
      const t = new Date(e.startedAt).getTime();
      return t >= startOfYesterday && t < startOfToday;
    }).length;
    // Só mostra a variação quando ontem teve execução para comparar — do
    // contrário a % seria infinita ou enganosa (0 → N não é "cresceu X%").
    const executionsTrendPct = executionsYesterday > 0
      ? Math.round(((executionsToday - executionsYesterday) / executionsYesterday) * 100)
      : null;

    const real7d = executions.filter(e => !e.dryRun && new Date(e.startedAt).getTime() >= last7d);
    const successRate = real7d.length === 0
      ? null
      : Math.round((real7d.filter(e => e.status === 'success').length / real7d.length) * 100);

    const recentFailures = executions.filter(e => e.status === 'failed' && new Date(e.startedAt).getTime() >= last24h).length;

    return {
      activeCount: automations.filter(a => a.status === 'active').length,
      totalCount: automations.length,
      executionsToday,
      executionsTrendPct,
      successRate,
      recentFailures,
    };
  }, [automations, executions]);

  // Taxa de sucesso por automação (coluna da tabela) — mesma amostra de execuções
  // já buscada para a faixa de indicadores, sem outra chamada ao banco.
  const successRateByAutomation = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const automation of automations) {
      const real = executions.filter(e => e.automationId === automation.id && !e.dryRun);
      map.set(automation.id, real.length === 0 ? null : Math.round((real.filter(e => e.status === 'success').length / real.length) * 100));
    }
    return map;
  }, [automations, executions]);

  const availableTriggers = useMemo(
    () => Array.from(new Set(automations.map(a => a.triggerType))),
    [automations]
  );

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'ok', text: await action() });
    } catch (thrown) {
      setMessage({ tone: 'error', text: thrown instanceof Error ? thrown.message : 'Operação falhou.' });
    } finally {
      setBusy(null);
      await load();
    }
  }

  const filtered = useMemo(() => {
    let list = automations;
    if (filter === 'active') list = list.filter(a => a.status === 'active');
    if (filter === 'inactive') list = list.filter(a => a.status !== 'active');
    if (triggerFilter !== 'all') list = list.filter(a => a.triggerType === triggerFilter);
    const query = search.trim().toLowerCase();
    if (query !== '') list = list.filter(a => a.name.toLowerCase().includes(query) || (a.description ?? '').toLowerCase().includes(query));
    return list;
  }, [automations, filter, triggerFilter, search]);

  const hasActiveFilters = filter !== 'all' || triggerFilter !== 'all' || search.trim() !== '';

  if (editing != null) {
    return (
      <AutomationEditor
        automation={editing === 'new' ? null : editing}
        canManage={canManage}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Automações"
        title="Agentes e Automações"
        description="Quando algo acontecer, avalie condições e execute ações — composto por você, executado pelo servidor."
        actions={
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft size={14} />
                Voltar
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus size={14} />
                Nova automação
              </Button>
            )}
          </div>
        }
      />

      {message && (
        <Notice tone={message.tone === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>
      )}

      {notifications.length > 0 && (
        <NotificationsPanel notifications={notifications} onChanged={load} />
      )}

      {!loading && automations.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AutomationKpiCard
            icon={WorkflowIcon}
            iconClass="bg-accent/10 text-accent"
            title="Automações ativas"
            value={kpis.activeCount}
            context={`de ${kpis.totalCount} no total`}
          />
          <AutomationKpiCard
            icon={RefreshCw}
            iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            title="Execuções hoje"
            value={kpis.executionsToday}
            context={kpis.executionsTrendPct == null ? 'sem execução ontem para comparar' : `${kpis.executionsTrendPct >= 0 ? '↑' : '↓'} ${Math.abs(kpis.executionsTrendPct)}% vs ontem`}
          />
          <AutomationKpiCard
            icon={CheckCircle2}
            iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            title="Taxa de sucesso"
            value={kpis.successRate == null ? '—' : `${kpis.successRate}%`}
            context={kpis.successRate == null ? 'sem execuções reais em 7 dias' : 'últimos 7 dias'}
          />
          <AutomationKpiCard
            icon={AlertTriangle}
            iconClass="bg-red-500/10 text-red-600 dark:text-red-400"
            title="Falhas recentes"
            value={kpis.recentFailures}
            context="últimas 24h"
            tone={kpis.recentFailures > 0 ? 'critical' : 'default'}
          />
        </div>
      )}

      <SegmentedControl
        label="Visão"
        width="full"
        value={view}
        onChange={value => setView(value as View)}
        options={[
          { value: 'list', label: 'Automações', icon: WorkflowIcon },
          { value: 'agents', label: 'Agentes', icon: Bot },
          { value: 'templates', label: 'Templates', icon: Sparkles },
          { value: 'executions', label: 'Execuções', icon: History },
        ]}
      />

      {view === 'agents' ? (
        <AgentsPanel automations={automations} canManage={canManage} onChanged={load} onOpenWorkflow={setEditing} />
      ) : view === 'executions' ? (
        <ExecutionHistory automations={automations} canManage={canManage} />
      ) : view === 'templates' ? (
        <TemplatesPanel
          canManage={canManage}
          onCreated={async (name: string) => {
            await load();
            setMessage({ tone: 'ok', text: `"${name}" criada como rascunho. Revise e ative.` });
            setView('list');
          }}
        />
      ) : loading ? (
        <Panel>
          <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin" />
            Carregando automações…
          </PanelSection>
        </Panel>
      ) : automations.length === 0 ? (
        <EmptyState canManage={canManage} onCreate={() => setEditing('new')} onTemplates={() => setView('templates')} />
      ) : (
        <Panel>
          <PanelSection className="flex flex-wrap items-center gap-3">
            <Input
              icon={<Search size={14} />}
              placeholder="Buscar automação pelo nome"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="min-w-[220px] flex-1"
            />
            <Select value={triggerFilter} onChange={e => setTriggerFilter(e.target.value)} className="w-auto">
              <option value="all">Gatilho: Todos</option>
              {availableTriggers.map(key => (
                <option key={key} value={key}>{isKnownTrigger(key) ? TRIGGERS[key].label : key}</option>
              ))}
            </Select>
          </PanelSection>

          <PanelSection className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Filtro"
              value={filter}
              onChange={value => setFilter(value as Filter)}
              options={[
                { value: 'all', label: `Todas (${automations.length})` },
                { value: 'active', label: `Ativas (${automations.filter(a => a.status === 'active').length})` },
                { value: 'inactive', label: 'Inativas' },
              ]}
            />
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy != null}
                title="Ação técnica: processa manualmente a fila de eventos pendentes, sem esperar o próximo ciclo automático."
                onClick={() =>
                  run('queue', async () => {
                    const result = await processAutomationQueue();
                    if (!result.ok) throw new Error(result.message);
                    return result.message;
                  })
                }
              >
                {busy === 'queue' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Processar fila
              </Button>
            )}
          </PanelSection>

          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Nome</Th>
                  <Th>Gatilho</Th>
                  <Th>Situação</Th>
                  <Th>Execuções</Th>
                  <Th>Última execução</Th>
                  <Th>Próxima execução</Th>
                  <Th>Taxa de sucesso</Th>
                  <Th>Ações</Th>
                </Tr>
              </Thead>
              <tbody>
                {filtered.length === 0 && (
                  <Tr>
                    <Td colSpan={8} className="text-fg-muted">
                      <div className="flex flex-wrap items-center gap-3">
                        <span>{hasActiveFilters ? 'Nenhuma automação encontrada para esses filtros.' : 'Nenhuma automação neste filtro.'}</span>
                        {hasActiveFilters && (
                          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilter('all'); setTriggerFilter('all'); }}>
                            Limpar filtros
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )}
                {filtered.map(automation => {
                  const validation = validateWorkflow(automation.workflow);
                  const trigger = isKnownTrigger(automation.triggerType)
                    ? TRIGGERS[automation.triggerType].label
                    : automation.triggerType;

                  return (
                    <Tr key={automation.id}>
                      <Td>
                        <button
                          type="button"
                          onClick={() => setEditing(automation)}
                          className="text-left font-medium text-fg hover:text-accent transition-colors"
                        >
                          {automation.name}
                        </button>
                        {automation.description && (
                          <p className="mt-0.5 max-w-sm text-xs text-fg-subtle">{automation.description}</p>
                        )}
                      </Td>
                      <Td className="text-fg-muted">{trigger}</Td>
                      <Td>
                        <Badge variant={STATUS_VARIANT[automation.status]}>
                          {AUTOMATION_STATUS_LABEL[automation.status]}
                        </Badge>
                        {/* Só avisa sobre erro de configuração quando a automação
                            ainda não está ativa — uma ativa com erro já carrega o
                            status 'error'. */}
                        {!validation.valid && automation.status !== 'error' && (
                          <p className="mt-1 max-w-xs text-xs text-amber-600 dark:text-amber-400">
                            {validation.problems.find(p => p.severity === 'error')?.message}
                          </p>
                        )}
                      </Td>
                      <Td className="tabular-nums text-fg-muted">{automation.executionCount}</Td>
                      <Td className="whitespace-nowrap text-fg-muted">
                        {automation.lastExecutedAt == null
                          ? '—'
                          : new Date(automation.lastExecutedAt).toLocaleString('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                      </Td>
                      {/* Nenhuma automação hoje tem horário de agendamento configurável pela
                          tela (ver limitação no relatório) — a coluna fica estruturalmente
                          presente, mas nunca com um valor inventado. */}
                      <Td className="whitespace-nowrap text-fg-subtle">—</Td>
                      <Td className="tabular-nums text-fg-muted">
                        {successRateByAutomation.get(automation.id) == null ? '—' : `${successRateByAutomation.get(automation.id)}%`}
                      </Td>
                      <Td>
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy != null || (automation.status !== 'active' && !validation.valid)}
                              title={
                                automation.status !== 'active' && !validation.valid
                                  ? 'Corrija a configuração antes de ativar'
                                  : undefined
                              }
                              onClick={() =>
                                run(automation.id, async () => {
                                  const next = automation.status === 'active' ? 'inactive' : 'active';
                                  await setAutomationStatus(automation.id, next);
                                  return next === 'active' ? 'Automação ativada.' : 'Automação desativada.';
                                })
                              }
                            >
                              {busy === automation.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : automation.status === 'active' ? (
                                <Pause size={13} />
                              ) : (
                                <Play size={13} />
                              )}
                              {automation.status === 'active' ? 'Desativar' : 'Ativar'}
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy != null}
                              onClick={() =>
                                run(`dup-${automation.id}`, async () => {
                                  await duplicateAutomation(automation.id);
                                  return 'Cópia criada como rascunho.';
                                })
                              }
                              title="Duplicar"
                            >
                              <Copy size={13} />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy != null}
                              onClick={() => {
                                // Confirmação por window.confirm: exclusão apaga o
                                // histórico de execuções por cascade, e o projeto não
                                // tem primitive de diálogo de confirmação.
                                if (!window.confirm(`Excluir "${automation.name}"? O histórico de execuções também será apagado.`)) return;
                                void run(`del-${automation.id}`, async () => {
                                  await deleteAutomation(automation.id);
                                  return 'Automação excluída.';
                                });
                              }}
                              title="Excluir"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </Panel>
      )}
    </Page>
  );
}

// ── Notificações ────────────────────────────────────────────────────────────

function NotificationsPanel({
  notifications,
  onChanged,
}: {
  notifications: AutomationNotification[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const TONE = {
    critical: 'text-red-500',
    warning: 'text-amber-500',
    info: 'text-fg-subtle',
  } as const;

  return (
    <Panel>
      <PanelSection>
        <h3 className="text-section flex items-center gap-2">
          <Bell size={15} className="text-fg-subtle" />
          Avisos das automações
        </h3>
      </PanelSection>
      <div className="divide-y divide-edge/60">
        {notifications.map(notification => (
          <div key={notification.id} className="flex items-start gap-3 px-6 py-4">
            <Bell size={14} className={`mt-0.5 flex-shrink-0 ${TONE[notification.severity]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{notification.title}</p>
              {notification.body && (
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{notification.body}</p>
              )}
              <p className="mt-1 text-xs text-fg-subtle">
                {new Date(notification.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy != null}
              onClick={async () => {
                setBusy(notification.id);
                try {
                  await markNotificationRead(notification.id);
                } finally {
                  setBusy(null);
                  onChanged();
                }
              }}
            >
              {busy === notification.id ? <Loader2 size={13} className="animate-spin" /> : 'Marcar como lida'}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplatesPanel({
  canManage,
  onCreated,
}: {
  canManage: boolean;
  onCreated: (name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {failure && <Notice tone="danger">{failure}</Notice>}

      <Panel>
        <PanelSection>
          <h3 className="text-section">Templates</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
            Atalhos para começar. O que é criado fica totalmente editável — mesmos blocos que o
            editor produz, sem nada travado.
          </p>
        </PanelSection>

        <div className="divide-y divide-edge/60">
          {AUTOMATION_TEMPLATES.map(template => {
            const threshold = thresholds[template.key] ?? template.defaultThreshold;

            return (
              <div key={template.key} className="px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">{template.name}</p>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
                      {template.description}
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-subtle">
                      {template.outcome}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-shrink-0 items-end gap-2">
                      {template.defaultThreshold != null && (
                        <label className="block">
                          <span className="block text-xs text-fg-subtle">{template.thresholdLabel}</span>
                          <input
                            type="number"
                            min={0.1}
                            step={0.1}
                            value={threshold}
                            onChange={e =>
                              setThresholds(current => ({ ...current, [template.key]: Number(e.target.value) }))
                            }
                            className="mt-1 w-24 rounded-control border border-edge bg-surface px-2 py-1.5 text-sm text-fg"
                          />
                        </label>
                      )}
                      <Button
                        variant="secondary"
                        disabled={busy != null}
                        onClick={async () => {
                          setBusy(template.key);
                          setFailure(null);
                          try {
                            await createAutomation({
                              name: template.name,
                              description: template.description,
                              workflow: template.build({ threshold }),
                            });
                            await onCreated(template.name);
                          } catch (thrown) {
                            setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível criar.');
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === template.key ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Usar template
                      </Button>
                    </div>
                  )}
                </div>

                {/* Prévia do fluxo, na mesma leitura vertical do editor. */}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                  {template.build({ threshold }).nodes.map((node, index) => (
                    <span key={node.id} className="flex items-center gap-2">
                      {index > 0 && <span aria-hidden>→</span>}
                      <span className="rounded-control border border-edge bg-surface-3 px-2 py-1">
                        {node.label ?? node.type}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  canManage,
  onCreate,
  onTemplates,
}: {
  canManage: boolean;
  onCreate: () => void;
  onTemplates: () => void;
}) {
  return (
    <Panel>
      <PanelSection padding="lg">
        <div className="flex items-start gap-3">
          <WorkflowIcon size={18} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <h3 className="text-title">Nenhuma automação criada</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
              Automatize o que se repete no inventário: avisar a supervisão quando a divergência
              passar de um limite, gerar a recontagem sozinha, registrar ocorrência. Você monta a
              lógica com blocos; o servidor executa.
            </p>
            {canManage ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={onCreate}>
                  <Plus size={14} />
                  Criar primeira automação
                </Button>
                <Button variant="secondary" onClick={onTemplates}>
                  <Sparkles size={14} />
                  Ver templates
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-fg-subtle">
                Somente owner, admin ou manager podem criar automações.
              </p>
            )}
          </div>
        </div>
      </PanelSection>
    </Panel>
  );
}
