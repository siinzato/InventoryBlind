// Workflow — validação e travessia do grafo. Puro.
//
// O grafo é dado que o usuário monta, então tudo aqui parte do princípio de que ele
// pode estar errado: node sem trigger, aresta apontando para o nada, ciclo, ação
// incompatível com o gatilho, variável inexistente. A validação é o que separa
// "rascunho que o usuário está montando" de "automação que pode ser ativada" (§31,
// §32).

import {
  ACTIONS,
  isActionCompatible,
  isKnownAction,
  isKnownTrigger,
  fieldsForTrigger,
  findField,
  validateRule,
  type ActionKey,
} from './registry.ts';
import { extractPaths } from './interpolation.ts';
import { SWITCH_BRANCH_PREFIX } from './types.ts';
import { MAX_GROUP_DEPTH, countGroup, toConditionGroup } from './conditionGroups.ts';
import type {
  AutomationEdge,
  AutomationNode,
  AutomationWorkflow,
  BranchNode,
  ConditionNode,
  TriggerNode,
} from './types.ts';

/** Teto de nodes visitados numa execução.
 *
 *  Não é o limite de tamanho do workflow — é o de PASSOS. Um grafo com ciclo que
 *  passou pela validação (ou um grafo salvo por uma versão anterior do validador)
 *  precisa parar em algum lugar, e parar por contagem é a única garantia que não
 *  depende de o detector de ciclo estar correto. Defesa em profundidade: a
 *  validação recusa ciclo, e isto contém o caso em que ela falhou. */
export const MAX_NODE_VISITS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Acesso ao grafo
// ─────────────────────────────────────────────────────────────────────────────

export function findTriggerNode(workflow: AutomationWorkflow): TriggerNode | null {
  return (workflow.nodes.find(n => n.type === 'trigger') as TriggerNode | undefined) ?? null;
}

export function findNode(workflow: AutomationWorkflow, nodeId: string): AutomationNode | null {
  return workflow.nodes.find(n => n.id === nodeId) ?? null;
}

export function outgoingEdges(workflow: AutomationWorkflow, nodeId: string): AutomationEdge[] {
  return workflow.edges.filter(e => e.from === nodeId);
}

/** Próximo node por saída. `branch` só é 'true'/'false' saindo de um BranchNode. */
export function nextNodeId(
  workflow: AutomationWorkflow,
  nodeId: string,
  // String livre por causa das saídas de switch ('case:<valor>' e 'default'). A
  // correspondência é exata, então uma saída inexistente devolve null e o caminho
  // encerra — que é o comportamento desejado para um caso sem conexão.
  branch: string
): string | null {
  return workflow.edges.find(e => e.from === nodeId && e.branch === branch)?.to ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detecção de ciclo
// ─────────────────────────────────────────────────────────────────────────────

/** Busca em profundidade com pilha de recursão.
 *
 *  Marca `visited` (já explorado por completo) separado de `stack` (no caminho
 *  atual): sem essa distinção, um losango — dois caminhos que se reencontram — seria
 *  acusado de ciclo, e losango é exatamente o que um branch com TRUE e FALSE
 *  convergindo na mesma ação produz. */
export function findCycle(workflow: AutomationWorkflow): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): string[] | null => {
    if (stack.has(nodeId)) {
      // Devolve só o trecho circular, não o caminho inteiro desde a raiz.
      return [...path.slice(path.indexOf(nodeId)), nodeId];
    }
    if (visited.has(nodeId)) return null;

    visited.add(nodeId);
    stack.add(nodeId);
    path.push(nodeId);

    for (const edge of outgoingEdges(workflow, nodeId)) {
      const cycle = visit(edge.to);
      if (cycle != null) return cycle;
    }

    stack.delete(nodeId);
    path.pop();
    return null;
  };

  for (const node of workflow.nodes) {
    const cycle = visit(node.id);
    if (cycle != null) return cycle;
  }

  return null;
}

/** Nodes alcançáveis a partir do trigger. O que sobra está desconectado e nunca
 *  vai executar — vale avisar, porque o usuário provavelmente esqueceu de ligar. */
export function reachableNodes(workflow: AutomationWorkflow): Set<string> {
  const trigger = findTriggerNode(workflow);
  if (trigger == null) return new Set();

  const reachable = new Set<string>([trigger.id]);
  const queue = [trigger.id];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of outgoingEdges(workflow, current)) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  return reachable;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationProblem {
  /** `error` impede ativar; `warning` é permitido mas suspeito. A distinção existe
   *  porque um node desconectado é frequentemente intencional durante a montagem, e
   *  bloquear por isso obrigaria o usuário a arrumar o grafo antes de poder salvar
   *  como rascunho. */
  severity: 'error' | 'warning';
  message: string;
  /** Node a destacar na tela, quando aplicável. */
  nodeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  problems: ValidationProblem[];
}

/** Valida o workflow inteiro.
 *
 *  `valid` significa "pode ser ativada". Warnings não impedem. */
export function validateWorkflow(workflow: AutomationWorkflow): ValidationResult {
  const problems: ValidationProblem[] = [];
  const error = (message: string, nodeId?: string) =>
    problems.push({ severity: 'error', message, nodeId });
  const warn = (message: string, nodeId?: string) =>
    problems.push({ severity: 'warning', message, nodeId });

  // ── Trigger ──────────────────────────────────────────────────────────────
  const triggers = workflow.nodes.filter(n => n.type === 'trigger') as TriggerNode[];

  if (triggers.length === 0) {
    error('A automação precisa de um gatilho.');
  } else if (triggers.length > 1) {
    // Mais de uma raiz tornaria o contexto ambíguo: os campos disponíveis dependem
    // do gatilho, e dois gatilhos oferecem conjuntos diferentes.
    error('A automação só pode ter um gatilho.');
  }

  const trigger = triggers[0] ?? null;
  const triggerType = trigger?.triggerType ?? '';

  if (trigger != null && !isKnownTrigger(triggerType)) {
    error(`Gatilho desconhecido: "${triggerType}".`, trigger.id);
  }

  // ── Ids ──────────────────────────────────────────────────────────────────
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    if (node.id.trim() === '') {
      error('Existe um bloco sem identificador.');
      continue;
    }
    if (ids.has(node.id)) {
      // Id duplicado faria as arestas e o log apontarem para dois blocos.
      error(`Identificador de bloco repetido: "${node.id}".`, node.id);
    }
    ids.add(node.id);
  }

  // ── Arestas ──────────────────────────────────────────────────────────────
  for (const edge of workflow.edges) {
    if (!ids.has(edge.from)) error(`Uma conexão parte de um bloco inexistente ("${edge.from}").`);
    if (!ids.has(edge.to)) error(`Uma conexão aponta para um bloco inexistente ("${edge.to}").`);
    if (edge.from === edge.to) error('Um bloco não pode se conectar a si mesmo.', edge.from);
  }

  // Duas arestas na mesma saída = ordem de execução indefinida.
  const seenOutputs = new Set<string>();
  for (const edge of workflow.edges) {
    const key = `${edge.from}::${edge.branch}`;
    if (seenOutputs.has(key)) {
      error('Um bloco tem duas conexões na mesma saída.', edge.from);
    }
    seenOutputs.add(key);
  }

  // ── Ciclo ────────────────────────────────────────────────────────────────
  const cycle = findCycle(workflow);
  if (cycle != null) {
    error(`Existe um ciclo entre os blocos: ${cycle.join(' → ')}.`);
  }

  // ── Alcançabilidade ──────────────────────────────────────────────────────
  if (trigger != null && cycle == null) {
    const reachable = reachableNodes(workflow);
    for (const node of workflow.nodes) {
      if (!reachable.has(node.id)) {
        warn(`O bloco "${node.label ?? node.id}" não está conectado e nunca vai executar.`, node.id);
      }
    }
  }

  // ── Cada node ────────────────────────────────────────────────────────────
  for (const node of workflow.nodes) {
    if (node.type === 'condition' || node.type === 'branch') {
      validateConditionish(node, triggerType, problems);
    }
    if (node.type === 'action') {
      validateAction(node.id, node.actionType, node.config, node.label, triggerType, problems);
    }
    if (node.type === 'delay') {
      if (!Number.isFinite(node.minutes) || node.minutes < 1) {
        // Mínimo de um minuto: a fila é varrida a cada minuto, então prometer menos
        // seria prometer uma precisão que não existe.
        error(`A espera "${node.label ?? node.id}" precisa de pelo menos 1 minuto.`, node.id);
      }
      if (node.minutes > 60 * 24 * 7) {
        // Uma semana. Acima disso, o evento agendado fica na fila por tempo demais
        // para que o dado do gatilho ainda descreva a realidade.
        error(`A espera "${node.label ?? node.id}" não pode passar de 7 dias.`, node.id);
      }
      if (nextNodeId(workflow, node.id, 'next') == null) {
        warn(`Nada acontece depois da espera "${node.label ?? node.id}".`, node.id);
      }
    }

    if (node.type === 'switch') {
      if (findField(triggerType, node.field) == null) {
        error(`O campo "${node.field}" não existe neste gatilho.`, node.id);
      }
      if (node.cases.length === 0) {
        error(`A escolha "${node.label ?? node.id}" não tem nenhum caso configurado.`, node.id);
      }

      const seenCases = new Set<string>();
      for (const candidate of node.cases) {
        const key = candidate.value.trim().toLowerCase();
        if (key === '') {
          error(`A escolha "${node.label ?? node.id}" tem um caso sem valor.`, node.id);
          continue;
        }
        if (seenCases.has(key)) {
          // Dois casos com o mesmo valor: o segundo nunca seria alcançado, e o
          // usuário ficaria com uma saída morta sem saber.
          error(`A escolha "${node.label ?? node.id}" repete o caso "${candidate.value}".`, node.id);
        }
        seenCases.add(key);
      }

      // Toda aresta de switch tem de corresponder a um caso declarado ou ao default.
      // Sem esta checagem, renomear um caso deixaria a aresta órfã apontando para uma
      // saída que o engine nunca escolhe.
      for (const edge of outgoingEdges(workflow, node.id)) {
        if (edge.branch === 'default') continue;
        if (!edge.branch.startsWith(SWITCH_BRANCH_PREFIX)) {
          error(`A escolha "${node.label ?? node.id}" tem uma conexão com saída inválida.`, node.id);
          continue;
        }
        const value = edge.branch.slice(SWITCH_BRANCH_PREFIX.length);
        if (!node.cases.some(c => c.value === value)) {
          error(`A escolha "${node.label ?? node.id}" tem conexão para o caso "${value}", que não existe mais.`, node.id);
        }
      }

      if (outgoingEdges(workflow, node.id).length === 0) {
        error(`A escolha "${node.label ?? node.id}" não tem nenhuma saída ligada.`, node.id);
      } else if (!workflow.edges.some(e => e.from === node.id && e.branch === 'default')) {
        // Sem default, um valor inesperado encerra o fluxo em silêncio.
        warn(`A escolha "${node.label ?? node.id}" não tem saída padrão — valores fora dos casos não farão nada.`, node.id);
      }
    }

    if (node.type === 'loop') {
      if (findField(triggerType, node.field) == null && !node.field.startsWith('trigger.webhook.body.')) {
        error(`O campo "${node.field}" não existe neste gatilho.`, node.id);
      }
      if (!Number.isFinite(node.maxIterations) || node.maxIterations < 1) {
        error(`O laço "${node.label ?? node.id}" precisa de no mínimo 1 iteração.`, node.id);
      }
      if (node.maxIterations > MAX_LOOP_ITERATIONS_LIMIT) {
        error(
          `O laço "${node.label ?? node.id}" não pode passar de ${MAX_LOOP_ITERATIONS_LIMIT} iterações — ele roda inteiro dentro de uma execução.`,
          node.id
        );
      }

      const body = nextNodeId(workflow, node.id, 'loop');
      if (body == null) {
        error(`O laço "${node.label ?? node.id}" não tem nada ligado à saída de repetição.`, node.id);
      } else {
        // Nenhum bloco que interrompe a execução pode estar no corpo: interromper no
        // meio de uma iteração deixaria as anteriores aplicadas e as seguintes não,
        // sem forma de retomar do meio da lista.
        for (const inner of nodesReachableFrom(workflow, body, node.id)) {
          if (inner.type === 'delay' || inner.type === 'webhook_wait') {
            error(
              `"${inner.label ?? inner.id}" pausa a execução e não pode estar dentro de um laço.`,
              inner.id
            );
          }
          if (inner.type === 'loop') {
            error(`Laço dentro de laço não é permitido ("${inner.label ?? inner.id}").`, inner.id);
          }
        }
      }

      if (nextNodeId(workflow, node.id, 'after') == null) {
        warn(`Nada acontece depois do laço "${node.label ?? node.id}".`, node.id);
      }
    }

    if (node.type === 'webhook_wait') {
      if (!Number.isFinite(node.timeoutMinutes) || node.timeoutMinutes < 1) {
        error(`A espera "${node.label ?? node.id}" precisa de um prazo de no mínimo 1 minuto.`, node.id);
      }
      if (node.timeoutMinutes > 60 * 24 * 7) {
        error(`A espera "${node.label ?? node.id}" não pode passar de 7 dias.`, node.id);
      }
      if (nextNodeId(workflow, node.id, 'next') == null) {
        warn(`Nada acontece depois da espera "${node.label ?? node.id}".`, node.id);
      }
    }

    if (node.type === 'agent') {
      if (node.prompt.trim() === '') {
        error(`O bloco de IA "${node.label ?? node.id}" está sem instrução.`, node.id);
      }

      // Variáveis do prompt conferidas como em qualquer campo interpolável: uma
      // variável inexistente produziria "(indisponível)" dentro da instrução enviada
      // ao modelo, que é pior do que um erro — o modelo responderia sobre nada.
      const available = new Set(fieldsForTrigger(triggerType).map(f => f.path));
      for (const path of extractPaths(node.prompt)) {
        const allowed =
          path.startsWith('actions.') ||
          path.startsWith('loop.') ||
          path.startsWith('trigger.webhook.body.') ||
          available.has(path);
        if (!allowed) {
          error(`O bloco de IA "${node.label ?? node.id}" usa {{${path}}}, que não existe neste gatilho.`, node.id);
        }
      }
    }

    if (node.type === 'branch') {
      const hasTrue = workflow.edges.some(e => e.from === node.id && e.branch === 'true');
      const hasFalse = workflow.edges.some(e => e.from === node.id && e.branch === 'false');
      if (!hasTrue && !hasFalse) {
        error(`A ramificação "${node.label ?? node.id}" não tem nenhuma saída ligada.`, node.id);
      } else if (!hasTrue) {
        // Só FALSE ligado é válido — "não fazer nada quando sim" é uma escolha —
        // mas raramente é o que a pessoa quis.
        warn(`A ramificação "${node.label ?? node.id}" não tem saída para SIM.`, node.id);
      } else if (!hasFalse) {
        warn(`A ramificação "${node.label ?? node.id}" não tem saída para NÃO.`, node.id);
      }
    }
  }

  // ── Precisa fazer algo ───────────────────────────────────────────────────
  const actionCount = workflow.nodes.filter(n => n.type === 'action').length;
  if (actionCount === 0) {
    error('A automação precisa de pelo menos uma ação.');
  }

  return { valid: !problems.some(p => p.severity === 'error'), problems };
}

function validateConditionish(
  node: ConditionNode | BranchNode,
  triggerType: string,
  problems: ValidationProblem[]
): void {
  const counted = countGroup(toConditionGroup(node));

  if (counted.depth > MAX_GROUP_DEPTH) {
    problems.push({
      severity: 'error',
      message: `"${node.label ?? node.id}" tem grupos aninhados além de ${MAX_GROUP_DEPTH} níveis.`,
      nodeId: node.id,
    });
  }

  // Regras dos subgrupos contam: um node com 0 regras diretas e um subgrupo cheio
  // está configurado, e recusá-lo obrigaria a duplicar uma regra no nível de cima.
  if (counted.rules === 0) {
    problems.push({
      severity: 'error',
      message: `"${node.label ?? node.id}" não tem nenhuma condição configurada.`,
      nodeId: node.id,
    });
    return;
  }

  // Valida em profundidade: uma regra inválida escondida num subgrupo produziria uma
  // automação que passa na ativação e nunca casa.
  const validateGroupRules = (group: ReturnType<typeof toConditionGroup>): void => {
    group.rules.forEach((rule, index) => {
      const problem = validateRule(rule, triggerType, index);
      if (problem != null) {
        problems.push({
          severity: 'error',
          message: `${node.label ?? 'Condição'}: ${problem.message}`,
          nodeId: node.id,
        });
      }
    });
    for (const child of group.groups ?? []) validateGroupRules(child);
  };

  validateGroupRules(toConditionGroup(node));
}

function validateAction(
  nodeId: string,
  actionType: string,
  config: Record<string, unknown>,
  label: string | undefined,
  triggerType: string,
  problems: ValidationProblem[]
): void {
  if (!isKnownAction(actionType)) {
    problems.push({ severity: 'error', message: `Ação desconhecida: "${actionType}".`, nodeId });
    return;
  }

  const definition = ACTIONS[actionType as ActionKey];

  // A checagem que evita uma automação que falharia em toda execução. Ver o
  // comentário sobre compatibilidade no topo de registry.ts.
  if (!isActionCompatible(actionType, triggerType)) {
    problems.push({
      severity: 'error',
      message: `A ação "${definition.label}" não funciona com o gatilho selecionado.`,
      nodeId,
    });
  }

  const availablePaths = new Set(fieldsForTrigger(triggerType).map(f => f.path));

  for (const param of definition.params) {
    const value = config[param.key];

    if (param.required && (value == null || value === '')) {
      problems.push({
        severity: 'error',
        message: `${label ?? definition.label}: "${param.label}" é obrigatório.`,
        nodeId,
      });
      continue;
    }

    if (param.interpolable && typeof value === 'string') {
      // Variável inexistente é recusada aqui, antes de ativar. Deixar passar
      // produziria "(indisponível)" na notificação em produção.
      for (const path of extractPaths(value)) {
        const isActionOutput = path.startsWith('actions.');
        // O corpo de um webhook é do remetente: não há como catalogar seus campos, e
        // exigir que estivessem no registry tornaria o gatilho inútil. Qualquer
        // caminho sob trigger.webhook.body é aceito, e o interpolador marca como
        // indisponível o que não existir na entrega real.
        const isWebhookBody = path.startsWith('trigger.webhook.body.');
        if (!isActionOutput && !isWebhookBody && !availablePaths.has(path)) {
          problems.push({
            severity: 'error',
            message: `${label ?? definition.label}: a variável {{${path}}} não existe neste gatilho.`,
            nodeId,
          });
        }
      }
    }

    if (param.kind === 'url' && typeof value === 'string' && value !== '') {
      const problem = validateWebhookUrl(value);
      if (problem != null) {
        problems.push({ severity: 'error', message: `${label ?? definition.label}: ${problem}`, nodeId });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL de webhook
// ─────────────────────────────────────────────────────────────────────────────

/** Bloqueia destino que não deveria ser alcançável a partir do servidor.
 *
 *  Sem isto, uma ação de webhook é um SSRF: o usuário configura a URL e o nosso
 *  servidor a chama, o que dá acesso a qualquer endereço que ELE alcança — inclusive
 *  a rede interna e o serviço de metadados da nuvem, que serve credenciais.
 *
 *  A checagem por nome de host não é completa (um domínio público pode resolver
 *  para 127.0.0.1), e por isso está declarada como limitação em vez de apresentada
 *  como suficiente. Bloquear o que é obviamente interno já elimina o caso comum de
 *  configuração errada e o abuso mais simples; a defesa completa exige resolver o
 *  DNS no momento da chamada.
 *
 *  Duplicada no executor do servidor de propósito: validar só aqui deixaria uma
 *  automação salva por outro caminho passar sem checagem. */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'a URL informada é inválida.';
  }

  if (url.protocol !== 'https:') {
    // HTTP em claro levaria o contexto da automação — SKU, saldos, ids — pela rede
    // sem cifra.
    return 'a URL precisa usar HTTPS.';
  }

  const host = url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    return 'endereços locais não são permitidos.';
  }

  // Faixas privadas e link-local em notação literal. 169.254.169.254 é o serviço de
  // metadados das nuvens e o alvo clássico deste tipo de abuso.
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host)
  ) {
    return 'endereços de rede interna não são permitidos.';
  }

  return null;
}

/** Cabeçalhos de um textarea "Nome: valor" por linha.
 *
 *  Lista de permissão de nomes: um `Host` ou `Content-Length` forjado muda o
 *  significado da requisição, e cabeçalho arbitrário é caminho para request
 *  smuggling. Nomes fora da lista são descartados em silêncio — o editor já explica
 *  o formato, e falhar a automação por um cabeçalho extra seria pior. */
const ALLOWED_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'x-auth-token',
  'x-webhook-secret',
  'x-signature',
]);

export function parseWebhookHeaders(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};

  const headers: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (name === '' || value === '') continue;
    if (!ALLOWED_HEADER_NAMES.has(name)) continue;

    headers[name] = value;
  }

  return headers;
}

/** Teto de iterações que a validação aceita. Igual ao MAX_LOOP_ITERATIONS do engine,
 *  declarado aqui para workflow.ts não importar engine.ts — a dependência é na outra
 *  direção, e inverter criaria ciclo. */
export const MAX_LOOP_ITERATIONS_LIMIT = 100;

/** Nodes alcançáveis a partir de um ponto, sem passar pelo node que se está
 *  inspecionando.
 *
 *  `stopAt` evita seguir de volta pelo próprio laço: a saída `after` do loop leva ao
 *  fluxo principal, que NÃO é corpo do laço, e incluí-lo faria a validação recusar um
 *  delay legítimo colocado depois do laço. */
export function nodesReachableFrom(
  workflow: AutomationWorkflow,
  startNodeId: string,
  stopAt: string
): AutomationNode[] {
  const seen = new Set<string>([stopAt]);
  const found: AutomationNode[] = [];
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    if (seen.has(currentId)) continue;
    seen.add(currentId);

    const node = workflow.nodes.find(n => n.id === currentId);
    if (node == null) continue;
    found.push(node);

    for (const edge of outgoingEdges(workflow, currentId)) queue.push(edge.to);
  }

  return found;
}
