// Registry — o catálogo de blocos.
//
// Uma fonte única para: quais triggers existem, quais campos cada um oferece,
// quais operadores servem para cada tipo de campo, quais ações existem, que
// parâmetros aceitam e com quais triggers são compatíveis.
//
// ── Por que registry e não `if` espalhado ───────────────────────────────────
// Cinco consumidores leem exatamente a mesma informação: o editor (para montar os
// selects), o validador (para recusar configuração incompleta), o interpolador
// (para saber quais caminhos existem), o engine (para achar o executor) e os
// testes. Com a informação em um lugar, adicionar uma ação é UMA entrada aqui mais
// um executor — sem tocar em editor, validador ou engine.
//
// ── Compatibilidade trigger↔ação é dado, não documentação ──────────────────
// "Criar recontagem" só funciona sobre uma contagem FINALIZADA — a regra vem da
// 039 e vale para a variante da 051. Um usuário montando "item contado → criar
// recontagem" produziria uma automação que falha em toda execução. O registry
// declara isso em `compatibleTriggers` e a validação recusa antes de ativar, com
// o motivo. Deixar isso só no comentário seria empurrar para o usuário descobrir
// pelo log de erro.

import type { ConditionRule } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Campos e operadores
// ─────────────────────────────────────────────────────────────────────────────

export type FieldKind = 'number' | 'text' | 'boolean' | 'id';

export interface ContextField {
  /** Caminho dentro do contexto, ex. `trigger.count.variancePercentage`. */
  path: string;
  label: string;
  kind: FieldKind;
  /** Ajuda curta quando o nome não basta. */
  hint?: string;
}

export type OperatorKey =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in';

export interface OperatorDefinition {
  key: OperatorKey;
  label: string;
  /** Tipos de campo em que este operador faz sentido. `greater_than` num booleano
   *  não significa nada, e oferecê-lo produziria condições que nunca batem. */
  kinds: FieldKind[];
  /** Operadores de presença não têm valor a comparar. O editor esconde o campo. */
  needsValue: boolean;
  /** `in`/`not_in` recebem lista. */
  valueIsList?: boolean;
}

export const OPERATORS: Record<OperatorKey, OperatorDefinition> = {
  equals: { key: 'equals', label: 'É igual a', kinds: ['number', 'text', 'boolean', 'id'], needsValue: true },
  not_equals: { key: 'not_equals', label: 'É diferente de', kinds: ['number', 'text', 'boolean', 'id'], needsValue: true },
  greater_than: { key: 'greater_than', label: 'Maior que', kinds: ['number'], needsValue: true },
  greater_than_or_equal: { key: 'greater_than_or_equal', label: 'Maior ou igual a', kinds: ['number'], needsValue: true },
  less_than: { key: 'less_than', label: 'Menor que', kinds: ['number'], needsValue: true },
  less_than_or_equal: { key: 'less_than_or_equal', label: 'Menor ou igual a', kinds: ['number'], needsValue: true },
  contains: { key: 'contains', label: 'Contém', kinds: ['text'], needsValue: true },
  not_contains: { key: 'not_contains', label: 'Não contém', kinds: ['text'], needsValue: true },
  is_empty: { key: 'is_empty', label: 'Está vazio', kinds: ['number', 'text', 'boolean', 'id'], needsValue: false },
  is_not_empty: { key: 'is_not_empty', label: 'Não está vazio', kinds: ['number', 'text', 'boolean', 'id'], needsValue: false },
  in: { key: 'in', label: 'Está na lista', kinds: ['number', 'text', 'id'], needsValue: true, valueIsList: true },
  not_in: { key: 'not_in', label: 'Não está na lista', kinds: ['number', 'text', 'id'], needsValue: true, valueIsList: true },
};

export function operatorsForKind(kind: FieldKind): OperatorDefinition[] {
  return Object.values(OPERATORS).filter(op => op.kinds.includes(kind));
}

// ─────────────────────────────────────────────────────────────────────────────
// Triggers
// ─────────────────────────────────────────────────────────────────────────────

export type TriggerKey =
  | 'count.item_counted'
  | 'count.session_created'
  | 'count.session_started'
  | 'count.session_finalized'
  | 'stock.discrepancy_detected'
  | 'schedule'
  | 'webhook.received'
  | 'manual';

export interface TriggerDefinition {
  key: TriggerKey;
  label: string;
  description: string;
  /** Grupo no seletor, para a lista não virar uma coluna de vinte itens soltos. */
  group: string;
  /** Campos que as condições e a interpolação podem usar. É a lista fechada que
   *  substitui expressão arbitrária: o que não está aqui não existe. */
  fields: ContextField[];
  /** Como o evento nasce: trigger de banco (051), agendador (053), webhook de
   *  entrada (053) ou acionamento manual. */
  emittedBy: 'database' | 'manual' | 'schedule' | 'webhook';
}

const SESSION_FIELDS: ContextField[] = [
  { path: 'trigger.session.id', label: 'ID da contagem', kind: 'id' },
  { path: 'trigger.session.countNumber', label: 'Rodada da contagem', kind: 'number', hint: '1, 2 ou 3' },
  { path: 'trigger.session.warehouse', label: 'Depósito', kind: 'text' },
  { path: 'trigger.session.area', label: 'Área', kind: 'text' },
  // A faixa de endereços é como o operador reconhece de qual contagem se trata —
  // muito mais do que pelo uuid. Emitida pelo trigger da 051.
  { path: 'trigger.session.streetFrom', label: 'Localização inicial', kind: 'text' },
  { path: 'trigger.session.streetTo', label: 'Localização final', kind: 'text' },
  { path: 'trigger.session.responsibleId', label: 'Responsável', kind: 'id' },
  { path: 'trigger.session.totalItems', label: 'Total de itens', kind: 'number' },
  { path: 'trigger.session.status', label: 'Situação', kind: 'text' },
];

const DIVERGENCE_FIELDS: ContextField[] = [
  { path: 'trigger.divergence.divergentItemPercentage', label: '% de itens divergentes', kind: 'number' },
  {
    path: 'trigger.divergence.unitDeviationPercentage',
    label: '% de desvio de unidades',
    kind: 'number',
    hint: 'Quando o ERP indica saldo zero, a base passa a ser o total encontrado.',
  },
  { path: 'trigger.divergence.divergentItems', label: 'Itens divergentes', kind: 'number' },
  { path: 'trigger.divergence.countedItems', label: 'Itens contados', kind: 'number' },
  { path: 'trigger.divergence.absoluteUnitDeviation', label: 'Desvio em unidades', kind: 'number' },
  { path: 'trigger.divergence.hasDivergence', label: 'Tem divergência', kind: 'boolean' },
];

export const TRIGGERS: Record<TriggerKey, TriggerDefinition> = {
  'count.item_counted': {
    key: 'count.item_counted',
    label: 'Item contado',
    description: 'Um item de contagem física recebeu quantidade, ou teve a quantidade alterada.',
    group: 'Contagem',
    emittedBy: 'database',
    fields: [
      { path: 'trigger.item.id', label: 'ID do item', kind: 'id' },
      { path: 'trigger.item.sku', label: 'SKU', kind: 'text' },
      { path: 'trigger.item.ean', label: 'EAN', kind: 'text' },
      { path: 'trigger.item.location', label: 'Localização', kind: 'text' },
      { path: 'trigger.session.id', label: 'ID da contagem', kind: 'id' },
      { path: 'trigger.count.variancePercentage', label: 'Divergência percentual do item', kind: 'number' },
      { path: 'trigger.count.absoluteDifference', label: 'Diferença em unidades', kind: 'number' },
      { path: 'trigger.count.difference', label: 'Diferença com sinal', kind: 'number', hint: 'Negativo = falta' },
      { path: 'trigger.count.erpQuantity', label: 'Saldo no ERP', kind: 'number' },
      { path: 'trigger.count.totalFound', label: 'Total encontrado', kind: 'number' },
      { path: 'trigger.count.isDivergent', label: 'É divergente', kind: 'boolean' },
    ],
  },
  'count.session_created': {
    key: 'count.session_created',
    label: 'Contagem criada',
    description: 'Uma nova sessão de contagem física foi criada.',
    group: 'Contagem',
    emittedBy: 'database',
    fields: [
      ...SESSION_FIELDS,
      {
        path: 'trigger.session.isRecount',
        label: 'É recontagem',
        kind: 'boolean',
        hint: 'Use para a automação não reagir à recontagem que ela mesma pediu.',
      },
    ],
  },
  'count.session_started': {
    key: 'count.session_started',
    label: 'Contagem iniciada',
    description: 'Uma sessão de contagem passou para em andamento.',
    group: 'Contagem',
    emittedBy: 'database',
    fields: [...SESSION_FIELDS, ...DIVERGENCE_FIELDS],
  },
  'count.session_finalized': {
    key: 'count.session_finalized',
    label: 'Contagem finalizada',
    description: 'Uma sessão de contagem foi fechada, com ou sem divergência.',
    group: 'Contagem',
    emittedBy: 'database',
    fields: [...SESSION_FIELDS, ...DIVERGENCE_FIELDS],
  },
  'stock.discrepancy_detected': {
    key: 'stock.discrepancy_detected',
    label: 'Divergência de estoque detectada',
    description: 'A sincronização com o ERP encontrou uma divergência de saldo.',
    group: 'Integração',
    emittedBy: 'database',
    fields: [
      { path: 'trigger.conflict.id', label: 'ID da divergência', kind: 'id' },
      { path: 'trigger.conflict.connectionId', label: 'Conexão', kind: 'id' },
      { path: 'trigger.conflict.entityType', label: 'Tipo de entidade', kind: 'text' },
      { path: 'trigger.conflict.externalId', label: 'ID no provedor', kind: 'text' },
    ],
  },
  schedule: {
    key: 'schedule',
    label: 'Horário agendado',
    description:
      'Roda sozinha no horário configurado. O agendamento fica na própria automação e é calculado no fuso escolhido.',
    group: 'Sistema',
    emittedBy: 'schedule',
    fields: [
      { path: 'trigger.schedule.firedAt', label: 'Momento do disparo', kind: 'text' },
      { path: 'trigger.schedule.kind', label: 'Tipo de agendamento', kind: 'text' },
      { path: 'trigger.schedule.automationName', label: 'Nome da automação', kind: 'text' },
      { path: 'trigger.schedule.timezone', label: 'Fuso', kind: 'text' },
    ],
  },
  'webhook.received': {
    key: 'webhook.received',
    label: 'Webhook recebido',
    description:
      'Um sistema externo chamou o endereço desta automação. Cada automação tem endereço e segredo próprios, e a entrega é verificada por assinatura.',
    group: 'Sistema',
    emittedBy: 'webhook',
    fields: [
      { path: 'trigger.webhook.receivedAt', label: 'Recebido em', kind: 'text' },
      { path: 'trigger.webhook.automationId', label: 'ID da automação', kind: 'id' },
      // O corpo é do remetente, então não há campos folha conhecidos. Só a presença
      // é oferecida; para ler dentro do corpo, o caminho é digitado no campo de
      // variável, e a validação aceita qualquer coisa sob trigger.webhook.body.
      { path: 'trigger.webhook.body', label: 'Corpo recebido (objeto)', kind: 'text', hint: 'Use trigger.webhook.body.SEU_CAMPO para ler um campo específico.' },
      { path: 'trigger.webhook.raw', label: 'Corpo em texto', kind: 'text', hint: 'Preenchido quando o corpo não é JSON.' },
    ],
  },
  manual: {
    key: 'manual',
    label: 'Execução manual',
    description: 'Só roda quando alguém aciona pela tela. Útil para testar blocos.',
    group: 'Sistema',
    emittedBy: 'manual',
    fields: [],
  },
};

export const TRIGGER_KEYS = Object.keys(TRIGGERS) as TriggerKey[];

export function isKnownTrigger(key: string): key is TriggerKey {
  return key in TRIGGERS;
}

/** Campos disponíveis para um trigger, mais as saídas das ações já posicionadas
 *  antes do node em edição. */
export function fieldsForTrigger(triggerType: string): ContextField[] {
  return isKnownTrigger(triggerType) ? TRIGGERS[triggerType].fields : [];
}

export function findField(triggerType: string, path: string): ContextField | null {
  return fieldsForTrigger(triggerType).find(f => f.path === path) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type ActionKey =
  | 'create_recount'
  | 'create_notification'
  | 'create_alert'
  | 'add_session_note'
  | 'assign_responsible'
  | 'send_webhook';

export interface ActionParam {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'select' | 'url' | 'user';
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  /** Aceita `{{trigger.x.y}}`. O editor mostra o seletor de variáveis. */
  interpolable?: boolean;
}

export interface ActionDefinition {
  key: ActionKey;
  label: string;
  description: string;
  group: string;
  params: ActionParam[];
  /** Triggers em que esta ação pode rodar. `null` = qualquer um.
   *
   *  Não é preferência: é a regra de negócio da ação. Ver o comentário no topo. */
  compatibleTriggers: TriggerKey[] | null;
  /** Se repetir a ação com o mesmo contexto produz efeito duplicado. Governa
   *  retry: o que não é idempotente não é retentado. */
  idempotent: boolean;
  /** Toca sistema externo. Só estas suportam retry configurável. */
  external: boolean;
  /** Em execução de teste, a ação é apenas decidida e registrada, não aplicada. */
  skipOnDryRun: boolean;
}

export const ACTIONS: Record<ActionKey, ActionDefinition> = {
  create_recount: {
    key: 'create_recount',
    label: 'Criar recontagem',
    description:
      'Gera a rodada seguinte com apenas os itens divergentes, preservando o saldo do ERP capturado na contagem original.',
    group: 'Contagem',
    // Só sobre contagem finalizada: a regra vem de pc_create_recount_session (039)
    // e vale para automation_action_create_recount (051). Em 'item contado' a
    // sessão ainda está em andamento e a criação sempre falharia.
    compatibleTriggers: ['count.session_finalized'],
    // Criar duas recontagens da mesma contagem é exatamente o dano a evitar.
    idempotent: false,
    external: false,
    skipOnDryRun: true,
    params: [
      {
        key: 'responsibleId',
        label: 'Responsável pela recontagem',
        kind: 'user',
        required: false,
        hint: 'Em branco, mantém o responsável da contagem original.',
      },
    ],
  },

  create_notification: {
    key: 'create_notification',
    label: 'Criar notificação',
    description: 'Publica um aviso no InventoryBlind para a equipe da empresa.',
    group: 'Comunicação',
    compatibleTriggers: null,
    idempotent: true,
    external: false,
    skipOnDryRun: false,
    params: [
      {
        key: 'title',
        label: 'Título',
        kind: 'text',
        required: true,
        interpolable: true,
        placeholder: 'Divergência alta em {{trigger.item.sku}}',
      },
      { key: 'body', label: 'Mensagem', kind: 'textarea', required: false, interpolable: true },
      {
        key: 'severity',
        label: 'Severidade',
        kind: 'select',
        required: true,
        options: [
          { value: 'info', label: 'Informativa' },
          { value: 'warning', label: 'Atenção' },
          { value: 'critical', label: 'Crítica' },
        ],
      },
      {
        key: 'recipientId',
        label: 'Destinatário',
        kind: 'user',
        required: false,
        hint: 'Em branco, o aviso vale para toda a empresa.',
      },
    ],
  },

  create_alert: {
    key: 'create_alert',
    label: 'Criar alerta crítico',
    description: 'Igual à notificação, já marcada como crítica e sem destinatário individual.',
    group: 'Comunicação',
    compatibleTriggers: null,
    idempotent: true,
    external: false,
    skipOnDryRun: false,
    params: [
      { key: 'title', label: 'Título', kind: 'text', required: true, interpolable: true },
      { key: 'body', label: 'Detalhe', kind: 'textarea', required: false, interpolable: true },
    ],
  },

  add_session_note: {
    key: 'add_session_note',
    label: 'Adicionar observação na contagem',
    description: 'Acrescenta um texto ao campo de observação da sessão de contagem.',
    group: 'Contagem',
    compatibleTriggers: [
      'count.item_counted',
      'count.session_created',
      'count.session_started',
      'count.session_finalized',
    ],
    // Acrescenta texto: repetir duplicaria a observação.
    idempotent: false,
    external: false,
    skipOnDryRun: true,
    params: [
      { key: 'note', label: 'Observação', kind: 'textarea', required: true, interpolable: true },
    ],
  },

  assign_responsible: {
    key: 'assign_responsible',
    label: 'Atribuir responsável',
    description: 'Define quem responde pela contagem.',
    group: 'Contagem',
    compatibleTriggers: [
      'count.session_created',
      'count.session_started',
      'count.session_finalized',
    ],
    // Definir o mesmo responsável duas vezes tem o mesmo efeito que uma.
    idempotent: true,
    external: false,
    skipOnDryRun: true,
    params: [{ key: 'responsibleId', label: 'Responsável', kind: 'user', required: true }],
  },

  send_webhook: {
    key: 'send_webhook',
    label: 'Enviar webhook',
    description: 'Envia o contexto da automação para uma URL externa.',
    group: 'Integração',
    compatibleTriggers: null,
    // O destino é que decide; assumimos que não é idempotente, mas permitimos
    // retry porque falha de rede é o caso comum e o briefing (§17) pede.
    idempotent: false,
    external: true,
    skipOnDryRun: true,
    params: [
      {
        key: 'url',
        label: 'URL',
        kind: 'url',
        required: true,
        placeholder: 'https://exemplo.com/webhook',
        hint: 'Apenas HTTPS. Endereços internos e privados são recusados.',
      },
      {
        key: 'method',
        label: 'Método',
        kind: 'select',
        required: true,
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
          { value: 'PATCH', label: 'PATCH' },
        ],
      },
      {
        key: 'secretHeader',
        label: 'Cabeçalho de autenticação',
        kind: 'text',
        required: false,
        placeholder: 'X-Api-Key: valor',
        hint: 'Um cabeçalho por linha, no formato Nome: valor.',
      },
    ],
  },
};

export const ACTION_KEYS = Object.keys(ACTIONS) as ActionKey[];

export function isKnownAction(key: string): key is ActionKey {
  return key in ACTIONS;
}

/** Ações que podem ser usadas com um trigger. É isto que o editor oferece — em vez
 *  de listar tudo e deixar a validação recusar depois. */
export function actionsForTrigger(triggerType: string): ActionDefinition[] {
  return Object.values(ACTIONS).filter(
    action =>
      action.compatibleTriggers == null ||
      (isKnownTrigger(triggerType) && action.compatibleTriggers.includes(triggerType))
  );
}

export function isActionCompatible(actionType: string, triggerType: string): boolean {
  if (!isKnownAction(actionType)) return false;
  const compatible = ACTIONS[actionType].compatibleTriggers;
  return compatible == null || (isKnownTrigger(triggerType) && compatible.includes(triggerType));
}

/** Máximo de tentativas efetivo. Ação não externa não é retentada — o que falha
 *  localmente falha pelo mesmo motivo na segunda vez, e se não for idempotente a
 *  retentativa é que causa o dano. */
export function effectiveMaxAttempts(actionType: string, configured?: number): number {
  if (!isKnownAction(actionType)) return 1;
  if (!ACTIONS[actionType].external) return 1;
  const requested = configured ?? 3;
  return Math.min(3, Math.max(1, Math.floor(requested)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação de uma regra isolada
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleProblem {
  index: number;
  message: string;
}

/** Confere uma condição contra o catálogo: campo existe no trigger, operador
 *  existe, operador serve para o tipo do campo, e valor presente quando exigido. */
export function validateRule(rule: ConditionRule, triggerType: string, index: number): RuleProblem | null {
  const field = findField(triggerType, rule.field);
  if (field == null) {
    return { index, message: `O campo "${rule.field}" não existe neste gatilho.` };
  }

  const operator = OPERATORS[rule.operator as OperatorKey];
  if (operator == null) {
    return { index, message: `Operador desconhecido: "${rule.operator}".` };
  }

  if (!operator.kinds.includes(field.kind)) {
    return {
      index,
      message: `"${operator.label}" não se aplica a ${field.label.toLowerCase()}.`,
    };
  }

  if (operator.needsValue) {
    const empty =
      rule.value == null ||
      rule.value === '' ||
      (Array.isArray(rule.value) && rule.value.length === 0);
    if (empty) {
      return { index, message: `Informe um valor para "${field.label}".` };
    }
  }

  return null;
}
