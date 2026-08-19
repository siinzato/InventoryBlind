// Automation Engine — tipos do domínio.
//
// Um workflow é DADO, não código: nodes e edges persistidos em jsonb que o engine
// interpreta. É o que permite ao usuário compor livremente sem ninguém escrever
// uma automação por regra.
//
// Nada aqui executa nada. Os tipos existem para que uma composição inválida seja
// erro de compilação onde for possível, e erro de validação onde não for.

// ─────────────────────────────────────────────────────────────────────────────
// Nodes
// ─────────────────────────────────────────────────────────────────────────────

/** Os tipos de node suportados.
 *
 *  Os três últimos foram os que exigiram mais do modelo, e cada um resolveu o
 *  problema de forma diferente:
 *
 *    loop          roda inteiro dentro de uma execução, com teto obrigatório
 *    webhook_wait  interrompe e retoma, reusando a mecânica do delay
 *    agent         chamada externa comum, como um webhook de saída
 *
 *  Nenhum deles precisou de mudança no grafo nem na persistência: são membros desta
 *  união mais uma entrada no executor. */
export type NodeType =
  | 'trigger'
  | 'condition'
  | 'branch'
  | 'action'
  | 'delay'
  | 'switch'
  | 'loop'
  | 'webhook_wait'
  | 'agent';

export interface BaseNode {
  /** Estável dentro do workflow. Referenciado pelas edges e pelo log de execução,
   *  então NÃO pode ser o índice na lista — reordenar quebraria os logs antigos. */
  id: string;
  type: NodeType;
  /** Rótulo que o usuário vê. Editável, e por isso nunca usado como identidade. */
  label?: string;
  /** Onde o bloco fica no canvas. AUSENTE é o estado normal de um workflow salvo
   *  antes do editor livre, e também de um criado por template — layout.ts calcula a
   *  posição a partir do grafo. Preenchido quando o usuário arrasta, e a partir daí
   *  respeitado. */
  position?: { x: number; y: number };
}

export interface TriggerNode extends BaseNode {
  type: 'trigger';
  triggerType: string;
  config: Record<string, unknown>;
}

/** Uma comparação: campo, operador, valor.
 *
 *  Agrupadas por `logic` no node, e aninháveis por `groups` — `(a E b) OU c` é
 *  expressável. Ver conditionGroups.ts. */
export interface ConditionRule {
  field: string;
  operator: string;
  value: unknown;
}

export interface ConditionNode extends BaseNode {
  type: 'condition';
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
  /** Subgrupos, para expressar (a E b) OU c. Ausente = um nível, que é o estado de
   *  todo workflow salvo antes do aninhamento existir. Ver conditionGroups.ts. */
  groups?: import('./conditionGroups').ConditionGroup[];
}

/** Igual a `condition` na avaliação; difere no que o engine faz depois — branch
 *  segue por duas saídas rotuladas, condition segue adiante ou para.
 *
 *  Tipos separados em vez de uma flag porque o número de saídas é estrutural: a
 *  validação do grafo precisa saber, sem olhar configuração, que este node tem
 *  duas arestas de significado diferente. */
export interface BranchNode extends BaseNode {
  type: 'branch';
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
  groups?: import('./conditionGroups').ConditionGroup[];
}

export interface ActionNode extends BaseNode {
  type: 'action';
  actionType: string;
  config: Record<string, unknown>;
  /** Retentativas para ações externas. Ignorado por ações sem idempotência
   *  garantida — repetir a criação de uma recontagem criaria duas. */
  maxAttempts?: number;
}

/** Espera antes de seguir.
 *
 *  ── Por que a espera NÃO é um sleep ────────────────────────────────────────
 *  Uma Edge Function tem teto de tempo, e dormir 30 minutos dentro dela é
 *  impossível. Então o delay INTERROMPE a execução e reagenda: grava um evento
 *  futuro que carrega o ponto de retomada, e a execução atual termina com status
 *  `success` até ali. A continuação é uma execução nova ligada à primeira.
 *
 *  É por isso que o valor mínimo é em minutos, não em segundos: um delay de 5
 *  segundos custaria uma volta inteira pela fila e chegaria depois de um minuto de
 *  qualquer forma. Prometer segundos seria mentir sobre a precisão. */
export interface DelayNode extends BaseNode {
  type: 'delay';
  minutes: number;
}

/** Vários caminhos por valor de um campo, em vez de dois por verdadeiro/falso.
 *
 *  Substitui uma cadeia de branches quando a decisão é sobre QUAL valor um campo
 *  tem. As saídas são nomeadas pelo próprio valor, e `default` recebe o que não
 *  casou — sem default, um valor inesperado encerraria o fluxo em silêncio. */
export interface SwitchCase {
  /** Valor comparado com igualdade frouxa, igual ao operador `equals`. */
  value: string;
  /** Rótulo da saída na tela. */
  label?: string;
}

export interface SwitchNode extends BaseNode {
  type: 'switch';
  field: string;
  cases: SwitchCase[];
}

/** Repete o caminho seguinte para cada item de uma lista do contexto.
 *
 *  ── Sem estado entre invocações ─────────────────────────────────────────────
 *  O laço roda INTEIRO dentro de uma execução, não por reagendamento. É o que permite
 *  implementá-lo no modelo atual — uma execução vai do início ao fim numa passagem — e
 *  é também por isso que tem teto obrigatório: um laço sobre uma lista de 8.000 SKUs
 *  estouraria o tempo da função no meio, e metade das ações aplicadas sem registro do
 *  resto é o pior resultado possível.
 *
 *  O teto é do node, não global: quem itera 5 depósitos e quem itera 50 divergências
 *  têm expectativas diferentes, e um número escondido no engine seria um limite que
 *  ninguém vê ao configurar.
 *
 *  Duas saídas: `loop` para o corpo repetido e `after` para o que vem depois de
 *  terminar. Sem a segunda não haveria como continuar o fluxo. */
export interface LoopNode extends BaseNode {
  type: 'loop';
  /** Caminho para uma lista no contexto, ex. `trigger.webhook.body.itens`. */
  field: string;
  maxIterations: number;
}

/** Pausa até um sistema externo chamar de volta.
 *
 *  Reusa a infraestrutura de retomada do node de espera: a execução para, grava onde
 *  continuar, e um POST no endpoint de webhook com o token da espera a retoma. A
 *  diferença é o gatilho da retomada — tempo lá, chamada externa aqui.
 *
 *  `timeoutMinutes` é obrigatório e não opcional: uma espera sem prazo é uma execução
 *  que fica pendente para sempre quando o sistema externo nunca responde, e o
 *  histórico enche de linhas que ninguém consegue fechar. */
export interface WebhookWaitNode extends BaseNode {
  type: 'webhook_wait';
  timeoutMinutes: number;
}

/** Consulta o BlindAI e disponibiliza a resposta para os nodes seguintes.
 *
 *  ── É IA de verdade ─────────────────────────────────────────────────────────
 *  Chama a Anthropic com a chave que já existe como secret do projeto, o mesmo
 *  provedor que alimenta o BlindAI do resto do produto. Não há simulação: se a chave
 *  faltar, o node FALHA com mensagem clara em vez de devolver texto inventado.
 *
 *  O prompt é interpolável, então o contexto entra nele por variável — não por acesso
 *  livre do modelo aos dados. O que o modelo vê é o que o usuário escreveu, e nada
 *  além. */
export interface AgentNode extends BaseNode {
  type: 'agent';
  /** Instrução, com variáveis do contexto. */
  prompt: string;
  /** Teto de tokens da resposta. Existe porque o custo é por token e uma automação
   *  que roda a cada contagem multiplica esse custo. */
  maxTokens?: number;
}

export type AutomationNode =
  | TriggerNode
  | ConditionNode
  | BranchNode
  | ActionNode
  | DelayNode
  | SwitchNode
  | LoopNode
  | WebhookWaitNode
  | AgentNode;

// ─────────────────────────────────────────────────────────────────────────────
// Edges
// ─────────────────────────────────────────────────────────────────────────────

/** Saída do node de origem.
 *
 *  `true`/`false` saem de um branch; `next` é a saída única do resto. Um switch usa
 *  `case:<valor>` e `default` — string livre em vez de união fechada porque os
 *  valores são do usuário, e o validador confere que cada aresta de switch
 *  corresponde a um caso declarado. */
export type EdgeBranch =
  | 'next'
  | 'true'
  | 'false'
  | 'default'
  /** Corpo de um laço, repetido por item. */
  | 'loop'
  /** Continuação depois de o laço terminar. */
  | 'after'
  | (string & {});

/** Prefixo das saídas de switch. Constante para o validador, o engine e o editor
 *  concordarem sobre a forma sem repetir literal. */
export const SWITCH_BRANCH_PREFIX = 'case:';

export function switchBranch(value: string): string {
  return SWITCH_BRANCH_PREFIX + value;
}

export interface AutomationEdge {
  from: string;
  to: string;
  branch: EdgeBranch;
}

export interface AutomationWorkflow {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

export const EMPTY_WORKFLOW: AutomationWorkflow = { nodes: [], edges: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Automação
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationStatus = 'draft' | 'active' | 'inactive' | 'error';

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  inactive: 'Inativa',
  error: 'Com erro',
};

export interface Automation {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  triggerType: string;
  workflow: AutomationWorkflow;
  version: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt: string | null;
  executionCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos e contexto
// ─────────────────────────────────────────────────────────────────────────────

export interface AutomationEvent {
  id: string;
  companyId: string;
  eventType: string;
  payload: Record<string, unknown>;
  sourceTable: string | null;
  sourceId: string | null;
  originExecutionId: string | null;
  originAutomationId: string | null;
  depth: number;
  createdAt: string;
  /** Preenchido só em evento de retomada, gravado por um node de espera
   *  (migration 056). Sua presença é o que faz o engine começar no meio do
   *  workflow em vez de no gatilho. */
  resume?: {
    automationId: string;
    nodeId: string;
    actions: Record<string, unknown>;
    fromExecutionId: string | null;
  } | null;
}

/** O que nodes posteriores podem ler (§21).
 *
 *  Duas raízes e nada mais: `trigger` com o payload do evento e `actions` com a
 *  saída das ações já executadas, indexada por node id. Um espaço de nomes fechado
 *  é o que permite ao editor oferecer os campos disponíveis e ao interpolador
 *  recusar qualquer outro caminho — em vez de avaliar expressão arbitrária. */
export interface ExecutionContext {
  trigger: Record<string, unknown>;
  actions: Record<string, unknown>;
  /** Item corrente dentro de um laço. Espaço de nomes próprio em vez de mexer em
   *  `trigger`: o corpo do laço precisa ler o item sem que o dado do gatilho pareça
   *  ter mudado. Ausente fora de um laço. */
  loop?: { item: unknown; index: number; total: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export const EXECUTION_STATUS_LABEL: Record<ExecutionStatus, string> = {
  running: 'Executando',
  success: 'Sucesso',
  partial: 'Parcial',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export type TriggerSource = 'event' | 'manual' | 'schedule' | 'webhook';

export interface AutomationExecution {
  id: string;
  companyId: string;
  automationId: string;
  eventId: string | null;
  automationVersion: number;
  triggerType: string;
  triggerSource: TriggerSource;
  status: ExecutionStatus;
  dryRun: boolean;
  context: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  depth: number;
}

export type NodeExecutionStatus = 'success' | 'failed' | 'skipped';

export interface NodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string | null;
  sequence: number;
  status: NodeExecutionStatus;
  conditionResult: boolean | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface AutomationNotification {
  id: string;
  companyId: string;
  recipientId: string | null;
  title: string;
  body: string | null;
  severity: 'info' | 'warning' | 'critical';
  executionId: string | null;
  automationId: string | null;
  readAt: string | null;
  createdAt: string;
}
