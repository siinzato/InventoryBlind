// Templates — atalhos, não regras.
//
// Cada template produz um workflow COMPLETAMENTE editável: mesmos nodes, mesmas
// edges e mesmo formato que o editor gera à mão. Depois de criada, uma automação de
// template é indistinguível de uma montada do zero — nada aqui fica marcado como
// "de template" nem tem caminho especial no engine (§35).
//
// Os limiares vêm parametrizados porque 10% é palpite: o valor certo depende da
// operação, e um template com número fixo obrigaria a pessoa a editar antes do
// primeiro uso.

import type { AutomationWorkflow } from './types.ts';

export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  /** O que o template resolve, em uma frase, na linguagem de quem opera. */
  outcome: string;
  triggerType: string;
  /** Valor sugerido do limiar. Editável antes de criar. */
  defaultThreshold?: number;
  thresholdLabel?: string;
  build(params: { threshold?: number }): AutomationWorkflow;
}

/** Ids curtos e estáveis dentro do workflow. Não precisam ser únicos globalmente —
 *  só dentro do grafo, porque é aí que as edges e o log os referenciam. */
const ID = {
  trigger: 'trigger',
  condition: 'condition',
  branch: 'branch',
  action1: 'action-1',
  action2: 'action-2',
} as const;

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'critical_divergence',
    name: 'Divergência crítica',
    description: 'Avisa a supervisão quando um item conta muito diferente do saldo do ERP.',
    outcome: 'Ninguém precisa ficar olhando a tela para descobrir um erro grande de contagem.',
    triggerType: 'count.item_counted',
    defaultThreshold: 10,
    thresholdLabel: 'Divergência do item acima de (%)',
    build: ({ threshold = 10 }) => ({
      nodes: [
        { id: ID.trigger, type: 'trigger', triggerType: 'count.item_counted', label: 'Item contado', config: {} },
        {
          id: ID.condition,
          type: 'condition',
          label: `Divergência acima de ${threshold}%`,
          logic: 'AND',
          rules: [
            { field: 'trigger.count.variancePercentage', operator: 'greater_than_or_equal', value: threshold },
          ],
        },
        {
          id: ID.action1,
          type: 'action',
          label: 'Notificar supervisão',
          actionType: 'create_notification',
          config: {
            title: 'Divergência alta em {{trigger.item.sku}}',
            body:
              'O item {{trigger.item.sku}} em {{trigger.item.location}} contou {{trigger.count.totalFound}} ' +
              'contra {{trigger.count.erpQuantity}} no ERP ({{trigger.count.variancePercentage}}% de divergência).',
            severity: 'warning',
          },
        },
      ],
      edges: [
        { from: ID.trigger, to: ID.condition, branch: 'next' },
        { from: ID.condition, to: ID.action1, branch: 'next' },
      ],
    }),
  },

  {
    key: 'auto_recount',
    name: 'Recontagem automática',
    description: 'Gera a rodada seguinte quando a contagem fecha com divergência acima do limite.',
    // O gatilho é a contagem FINALIZADA, não o item contado: criar recontagem exige
    // sessão fechada, e o registry recusa a combinação errada. Ver
    // registry.ts::compatibleTriggers.
    outcome: 'A recontagem já está criada quando a equipe termina a rodada anterior.',
    triggerType: 'count.session_finalized',
    defaultThreshold: 10,
    thresholdLabel: 'Itens divergentes acima de (%)',
    build: ({ threshold = 10 }) => ({
      nodes: [
        {
          id: ID.trigger,
          type: 'trigger',
          triggerType: 'count.session_finalized',
          label: 'Contagem finalizada',
          config: {},
        },
        {
          id: ID.condition,
          type: 'condition',
          label: `Mais de ${threshold}% de itens divergentes`,
          logic: 'AND',
          rules: [
            { field: 'trigger.divergence.divergentItemPercentage', operator: 'greater_than_or_equal', value: threshold },
            // Sem isto, a recontagem gerada seria ela mesma finalizada com
            // divergência e pediria outra, até o limite de 3 rodadas. A proteção de
            // profundidade do engine também contém, mas parar pela regra do negócio é
            // melhor do que parar pelo limite técnico.
            { field: 'trigger.session.countNumber', operator: 'equals', value: 1 },
          ],
        },
        {
          id: ID.action1,
          type: 'action',
          label: 'Criar recontagem',
          actionType: 'create_recount',
          config: {},
        },
        {
          id: ID.action2,
          type: 'action',
          label: 'Avisar responsável',
          actionType: 'create_notification',
          config: {
            title: 'Recontagem criada para {{trigger.session.warehouse}}',
            body:
              '{{trigger.divergence.divergentItems}} de {{trigger.divergence.countedItems}} itens divergiram ' +
              'na contagem de {{trigger.session.streetFrom}} a {{trigger.session.streetTo}}.',
            severity: 'warning',
          },
        },
      ],
      edges: [
        { from: ID.trigger, to: ID.condition, branch: 'next' },
        { from: ID.condition, to: ID.action1, branch: 'next' },
        { from: ID.action1, to: ID.action2, branch: 'next' },
      ],
    }),
  },

  {
    key: 'branch_by_severity',
    name: 'Ramificação por gravidade',
    description:
      'Divide o caminho: divergência acima do limite gera recontagem e aviso; abaixo, apenas registra observação.',
    outcome: 'Trata caso grave e caso leve de formas diferentes, sem duas automações.',
    triggerType: 'count.session_finalized',
    defaultThreshold: 15,
    thresholdLabel: 'Limite de gravidade (% de itens divergentes)',
    build: ({ threshold = 15 }) => ({
      nodes: [
        {
          id: ID.trigger,
          type: 'trigger',
          triggerType: 'count.session_finalized',
          label: 'Contagem finalizada',
          config: {},
        },
        {
          id: ID.branch,
          type: 'branch',
          label: `Divergência acima de ${threshold}%?`,
          logic: 'AND',
          rules: [
            { field: 'trigger.divergence.divergentItemPercentage', operator: 'greater_than', value: threshold },
          ],
        },
        {
          id: ID.action1,
          type: 'action',
          label: 'Criar recontagem',
          actionType: 'create_recount',
          config: {},
        },
        {
          id: ID.action2,
          type: 'action',
          label: 'Registrar observação',
          actionType: 'add_session_note',
          config: {
            note:
              'Divergência de {{trigger.divergence.divergentItemPercentage}}% dentro do tolerado — ' +
              'sem recontagem automática.',
          },
        },
      ],
      edges: [
        { from: ID.trigger, to: ID.branch, branch: 'next' },
        { from: ID.branch, to: ID.action1, branch: 'true' },
        { from: ID.branch, to: ID.action2, branch: 'false' },
      ],
    }),
  },

  {
    key: 'new_count_notice',
    name: 'Aviso de contagem criada',
    description: 'Notifica a equipe quando uma nova contagem entra na fila — ignorando recontagens.',
    outcome: 'A equipe sabe que há contagem nova sem precisar abrir a tela.',
    triggerType: 'count.session_created',
    build: () => ({
      nodes: [
        {
          id: ID.trigger,
          type: 'trigger',
          triggerType: 'count.session_created',
          label: 'Contagem criada',
          config: {},
        },
        {
          id: ID.condition,
          type: 'condition',
          label: 'Não é recontagem',
          logic: 'AND',
          // O campo existe exatamente para isto — ver o comentário do emissor na
          // migration 051.
          rules: [{ field: 'trigger.session.isRecount', operator: 'equals', value: false }],
        },
        {
          id: ID.action1,
          type: 'action',
          label: 'Notificar equipe',
          actionType: 'create_notification',
          config: {
            title: 'Nova contagem em {{trigger.session.warehouse}}',
            body: '{{trigger.session.totalItems}} itens para contar.',
            severity: 'info',
          },
        },
      ],
      edges: [
        { from: ID.trigger, to: ID.condition, branch: 'next' },
        { from: ID.condition, to: ID.action1, branch: 'next' },
      ],
    }),
  },

  {
    key: 'stock_discrepancy_alert',
    name: 'Divergência com o ERP',
    description: 'Cria alerta crítico quando a sincronização encontra divergência de saldo.',
    outcome: 'Uma divergência entre ERP e InventoryBlind não fica esperando alguém abrir a tela.',
    triggerType: 'stock.discrepancy_detected',
    build: () => ({
      nodes: [
        {
          id: ID.trigger,
          type: 'trigger',
          triggerType: 'stock.discrepancy_detected',
          label: 'Divergência detectada',
          config: {},
        },
        {
          id: ID.action1,
          type: 'action',
          label: 'Criar alerta',
          actionType: 'create_alert',
          config: {
            title: 'Divergência de saldo com o ERP',
            body: 'Entidade {{trigger.conflict.entityType}} ({{trigger.conflict.externalId}}) precisa de revisão.',
          },
        },
      ],
      edges: [{ from: ID.trigger, to: ID.action1, branch: 'next' }],
    }),
  },
];

export function findTemplate(key: string): AutomationTemplate | null {
  return AUTOMATION_TEMPLATES.find(t => t.key === key) ?? null;
}
