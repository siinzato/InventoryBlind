// Metadados visuais dos nodes — a única fonte para ícone, cor e rótulo de cada
// tipo, reaproveitada pelo canvas, pela biblioteca de blocos e pelo minimapa.
//
// Existia uma versão pequena disto dentro de AutomationCanvas.tsx (NODE_ICON,
// NODE_KIND_LABEL), cobrindo só os 6 tipos originais. Os 3 tipos mais novos —
// loop, webhook_wait, agent — já executam no engine (ver engine.ts) e já são
// validados (workflow.ts), mas nunca tiveram ícone, rótulo nem forma de criar
// um pela tela. Este arquivo cobre os 9.

import {
  Bot,
  Check,
  Clock,
  GitBranch,
  Play,
  Repeat,
  Shuffle,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { ACTIONS, findField, isKnownTrigger, OPERATORS, TRIGGERS, type ActionKey, type OperatorKey } from './registry';
import type { AutomationNode, AutomationWorkflow, NodeType } from './types';

export interface NodeVisualMeta {
  icon: LucideIcon;
  /** Rótulo curto de categoria, ex. "Quando", "Se". */
  kindLabel: string;
  /** Classe de texto/ícone — família de cor por tipo, discreta (§2: sem neon). */
  colorClass: string;
  /** Mesma cor em fundo fraco, para o selo/badge do node e da biblioteca. */
  chipClass: string;
}

export const NODE_META: Record<NodeType, NodeVisualMeta> = {
  trigger: {
    icon: Zap,
    kindLabel: 'Quando',
    colorClass: 'text-accent',
    chipClass: 'bg-accent/10 text-accent',
  },
  condition: {
    icon: Check,
    kindLabel: 'Se',
    colorClass: 'text-amber-600 dark:text-amber-400',
    chipClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  branch: {
    icon: GitBranch,
    kindLabel: 'Ramificação',
    colorClass: 'text-amber-700 dark:text-amber-300',
    chipClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  switch: {
    icon: Shuffle,
    kindLabel: 'Escolha',
    colorClass: 'text-sky-600 dark:text-sky-400',
    chipClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  delay: {
    icon: Clock,
    kindLabel: 'Espere',
    colorClass: 'text-violet-600 dark:text-violet-400',
    chipClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  webhook_wait: {
    icon: Webhook,
    kindLabel: 'Aguarde retorno',
    colorClass: 'text-violet-700 dark:text-violet-300',
    chipClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  loop: {
    icon: Repeat,
    kindLabel: 'Repita',
    colorClass: 'text-teal-600 dark:text-teal-400',
    chipClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  agent: {
    icon: Bot,
    kindLabel: 'IA',
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    chipClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  },
  action: {
    icon: Play,
    kindLabel: 'Então',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    chipClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
};

/** Resumo de uma linha, para o bloco dizer o que faz sem abrir.
 *
 *  Movido de AutomationCanvas.tsx sem alterar a lógica — só ganhou os 3 tipos
 *  que faltavam. */
export function describeNode(node: AutomationNode): string {
  switch (node.type) {
    case 'trigger':
      return isKnownTrigger(node.triggerType) ? TRIGGERS[node.triggerType].label : node.triggerType;
    case 'condition':
    case 'branch':
      return node.rules.length === 0
        ? 'Nenhuma condição'
        : `${node.rules.length} ${node.rules.length === 1 ? 'condição' : 'condições'} (${node.logic})`;
    case 'delay':
      return `${node.minutes} minuto(s)`;
    case 'switch':
      return node.cases.length === 0 ? 'Nenhum caso' : node.cases.map(c => c.value).join(' | ');
    case 'loop':
      return `Até ${node.maxIterations} iteração(ões) sobre ${node.field || '(campo não definido)'}`;
    case 'webhook_wait':
      return `Aguarda até ${node.timeoutMinutes} minuto(s)`;
    case 'agent':
      return node.prompt.trim() === '' ? 'Sem instrução' : node.prompt.slice(0, 80);
    case 'action':
      return node.actionType in ACTIONS ? ACTIONS[node.actionType as ActionKey].label : node.actionType;
  }
}

/** Linhas extras "Rótulo: valor" para o node mostrar sua configuração real sem abrir
 *  o painel — só o que já está preenchido, nunca um placeholder inventado. Fica
 *  abaixo do resumo de uma linha que `describeNode` já produz. */
export function describeNodeDetails(node: AutomationNode, triggerType: string): string[] {
  switch (node.type) {
    case 'condition':
    case 'branch': {
      const lines = node.rules.slice(0, 2).map(rule => {
        const field = findField(triggerType, rule.field);
        const fieldLabel = field?.label ?? (rule.field || '(campo)');
        const operator = OPERATORS[rule.operator as OperatorKey];
        if (!operator) return fieldLabel;
        const hasValue = operator.needsValue && rule.value != null && rule.value !== '';
        const valuePart = hasValue ? ` ${Array.isArray(rule.value) ? rule.value.join(', ') : rule.value}` : '';
        return `${fieldLabel} ${operator.label.toLowerCase()}${valuePart}`;
      });
      if (node.rules.length > 2) lines.push(`+${node.rules.length - 2} condição(ões)`);
      return lines;
    }
    case 'action': {
      const definition = node.actionType in ACTIONS ? ACTIONS[node.actionType as ActionKey] : null;
      if (!definition) return [];
      return definition.params
        .map(param => {
          const raw = node.config[param.key];
          if (raw == null || raw === '') return null;
          const display = param.kind === 'select'
            ? (param.options?.find(o => o.value === raw)?.label ?? String(raw))
            : String(raw);
          return `${param.label}: ${display.length > 28 ? `${display.slice(0, 27)}…` : display}`;
        })
        .filter((line): line is string => line != null)
        .slice(0, 3);
    }
    case 'loop':
      return node.field ? [`Campo: ${node.field}`, `Máximo: ${node.maxIterations} iteração(ões)`] : [];
    default:
      return [];
  }
}

/** Categoria de exibição na biblioteca de blocos (§8). Não é o `NodeType` —
 *  várias ações do registry (ACTIONS) caem em categorias diferentes conforme o
 *  próprio `group` que já declaram (ex. "Comunicação" → Notificações). */
export type LibraryCategory = 'Gatilhos' | 'Lógica' | 'Tempo' | 'Ações' | 'Notificações' | 'Integrações';

export interface LibraryEntry {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: LibraryCategory;
  colorClass: string;
  /** `create('trigger')`, `create('delay')` ... ou `create('action', 'send_webhook')`. */
  createKind: NodeType;
  actionKey?: ActionKey;
}

const ACTION_GROUP_TO_CATEGORY: Record<string, LibraryCategory> = {
  Comunicação: 'Notificações',
  Integração: 'Integrações',
};

/** Catálogo pesquisável da biblioteca — só o que o motor de fato executa.
 *
 *  Gatilho não entra aqui: só existe um por workflow (a validação recusa um
 *  segundo), e trocá-lo é a ação "Trocar gatilho" que já existe no painel de
 *  configuração do próprio node de gatilho. */
export function buildLibraryEntries(): LibraryEntry[] {
  const entries: LibraryEntry[] = [
    {
      key: 'condition',
      label: 'Condição',
      description: 'Segue adiante só se as regras baterem; para se não baterem.',
      icon: NODE_META.condition.icon,
      category: 'Lógica',
      colorClass: NODE_META.condition.colorClass,
      createKind: 'condition',
    },
    {
      key: 'branch',
      label: 'Ramificação',
      description: 'Duas saídas nomeadas — Sim e Não — a partir das mesmas regras.',
      icon: NODE_META.branch.icon,
      category: 'Lógica',
      colorClass: NODE_META.branch.colorClass,
      createKind: 'branch',
    },
    {
      key: 'switch',
      label: 'Escolha',
      description: 'Várias saídas por valor de um campo, em vez de só Sim/Não.',
      icon: NODE_META.switch.icon,
      category: 'Lógica',
      colorClass: NODE_META.switch.colorClass,
      createKind: 'switch',
    },
    {
      key: 'loop',
      label: 'Repetição',
      description: 'Repete o caminho seguinte para cada item de uma lista do contexto.',
      icon: NODE_META.loop.icon,
      category: 'Lógica',
      colorClass: NODE_META.loop.colorClass,
      createKind: 'loop',
    },
    {
      key: 'delay',
      label: 'Espera',
      description: 'Pausa a execução por um tempo antes de seguir.',
      icon: NODE_META.delay.icon,
      category: 'Tempo',
      colorClass: NODE_META.delay.colorClass,
      createKind: 'delay',
    },
    {
      key: 'webhook_wait',
      label: 'Aguardar retorno',
      description: 'Pausa até um sistema externo chamar de volta, com prazo.',
      icon: NODE_META.webhook_wait.icon,
      category: 'Tempo',
      colorClass: NODE_META.webhook_wait.colorClass,
      createKind: 'webhook_wait',
    },
    {
      key: 'agent',
      label: 'Consultar IA',
      description: 'Envia uma instrução ao BlindAI e disponibiliza a resposta para os blocos seguintes.',
      icon: NODE_META.agent.icon,
      category: 'Ações',
      colorClass: NODE_META.agent.colorClass,
      createKind: 'agent',
    },
  ];

  for (const action of Object.values(ACTIONS)) {
    entries.push({
      key: `action:${action.key}`,
      label: action.label,
      description: action.description,
      icon: NODE_META.action.icon,
      category: ACTION_GROUP_TO_CATEGORY[action.group] ?? 'Ações',
      colorClass: NODE_META.action.colorClass,
      createKind: 'action',
      actionKey: action.key,
    });
  }

  return entries;
}

export function nextNodeId(workflow: AutomationWorkflow, prefix: string): string {
  let index = 1;
  while (workflow.nodes.some(n => n.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** Cria um node em branco de um tipo, com os mesmos padrões que
 *  AutomationEditor.tsx já usava nos botões "Condição"/"Ramificação"/etc —
 *  só relocado, e estendido para os 3 tipos que não tinham forma de criar. */
export function createBlankNode(
  workflow: AutomationWorkflow,
  triggerType: string,
  createKind: NodeType,
  actionKey?: ActionKey
): AutomationNode {
  switch (createKind) {
    case 'condition':
      return { id: nextNodeId(workflow, 'condition'), type: 'condition', label: 'Nova condição', logic: 'AND', rules: [] };
    case 'branch':
      return { id: nextNodeId(workflow, 'branch'), type: 'branch', label: 'Nova ramificação', logic: 'AND', rules: [] };
    case 'switch':
      return {
        id: nextNodeId(workflow, 'switch'),
        type: 'switch',
        label: 'Nova escolha',
        field: isKnownTrigger(triggerType) ? TRIGGERS[triggerType].fields[0]?.path ?? '' : '',
        cases: [],
      };
    case 'loop':
      return {
        id: nextNodeId(workflow, 'loop'),
        type: 'loop',
        label: 'Nova repetição',
        field: '',
        maxIterations: 10,
      };
    case 'delay':
      return { id: nextNodeId(workflow, 'delay'), type: 'delay', label: 'Esperar', minutes: 30 };
    case 'webhook_wait':
      return {
        id: nextNodeId(workflow, 'webhook_wait'),
        type: 'webhook_wait',
        label: 'Aguardar retorno',
        timeoutMinutes: 60,
      };
    case 'agent':
      return { id: nextNodeId(workflow, 'agent'), type: 'agent', label: 'Consultar IA', prompt: '' };
    case 'action': {
      const key = actionKey ?? 'create_notification';
      return {
        id: nextNodeId(workflow, 'action'),
        type: 'action',
        label: ACTIONS[key].label,
        actionType: key,
        config: key === 'create_notification' ? { severity: 'warning' } : {},
      };
    }
    case 'trigger':
      throw new Error('Gatilho não é criado pela biblioteca — cada workflow já nasce com um.');
  }
}
