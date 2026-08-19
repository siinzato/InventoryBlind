import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clock, GitBranch, Loader2, Play, Plus, Shuffle, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Modal, Page, PageHeader, Panel, PanelSection, Select, Textarea } from '../ui';
import {
  createAutomation,
  runAutomationManually,
  setAutomationStatus,
  updateAutomation,
} from '../../lib/automation/automationService';
import {
  ACTIONS,
  OPERATORS,
  TRIGGERS,
  TRIGGER_KEYS,
  actionsForTrigger,
  fieldsForTrigger,
  findField,
  isKnownTrigger,
  operatorsForKind,
  type ActionKey,
  type OperatorKey,
  type TriggerKey,
} from '../../lib/automation/registry';
import { validateWorkflow } from '../../lib/automation/workflow';
import { AutomationCanvas } from './AutomationCanvas';
import type {
  ActionNode,
  Automation,
  AutomationEdge,
  AutomationNode,
  AutomationWorkflow,
  BranchNode,
  ConditionNode,
  ConditionRule,
  DelayNode,
  SwitchNode,
} from '../../lib/automation/types';

interface Props {
  automation: Automation | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/** Editor de workflow — canvas livre.
 *
 *  Substituiu o editor vertical, e a troca não exigiu tocar engine, persistência nem
 *  validação: o modelo sempre foi nodes + edges com saídas nomeadas, e a tela antiga
 *  apenas mostrava um subconjunto dele. Um workflow salvo pelo editor antigo abre aqui
 *  sem migração, porque layout.ts deriva as posições do próprio grafo quando elas não
 *  existem.
 *
 *  Agora qualquer grafo é editável: vários branches, switches, convergências. O que o
 *  canvas não tem é zoom e minimapa — ver o comentário em AutomationCanvas sobre não
 *  adicionar biblioteca. */
export function AutomationEditor({ automation, canManage, onClose, onSaved }: Props) {
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [workflow, setWorkflow] = useState<AutomationWorkflow>(
    automation?.workflow ?? { nodes: [{ id: 'trigger', type: 'trigger', triggerType: 'count.item_counted', label: 'Item contado', config: {} }], edges: [] }
  );
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const triggerNode = workflow.nodes.find(n => n.type === 'trigger');
  const triggerType = (triggerNode as { triggerType?: string } | undefined)?.triggerType ?? 'manual';

  const validation = useMemo(() => validateWorkflow(workflow), [workflow]);

  /** A cadeia na ordem de execução. Segue as arestas a partir do trigger em vez de
   *  usar a ordem do array: é a ordem que o engine vai percorrer, e mostrar outra
   *  faria o usuário desenhar uma coisa e ver outra rodar. */
  const chain = useMemo(() => {
    const ordered: AutomationNode[] = [];
    const seen = new Set<string>();
    let currentId = triggerNode?.id ?? null;

    while (currentId != null && !seen.has(currentId)) {
      seen.add(currentId);
      const node = workflow.nodes.find(n => n.id === currentId);
      if (node == null) break;
      ordered.push(node);
      currentId = workflow.edges.find(e => e.from === currentId && e.branch === 'next')?.to ?? null;
    }

    return ordered;
  }, [workflow, triggerNode]);

  function nextId(prefix: string): string {
    let index = 1;
    while (workflow.nodes.some(n => n.id === `${prefix}-${index}`)) index += 1;
    return `${prefix}-${index}`;
  }

  /** Último node da cadeia principal — onde um novo bloco é encaixado. */
  function tailId(): string {
    return chain.length > 0 ? chain[chain.length - 1].id : (triggerNode?.id ?? 'trigger');
  }

  function appendNode(node: AutomationNode) {
    const from = tailId();
    setWorkflow(current => ({
      nodes: [...current.nodes, node],
      edges: [...current.edges, { from, to: node.id, branch: 'next' } as AutomationEdge],
    }));
    setEditingNodeId(node.id);
  }

  function updateNode(nodeId: string, patch: Partial<AutomationNode>) {
    setWorkflow(current => ({
      ...current,
      nodes: current.nodes.map(n => (n.id === nodeId ? ({ ...n, ...patch } as AutomationNode) : n)),
    }));
  }

  /** Trocar o gatilho invalida condições e ações que dependiam dos campos antigos.
   *
   *  Em vez de deixar um workflow silenciosamente quebrado, limpa tudo depois do
   *  trigger. É destrutivo, então avisa antes. */
  function changeTrigger(newTrigger: string) {
    const hasDownstream = workflow.nodes.length > 1;
    if (
      hasDownstream &&
      !window.confirm('Trocar o gatilho remove as condições e ações já configuradas, porque os campos disponíveis mudam. Continuar?')
    ) {
      return;
    }

    setWorkflow({
      nodes: [
        {
          id: triggerNode?.id ?? 'trigger',
          type: 'trigger',
          triggerType: newTrigger,
          label: isKnownTrigger(newTrigger) ? TRIGGERS[newTrigger].label : newTrigger,
          config: {},
        },
      ],
      edges: [],
    });
  }

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

  const editingNode = workflow.nodes.find(n => n.id === editingNodeId) ?? null;

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
            <Input
              className="mt-2"
              value={name}
              disabled={!canManage}
              onChange={e => setName(e.target.value)}
              placeholder="Recontagem automática"
            />
          </label>
          <label className="block">
            <span className="text-overline">Descrição</span>
            <Input
              className="mt-2"
              value={description}
              disabled={!canManage}
              onChange={e => setDescription(e.target.value)}
              placeholder="O que esta automação resolve"
            />
          </label>
        </PanelSection>
      </Panel>

      {/* ── Problemas de validação ─────────────────────────────────────────── */}
      {validation.problems.length > 0 && (
        <Panel>
          <PanelSection>
            <h3 className="text-section flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-500" />
              {validation.valid ? 'Avisos' : 'Corrija para poder ativar'}
            </h3>
            <ul className="mt-3 space-y-1.5">
              {validation.problems.map((problem, index) => (
                <li
                  key={index}
                  className={`text-sm leading-relaxed ${
                    problem.severity === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {problem.message}
                </li>
              ))}
            </ul>
          </PanelSection>
        </Panel>
      )}

      {/* ── O fluxo ────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection>
          <h3 className="text-section">Fluxo</h3>
          <p className="mt-1 text-sm text-fg-muted">Clique em um bloco para configurá-lo.</p>
        </PanelSection>

        <PanelSection>
          <AutomationCanvas
            workflow={workflow}
            canManage={canManage}
            // Destaca o primeiro bloco com erro: sem isso, a lista de problemas obriga
            // o usuário a procurar qual bloco é.
            highlightNodeId={validation.problems.find(p => p.severity === 'error')?.nodeId ?? null}
            onChange={setWorkflow}
            onEditNode={setEditingNodeId}
          />
        </PanelSection>

        {canManage && (
          <PanelSection className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const id = nextId('condition');
                appendNode({
                  id,
                  type: 'condition',
                  label: 'Nova condição',
                  logic: 'AND',
                  rules: [],
                } as ConditionNode);
              }}
            >
              <Plus size={14} />
              Condição
            </Button>

            <Button
              variant="secondary"
              size="sm"
              // Sem limite de ramificações: a restrição de uma só era do editor
              // vertical, que desenhava um par fixo de pernas. O canvas desenha
              // qualquer grafo, e o engine sempre soube executá-lo.
              onClick={() => {
                const id = nextId('branch');
                appendNode({
                  id,
                  type: 'branch',
                  label: 'Nova ramificação',
                  logic: 'AND',
                  rules: [],
                } as BranchNode);
              }}
            >
              <GitBranch size={14} />
              Ramificação
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => appendNode({ id: nextId('delay'), type: 'delay', label: 'Esperar', minutes: 30 })}
            >
              <Clock size={14} />
              Espera
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                appendNode({
                  id: nextId('switch'),
                  type: 'switch',
                  label: 'Nova escolha',
                  field: fieldsForTrigger(triggerType)[0]?.path ?? '',
                  cases: [],
                })
              }
            >
              <Shuffle size={14} />
              Escolha
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const available = actionsForTrigger(triggerType);
                const first = (available[0]?.key ?? 'create_notification') as ActionKey;
                const id = nextId('action');
                appendNode({
                  id,
                  type: 'action',
                  label: ACTIONS[first].label,
                  actionType: first,
                  config: first === 'create_notification' ? { severity: 'warning' } : {},
                } as ActionNode);
              }}
            >
              <Plus size={14} />
              Ação
            </Button>
          </PanelSection>
        )}
      </Panel>

      {/* ── Salvar / ativar / testar ───────────────────────────────────────── */}
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
                  setFeedback({
                    tone: 'error',
                    text: thrown instanceof Error ? thrown.message : 'Não foi possível ativar.',
                  });
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
                  try {
                    const result = await runAutomationManually(automation.id, { dryRun: true });
                    setFeedback({ tone: result.ok ? 'ok' : 'error', text: result.message });
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
              O teste avalia o fluxo e registra a execução, mas não aplica as ações que alteram
              dados.
            </p>
          </PanelSection>
        </Panel>
      )}

      {/* ── Painel do node ─────────────────────────────────────────────────── */}
      <Modal
        open={editingNode != null}
        onClose={() => setEditingNodeId(null)}
        title={editingNode?.label ?? 'Configurar bloco'}
        maxWidth="max-w-2xl"
      >
        {editingNode != null && (
          <NodeEditorBody
            node={editingNode}
            triggerType={triggerType}
            canManage={canManage}
            onChangeTrigger={changeTrigger}
            onChange={patch => updateNode(editingNode.id, patch)}
            onDone={() => setEditingNodeId(null)}
          />
        )}
      </Modal>
    </Page>
  );
}

// ── Blocos visuais ──────────────────────────────────────────────────────────


// ── Editor do node ──────────────────────────────────────────────────────────

function NodeEditorBody({
  node,
  triggerType,
  canManage,
  onChangeTrigger,
  onChange,
  onDone,
}: {
  node: AutomationNode;
  triggerType: string;
  canManage: boolean;
  onChangeTrigger: (trigger: string) => void;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDone: () => void;
}) {
  if (node.type === 'trigger') {
    const grouped = TRIGGER_KEYS.reduce<Record<string, TriggerKey[]>>((acc, key) => {
      const group = TRIGGERS[key].group;
      acc[group] = [...(acc[group] ?? []), key];
      return acc;
    }, {});

    return (
      <div className="space-y-4">
        <label className="block">
          <span className="text-overline">Quando isso acontecer</span>
          <Select
            className="mt-2"
            value={node.triggerType}
            disabled={!canManage}
            onChange={e => onChangeTrigger(e.target.value)}
          >
            {Object.entries(grouped).map(([group, keys]) => (
              <optgroup key={group} label={group}>
                {keys.map(key => (
                  <option key={key} value={key}>
                    {TRIGGERS[key].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>

        {isKnownTrigger(node.triggerType) && (
          <p className="text-sm leading-relaxed text-fg-muted">{TRIGGERS[node.triggerType].description}</p>
        )}

        <Button onClick={onDone}>Pronto</Button>
      </div>
    );
  }

  if (node.type === 'condition' || node.type === 'branch') {
    return (
      <ConditionEditor
        node={node}
        triggerType={triggerType}
        canManage={canManage}
        onChange={onChange}
        onDone={onDone}
      />
    );
  }

  if (node.type === 'delay') {
    return <DelayEditor node={node} canManage={canManage} onChange={onChange} onDone={onDone} />;
  }

  if (node.type === 'switch') {
    return <SwitchEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} onDone={onDone} />;
  }

  return <ActionEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} onDone={onDone} />;
}

function ConditionEditor({
  node,
  triggerType,
  canManage,
  onChange,
  onDone,
}: {
  node: ConditionNode | BranchNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDone: () => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  function setRule(index: number, patch: Partial<ConditionRule>) {
    onChange({
      rules: node.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    } as Partial<AutomationNode>);
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-overline">Nome do bloco</span>
        <Input className="mt-2" value={node.label ?? ''} disabled={!canManage} onChange={e => onChange({ label: e.target.value })} />
      </label>

      {node.rules.length > 1 && (
        <label className="block">
          <span className="text-overline">Combinar condições com</span>
          <Select
            className="mt-2"
            value={node.logic}
            disabled={!canManage}
            onChange={e => onChange({ logic: e.target.value as 'AND' | 'OR' } as Partial<AutomationNode>)}
          >
            <option value="AND">E — todas precisam ser verdadeiras</option>
            <option value="OR">OU — basta uma ser verdadeira</option>
          </Select>
        </label>
      )}

      <div className="space-y-3">
        {node.rules.map((rule, index) => {
          const field = findField(triggerType, rule.field);
          const operators = field ? operatorsForKind(field.kind) : Object.values(OPERATORS);
          const operator = OPERATORS[rule.operator as OperatorKey];

          return (
            <div key={index} className="rounded-container border border-edge p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={rule.field}
                  disabled={!canManage}
                  onChange={e => {
                    // Ao trocar o campo, o operador pode não servir mais para o novo
                    // tipo. Reposiciona no primeiro válido em vez de deixar uma
                    // combinação que a validação recusaria.
                    const next = findField(triggerType, e.target.value);
                    const valid = next ? operatorsForKind(next.kind) : [];
                    const keep = valid.some(o => o.key === rule.operator);
                    setRule(index, {
                      field: e.target.value,
                      operator: keep ? rule.operator : (valid[0]?.key ?? 'equals'),
                    });
                  }}
                >
                  <option value="">Selecione o campo…</option>
                  {fields.map(f => (
                    <option key={f.path} value={f.path}>
                      {f.label}
                    </option>
                  ))}
                </Select>

                <Select value={rule.operator} disabled={!canManage} onChange={e => setRule(index, { operator: e.target.value })}>
                  {operators.map(o => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </Select>

                {operator?.needsValue !== false && (
                  <Input
                    type={field?.kind === 'number' ? 'number' : 'text'}
                    value={String(rule.value ?? '')}
                    disabled={!canManage}
                    placeholder={operator?.valueIsList ? 'A, B, C' : 'Valor'}
                    onChange={e => setRule(index, { value: e.target.value })}
                  />
                )}
              </div>

              {field?.hint && <p className="mt-2 text-xs leading-relaxed text-fg-subtle">{field.hint}</p>}

              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    onChange({ rules: node.rules.filter((_, i) => i !== index) } as Partial<AutomationNode>)
                  }
                >
                  <Trash2 size={12} />
                  Remover condição
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange({
              rules: [
                ...node.rules,
                { field: fields[0]?.path ?? '', operator: 'equals', value: '' },
              ],
            } as Partial<AutomationNode>)
          }
        >
          <Plus size={13} />
          Adicionar condição
        </Button>
      )}

      <div className="border-t border-edge pt-4">
        <Button onClick={onDone}>Pronto</Button>
      </div>
    </div>
  );
}

function ActionEditor({
  node,
  triggerType,
  canManage,
  onChange,
  onDone,
}: {
  node: ActionNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDone: () => void;
}) {
  // Só ações compatíveis com o gatilho. Oferecer todas e deixar a validação recusar
  // depois faria o usuário configurar algo que não pode funcionar.
  const available = actionsForTrigger(triggerType);
  const definition = node.actionType in ACTIONS ? ACTIONS[node.actionType as ActionKey] : null;
  const fields = fieldsForTrigger(triggerType);

  function setConfig(key: string, value: unknown) {
    onChange({ config: { ...node.config, [key]: value } } as Partial<AutomationNode>);
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-overline">Ação</span>
        <Select
          className="mt-2"
          value={node.actionType}
          disabled={!canManage}
          onChange={e => {
            const key = e.target.value as ActionKey;
            // Config é zerada: os parâmetros de uma ação não valem para outra, e
            // manter o antigo deixaria chaves órfãs no jsonb.
            onChange({
              actionType: key,
              label: ACTIONS[key].label,
              config: key === 'create_notification' ? { severity: 'warning' } : {},
            } as Partial<AutomationNode>);
          }}
        >
          {available.map(action => (
            <option key={action.key} value={action.key}>
              {action.label}
            </option>
          ))}
        </Select>
      </label>

      {definition && <p className="text-sm leading-relaxed text-fg-muted">{definition.description}</p>}

      {definition?.params.map(param => (
        <label key={param.key} className="block">
          <span className="text-overline">
            {param.label}
            {!param.required && <span className="ml-1 normal-case text-fg-subtle">(opcional)</span>}
          </span>

          {param.kind === 'select' ? (
            <Select
              className="mt-2"
              value={String(node.config[param.key] ?? param.options?.[0]?.value ?? '')}
              disabled={!canManage}
              onChange={e => setConfig(param.key, e.target.value)}
            >
              {param.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : param.kind === 'textarea' ? (
            <Textarea
              className="mt-2"
              rows={3}
              value={String(node.config[param.key] ?? '')}
              disabled={!canManage}
              placeholder={param.placeholder}
              onChange={e => setConfig(param.key, e.target.value)}
            />
          ) : (
            <Input
              className="mt-2"
              type={param.kind === 'number' ? 'number' : 'text'}
              value={String(node.config[param.key] ?? '')}
              disabled={!canManage}
              placeholder={param.placeholder}
              onChange={e => setConfig(param.key, e.target.value)}
            />
          )}

          {param.hint && <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">{param.hint}</p>}

          {/* Variáveis disponíveis, clicáveis. É o que substitui digitar caminho de
              cabeça e errar — a validação recusaria depois, mas descobrir aqui é
              melhor. */}
          {param.interpolable && canManage && fields.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-fg-subtle">Inserir variável:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {fields.slice(0, 10).map(field => (
                  <button
                    key={field.path}
                    type="button"
                    onClick={() =>
                      setConfig(param.key, `${String(node.config[param.key] ?? '')}{{${field.path}}}`)
                    }
                    className="rounded-control border border-edge bg-surface-3 px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                  >
                    {field.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </label>
      ))}

      {definition?.external && (
        <div className="rounded-container border border-edge bg-surface-3 px-3 py-2">
          <p className="text-xs leading-relaxed text-fg-subtle">
            Ação externa: até 3 tentativas em caso de falha temporária. Endereços internos e sem
            HTTPS são recusados.
          </p>
        </div>
      )}

      {definition?.idempotent === false && (
        <div className="rounded-container border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            Esta ação não pode ser repetida sem efeito duplicado, por isso não é retentada
            automaticamente.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-edge pt-4">
        <Button onClick={onDone}>Pronto</Button>
        {definition && <Badge variant="neutral">{definition.group}</Badge>}
      </div>
    </div>
  );
}

// ── Editores dos nodes novos ────────────────────────────────────────────────

function DelayEditor({
  node,
  canManage,
  onChange,
  onDone,
}: {
  node: DelayNode;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-overline">Nome do bloco</span>
        <Input className="mt-2" value={node.label ?? ''} disabled={!canManage} onChange={e => onChange({ label: e.target.value })} />
      </label>

      <label className="block">
        <span className="text-overline">Esperar (minutos)</span>
        <Input
          className="mt-2"
          type="number"
          min={1}
          max={60 * 24 * 7}
          value={node.minutes}
          disabled={!canManage}
          onChange={e => onChange({ minutes: Number(e.target.value) } as Partial<AutomationNode>)}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
          Mínimo de 1 minuto, máximo de 7 dias. A execução é interrompida aqui e continua depois —
          por isso a precisão é ao minuto, não ao segundo.
        </p>
      </label>

      <div className="rounded-container border border-edge bg-surface-3 px-3 py-2">
        <p className="text-xs leading-relaxed text-fg-subtle">
          No histórico, a espera aparece como duas execuções ligadas: a primeira termina no bloco
          de espera, e a continuação registra de onde retomou.
        </p>
      </div>

      <div className="border-t border-edge pt-4">
        <Button onClick={onDone}>Pronto</Button>
      </div>
    </div>
  );
}

function SwitchEditor({
  node,
  triggerType,
  canManage,
  onChange,
  onDone,
}: {
  node: SwitchNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDone: () => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-overline">Nome do bloco</span>
        <Input className="mt-2" value={node.label ?? ''} disabled={!canManage} onChange={e => onChange({ label: e.target.value })} />
      </label>

      <label className="block">
        <span className="text-overline">Campo a comparar</span>
        <Select
          className="mt-2"
          value={node.field}
          disabled={!canManage}
          onChange={e => onChange({ field: e.target.value } as Partial<AutomationNode>)}
        >
          <option value="">Selecione o campo…</option>
          {fields.map(field => (
            <option key={field.path} value={field.path}>
              {field.label}
            </option>
          ))}
        </Select>
      </label>

      <div className="space-y-2">
        <span className="text-overline">Casos</span>
        {node.cases.map((candidate, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={candidate.value}
              disabled={!canManage}
              placeholder="Valor"
              onChange={e =>
                onChange({
                  cases: node.cases.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)),
                } as Partial<AutomationNode>)
              }
            />
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({ cases: node.cases.filter((_, i) => i !== index) } as Partial<AutomationNode>)
                }
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        ))}

        {canManage && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange({ cases: [...node.cases, { value: '' }] } as Partial<AutomationNode>)}
          >
            <Plus size={13} />
            Adicionar caso
          </Button>
        )}

        <p className="text-xs leading-relaxed text-fg-subtle">
          Cada caso vira uma saída. A comparação ignora maiúsculas e espaços nas pontas. Ligue também
          a saída padrão — sem ela, um valor fora da lista encerra o fluxo em silêncio.
        </p>
      </div>

      <div className="border-t border-edge pt-4">
        <Button onClick={onDone}>Pronto</Button>
      </div>
    </div>
  );
}
