import { AlertTriangle, Copy, Trash2, X } from 'lucide-react';
import { Badge, Button, Input, Select, Textarea } from '../../ui';
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
} from '../../../lib/automation/registry';
import { MAX_LOOP_ITERATIONS_LIMIT } from '../../../lib/automation/workflow';
import type { ValidationProblem } from '../../../lib/automation/workflow';
import { NODE_META, describeNode } from '../../../lib/automation/nodeMeta';
import type {
  ActionNode,
  AgentNode,
  AutomationNode,
  BranchNode,
  ConditionNode,
  ConditionRule,
  DelayNode,
  LoopNode,
  SwitchNode,
  WebhookWaitNode,
} from '../../../lib/automation/types';

interface Props {
  node: AutomationNode;
  triggerType: string;
  canManage: boolean;
  problems: ValidationProblem[];
  onChangeTrigger: (trigger: string) => void;
  onChange: (patch: Partial<AutomationNode>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Painel de configuração, lateral em vez de modal central (§15) — mesma
 *  lógica de edição que já existia em AutomationEditor.tsx, só realocada.
 *  ConditionEditor/ActionEditor/DelayEditor/SwitchEditor vieram sem mudança de
 *  comportamento; LoopEditor/WebhookWaitEditor/AgentEditor são novos — os 3
 *  tipos já executavam no engine e já eram validados, mas não tinham como ser
 *  configurados pela tela. */
export function NodeConfigPanel({ node, triggerType, canManage, problems, onChangeTrigger, onChange, onDuplicate, onRemove, onClose }: Props) {
  const meta = NODE_META[node.type];
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-40 flex flex-col border-l border-edge bg-surface-2 md:relative md:inset-auto md:z-auto md:h-full md:w-80 md:flex-shrink-0">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <Icon size={15} className={meta.colorClass} />
        <div className="min-w-0 flex-1">
          <p className="text-overline">{meta.kindLabel}</p>
          <p className="truncate text-sm font-medium text-fg">{node.label ?? describeNode(node)}</p>
        </div>
        <button onClick={onClose} className="rounded p-1 text-fg-subtle transition-colors hover:text-fg" aria-label="Fechar painel">
          <X size={16} />
        </button>
      </div>

      {problems.length > 0 && (
        <div className="border-b border-edge bg-amber-500/5 px-4 py-2.5">
          {problems.map((problem, index) => (
            <p
              key={index}
              className={`flex items-start gap-1.5 text-xs leading-relaxed ${
                problem.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              {problem.message}
            </p>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <NodeConfigBody node={node} triggerType={triggerType} canManage={canManage} onChangeTrigger={onChangeTrigger} onChange={onChange} />
      </div>

      {canManage && (
        <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
          <Button size="sm" onClick={onClose}>Pronto</Button>
          <Button variant="secondary" size="sm" onClick={onDuplicate}>
            <Copy size={13} />
            Duplicar
          </Button>
          {node.type !== 'trigger' && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 size={13} />
              Excluir
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NodeConfigBody({
  node,
  triggerType,
  canManage,
  onChangeTrigger,
  onChange,
}: {
  node: AutomationNode;
  triggerType: string;
  canManage: boolean;
  onChangeTrigger: (trigger: string) => void;
  onChange: (patch: Partial<AutomationNode>) => void;
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
          <Select className="mt-2" value={node.triggerType} disabled={!canManage} onChange={e => onChangeTrigger(e.target.value)}>
            {Object.entries(grouped).map(([group, keys]) => (
              <optgroup key={group} label={group}>
                {keys.map(key => (
                  <option key={key} value={key}>{TRIGGERS[key].label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>

        {isKnownTrigger(node.triggerType) && (
          <p className="text-sm leading-relaxed text-fg-muted">{TRIGGERS[node.triggerType].description}</p>
        )}
      </div>
    );
  }

  if (node.type === 'condition' || node.type === 'branch') {
    return <ConditionEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} />;
  }
  if (node.type === 'delay') return <DelayEditor node={node} canManage={canManage} onChange={onChange} />;
  if (node.type === 'switch') return <SwitchEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} />;
  if (node.type === 'loop') return <LoopEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} />;
  if (node.type === 'webhook_wait') return <WebhookWaitEditor node={node} canManage={canManage} onChange={onChange} />;
  if (node.type === 'agent') return <AgentEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} />;
  return <ActionEditor node={node} triggerType={triggerType} canManage={canManage} onChange={onChange} />;
}

function LabelField({ label, canManage, onChange }: { label: string | undefined; canManage: boolean; onChange: (patch: Partial<AutomationNode>) => void }) {
  return (
    <label className="block">
      <span className="text-overline">Nome do bloco</span>
      <Input className="mt-2" value={label ?? ''} disabled={!canManage} onChange={e => onChange({ label: e.target.value })} />
    </label>
  );
}

function ConditionEditor({
  node,
  triggerType,
  canManage,
  onChange,
}: {
  node: ConditionNode | BranchNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  function setRule(index: number, patch: Partial<ConditionRule>) {
    onChange({ rules: node.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) } as Partial<AutomationNode>);
  }

  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

      {node.rules.length > 1 && (
        <label className="block">
          <span className="text-overline">Combinar condições com</span>
          <Select className="mt-2" value={node.logic} disabled={!canManage} onChange={e => onChange({ logic: e.target.value as 'AND' | 'OR' } as Partial<AutomationNode>)}>
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
              <div className="grid gap-2">
                <Select
                  value={rule.field}
                  disabled={!canManage}
                  onChange={e => {
                    const next = findField(triggerType, e.target.value);
                    const valid = next ? operatorsForKind(next.kind) : [];
                    const keep = valid.some(o => o.key === rule.operator);
                    setRule(index, { field: e.target.value, operator: keep ? rule.operator : (valid[0]?.key ?? 'equals') });
                  }}
                >
                  <option value="">Selecione o campo…</option>
                  {fields.map(f => (
                    <option key={f.path} value={f.path}>{f.label}</option>
                  ))}
                </Select>

                <Select value={rule.operator} disabled={!canManage} onChange={e => setRule(index, { operator: e.target.value })}>
                  {operators.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
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
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange({ rules: node.rules.filter((_, i) => i !== index) } as Partial<AutomationNode>)}>
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
          onClick={() => onChange({ rules: [...node.rules, { field: fields[0]?.path ?? '', operator: 'equals', value: '' }] } as Partial<AutomationNode>)}
        >
          Adicionar condição
        </Button>
      )}
    </div>
  );
}

function ActionEditor({
  node,
  triggerType,
  canManage,
  onChange,
}: {
  node: ActionNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
}) {
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
            onChange({ actionType: key, label: ACTIONS[key].label, config: key === 'create_notification' ? { severity: 'warning' } : {} } as Partial<AutomationNode>);
          }}
        >
          {available.map(action => (
            <option key={action.key} value={action.key}>{action.label}</option>
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
            <Select className="mt-2" value={String(node.config[param.key] ?? param.options?.[0]?.value ?? '')} disabled={!canManage} onChange={e => setConfig(param.key, e.target.value)}>
              {param.options?.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          ) : param.kind === 'textarea' ? (
            <Textarea className="mt-2" rows={3} value={String(node.config[param.key] ?? '')} disabled={!canManage} placeholder={param.placeholder} onChange={e => setConfig(param.key, e.target.value)} />
          ) : (
            <Input className="mt-2" type={param.kind === 'number' ? 'number' : 'text'} value={String(node.config[param.key] ?? '')} disabled={!canManage} placeholder={param.placeholder} onChange={e => setConfig(param.key, e.target.value)} />
          )}

          {param.hint && <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">{param.hint}</p>}

          {param.interpolable && canManage && fields.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-fg-subtle">Inserir variável:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {fields.slice(0, 10).map(field => (
                  <button
                    key={field.path}
                    type="button"
                    onClick={() => setConfig(param.key, `${String(node.config[param.key] ?? '')}{{${field.path}}}`)}
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
          <p className="text-xs leading-relaxed text-fg-subtle">Ação externa: até 3 tentativas em caso de falha temporária. Endereços internos e sem HTTPS são recusados.</p>
        </div>
      )}

      {definition?.idempotent === false && (
        <div className="rounded-container border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">Esta ação não pode ser repetida sem efeito duplicado, por isso não é retentada automaticamente.</p>
        </div>
      )}

      {definition && (
        <div className="pt-1">
          <Badge variant="neutral">{definition.group}</Badge>
        </div>
      )}
    </div>
  );
}

function DelayEditor({ node, canManage, onChange }: { node: DelayNode; canManage: boolean; onChange: (patch: Partial<AutomationNode>) => void }) {
  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

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
          Mínimo de 1 minuto, máximo de 7 dias. A execução é interrompida aqui e continua depois — por isso a precisão é ao minuto, não ao segundo.
        </p>
      </label>

      <div className="rounded-container border border-edge bg-surface-3 px-3 py-2">
        <p className="text-xs leading-relaxed text-fg-subtle">
          No histórico, a espera aparece como duas execuções ligadas: a primeira termina no bloco de espera, e a continuação registra de onde retomou.
        </p>
      </div>
    </div>
  );
}

function SwitchEditor({
  node,
  triggerType,
  canManage,
  onChange,
}: {
  node: SwitchNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

      <label className="block">
        <span className="text-overline">Campo a comparar</span>
        <Select className="mt-2" value={node.field} disabled={!canManage} onChange={e => onChange({ field: e.target.value } as Partial<AutomationNode>)}>
          <option value="">Selecione o campo…</option>
          {fields.map(field => (
            <option key={field.path} value={field.path}>{field.label}</option>
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
              onChange={e => onChange({ cases: node.cases.map((c, i) => (i === index ? { ...c, value: e.target.value } : c)) } as Partial<AutomationNode>)}
            />
            {canManage && (
              <Button variant="ghost" size="sm" onClick={() => onChange({ cases: node.cases.filter((_, i) => i !== index) } as Partial<AutomationNode>)}>
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        ))}

        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => onChange({ cases: [...node.cases, { value: '' }] } as Partial<AutomationNode>)}>
            Adicionar caso
          </Button>
        )}

        <p className="text-xs leading-relaxed text-fg-subtle">
          Cada caso vira uma saída. A comparação ignora maiúsculas e espaços nas pontas. Ligue também a saída padrão — sem ela, um valor fora da lista encerra o fluxo em silêncio.
        </p>
      </div>
    </div>
  );
}

function LoopEditor({
  node,
  triggerType,
  canManage,
  onChange,
}: {
  node: LoopNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

      <label className="block">
        <span className="text-overline">Lista a percorrer</span>
        <Input
          className="mt-2"
          value={node.field}
          disabled={!canManage}
          placeholder="trigger.webhook.body.itens"
          onChange={e => onChange({ field: e.target.value } as Partial<AutomationNode>)}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">Caminho para uma lista no contexto do gatilho.</p>
        {fields.length > 0 && canManage && (
          <div className="mt-2 flex flex-wrap gap-1">
            {fields.slice(0, 10).map(field => (
              <button
                key={field.path}
                type="button"
                onClick={() => onChange({ field: field.path } as Partial<AutomationNode>)}
                className="rounded-control border border-edge bg-surface-3 px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
              >
                {field.label}
              </button>
            ))}
          </div>
        )}
      </label>

      <label className="block">
        <span className="text-overline">Máximo de iterações</span>
        <Input
          className="mt-2"
          type="number"
          min={1}
          max={MAX_LOOP_ITERATIONS_LIMIT}
          value={node.maxIterations}
          disabled={!canManage}
          onChange={e => onChange({ maxIterations: Number(e.target.value) } as Partial<AutomationNode>)}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
          O laço roda inteiro dentro de uma execução (sem interrupção), então precisa de um teto — até {MAX_LOOP_ITERATIONS_LIMIT}. Blocos que pausam a execução (espera, aguardar retorno) não podem ficar dentro dele.
        </p>
      </label>
    </div>
  );
}

function WebhookWaitEditor({ node, canManage, onChange }: { node: WebhookWaitNode; canManage: boolean; onChange: (patch: Partial<AutomationNode>) => void }) {
  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

      <label className="block">
        <span className="text-overline">Prazo de espera (minutos)</span>
        <Input
          className="mt-2"
          type="number"
          min={1}
          max={60 * 24 * 7}
          value={node.timeoutMinutes}
          disabled={!canManage}
          onChange={e => onChange({ timeoutMinutes: Number(e.target.value) } as Partial<AutomationNode>)}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
          Se o sistema externo não chamar de volta dentro do prazo, a execução é encerrada sem continuar — um prazo é obrigatório para a espera não ficar pendente para sempre.
        </p>
      </label>

      <div className="rounded-container border border-edge bg-surface-3 px-3 py-2">
        <p className="text-xs leading-relaxed text-fg-subtle">Reusa a mesma mecânica de retomada da espera por tempo: a execução para, grava onde continuar, e a chamada de retorno retoma.</p>
      </div>
    </div>
  );
}

function AgentEditor({
  node,
  triggerType,
  canManage,
  onChange,
}: {
  node: AgentNode;
  triggerType: string;
  canManage: boolean;
  onChange: (patch: Partial<AutomationNode>) => void;
}) {
  const fields = fieldsForTrigger(triggerType);

  return (
    <div className="space-y-4">
      <LabelField label={node.label} canManage={canManage} onChange={onChange} />

      <label className="block">
        <span className="text-overline">Instrução para a IA</span>
        <Textarea
          className="mt-2"
          rows={5}
          value={node.prompt}
          disabled={!canManage}
          placeholder="Resuma a divergência encontrada em uma frase curta para a notificação."
          onChange={e => onChange({ prompt: e.target.value } as Partial<AutomationNode>)}
        />
        {fields.length > 0 && canManage && (
          <div className="mt-2">
            <p className="text-xs text-fg-subtle">Inserir variável:</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {fields.slice(0, 10).map(field => (
                <button
                  key={field.path}
                  type="button"
                  onClick={() => onChange({ prompt: `${node.prompt}{{${field.path}}}` } as Partial<AutomationNode>)}
                  className="rounded-control border border-edge bg-surface-3 px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                >
                  {field.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </label>

      <label className="block">
        <span className="text-overline">
          Teto de tokens da resposta<span className="ml-1 normal-case text-fg-subtle">(opcional)</span>
        </span>
        <Input
          className="mt-2"
          type="number"
          min={1}
          value={node.maxTokens ?? ''}
          disabled={!canManage}
          placeholder="Sem teto configurado"
          onChange={e => onChange({ maxTokens: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<AutomationNode>)}
        />
      </label>

      <div className="rounded-container border border-edge bg-surface-3 px-3 py-2">
        <p className="text-xs leading-relaxed text-fg-subtle">
          Chama o BlindAI de verdade — sem simulação. Se a chave da IA não estiver configurada no servidor, o bloco falha com mensagem clara em vez de responder algo inventado.
        </p>
      </div>
    </div>
  );
}
