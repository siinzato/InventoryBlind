// Diagnóstico da operação — perguntas, pesos e regra de recomendação. Puro.
//
// Tudo o que decide a recomendação está neste arquivo: as perguntas, as opções, os
// pesos, os limiares e as razões. A tela só renderiza o que está declarado aqui e
// mostra o que `recommendPlan` devolveu — nenhuma regra mora em componente.
//
// Nada aqui usa IA, LLM ou serviço externo: a mesma entrada sempre produz a mesma
// saída, e o resultado é auditável lendo os pesos abaixo.

import { getPlan, planBelow, type PlanDef, type PlanKey } from './plans';

// ─────────────────────────────────────────────────────────────────────────────
// Estrutura
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosticOption {
  value: string;
  label: string;
  /** Contribuição para o porte da operação. Ausente = 0.
   *
   *  "Não sei" e "Ainda não sabemos" nunca declaram peso: desconhecimento não é
   *  sinal de operação grande nem pequena, e pontuá-lo empurraria para cima quem
   *  simplesmente não tem o dado. */
  weight?: number;
}

export interface DiagnosticQuestion {
  id: string;
  label: string;
  /** Só quando a pergunta sozinha não se explica. */
  hint?: string;
  kind: 'single' | 'multi';
  options: DiagnosticOption[];
  /** Multi sem nenhuma marcação continua válida (ex.: nenhum marketplace). */
  optional?: boolean;
}

export interface DiagnosticStep {
  id: string;
  title: string;
  description?: string;
  questions: DiagnosticQuestion[];
}

/** Resposta de uma pergunta: `single` guarda um valor, `multi` guarda vários. */
export type DiagnosticAnswers = Record<string, string[]>;

const UNKNOWN = 'nao_sei';

// ─────────────────────────────────────────────────────────────────────────────
// Perguntas
// ─────────────────────────────────────────────────────────────────────────────

export const DIAGNOSTIC_STEPS: DiagnosticStep[] = [
  {
    id: 'perfil',
    title: 'Perfil da operação',
    questions: [
      {
        id: 'segmento',
        label: 'Qual o segmento da empresa?',
        kind: 'single',
        options: [
          { value: 'varejo', label: 'Varejo' },
          { value: 'ecommerce', label: 'E-commerce' },
          { value: 'distribuicao', label: 'Distribuição / atacado' },
          { value: 'industria', label: 'Indústria' },
          { value: 'logistica', label: 'Operador logístico' },
          { value: 'outro', label: 'Outro' },
        ],
      },
      {
        id: 'locais',
        label: 'Quantos galpões ou locais de estoque a empresa mantém?',
        kind: 'single',
        options: [
          { value: '1', label: '1 local', weight: 0 },
          { value: '2-3', label: '2 a 3 locais', weight: 2 },
          { value: '4-10', label: '4 a 10 locais', weight: 4 },
          { value: '10+', label: 'Mais de 10 locais', weight: 6 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'area',
        label: 'Qual o tamanho aproximado do espaço operacional?',
        hint: 'Selecione a faixa mais próxima.',
        kind: 'single',
        options: [
          { value: 'ate-500', label: 'Até 500 m²', weight: 0 },
          { value: '500-2000', label: '500 a 2.000 m²', weight: 1 },
          { value: '2000-10000', label: '2.000 a 10.000 m²', weight: 3 },
          { value: '10000+', label: 'Acima de 10.000 m²', weight: 4 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
    ],
  },
  {
    id: 'volume',
    title: 'Volume de estoque',
    questions: [
      {
        id: 'skus',
        label: 'Quantos SKUs ativos sua empresa administra?',
        hint: 'Selecione a faixa mais próxima.',
        kind: 'single',
        options: [
          { value: 'ate-500', label: 'Até 500', weight: 0 },
          { value: '500-5000', label: '500 a 5.000', weight: 2 },
          { value: '5000-20000', label: '5.000 a 20.000', weight: 4 },
          { value: '20000+', label: 'Acima de 20.000', weight: 6 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'funcionarios',
        label: 'Quantas pessoas trabalham com o estoque?',
        kind: 'single',
        options: [
          { value: 'ate-5', label: 'Até 5', weight: 0 },
          { value: '6-20', label: '6 a 20', weight: 2 },
          { value: '21-50', label: '21 a 50', weight: 3 },
          { value: '50+', label: 'Mais de 50', weight: 4 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'operadores',
        label: 'Quantos operadores participam dos inventários?',
        kind: 'single',
        options: [
          { value: 'ate-3', label: 'Até 3', weight: 0 },
          { value: '4-10', label: '4 a 10', weight: 2 },
          { value: '11-30', label: '11 a 30', weight: 3 },
          { value: '30+', label: 'Mais de 30', weight: 4 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'frequencia',
        label: 'Com que frequência as contagens acontecem?',
        kind: 'single',
        options: [
          { value: 'anual', label: 'Uma vez por ano', weight: 0 },
          { value: 'semestral', label: 'Semestral', weight: 1 },
          { value: 'mensal', label: 'Mensal', weight: 2 },
          { value: 'semanal', label: 'Semanal ou cíclica', weight: 3 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
    ],
  },
  {
    id: 'sistemas',
    title: 'Sistemas utilizados',
    questions: [
      {
        id: 'erp',
        label: 'Qual ERP a empresa utiliza?',
        kind: 'single',
        options: [
          { value: 'nenhum', label: 'Nenhum', weight: 0 },
          { value: 'tiny', label: 'Tiny', weight: 2 },
          { value: 'bling', label: 'Bling', weight: 2 },
          { value: 'omie', label: 'Omie', weight: 2 },
          { value: 'sap', label: 'SAP', weight: 3 },
          { value: 'totvs', label: 'TOTVS', weight: 3 },
          { value: 'outro', label: 'Outro', weight: 2 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'wms',
        label: 'A operação usa WMS?',
        kind: 'single',
        options: [
          { value: 'sim', label: 'Sim', weight: 2 },
          { value: 'nao', label: 'Não', weight: 0 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
      {
        id: 'canais',
        label: 'Em quais plataformas ou marketplaces a empresa vende?',
        hint: 'Selecione todas que se aplicam.',
        kind: 'multi',
        optional: true,
        options: [
          { value: 'mercado_livre', label: 'Mercado Livre', weight: 1 },
          { value: 'shopee', label: 'Shopee', weight: 1 },
          { value: 'amazon', label: 'Amazon', weight: 1 },
          { value: 'loja_propria', label: 'Loja própria', weight: 1 },
          { value: 'loja_fisica', label: 'Loja física', weight: 0 },
          { value: 'outro', label: 'Outro', weight: 1 },
        ],
      },
      {
        id: 'metodo',
        label: 'Como o inventário é feito hoje?',
        kind: 'single',
        options: [
          { value: 'papel', label: 'Papel', weight: 3 },
          { value: 'planilha', label: 'Planilha', weight: 2 },
          { value: 'erp', label: 'Direto no ERP', weight: 1 },
          { value: 'coletor', label: 'Coletor de dados', weight: 1 },
          { value: 'aplicativo', label: 'Aplicativo próprio', weight: 1 },
          { value: UNKNOWN, label: 'Não sei' },
        ],
      },
    ],
  },
  {
    id: 'situacao',
    title: 'Situação atual do estoque',
    questions: [
      {
        id: 'confianca',
        label: 'Qual a confiança no saldo de estoque hoje?',
        kind: 'single',
        options: [
          { value: 'critica', label: 'Crítica', weight: 4 },
          { value: 'precisa_melhorar', label: 'Precisa melhorar', weight: 3 },
          { value: 'sob_controle', label: 'Sob controle', weight: 1 },
          { value: 'muito_boa', label: 'Muito boa', weight: 0 },
          { value: UNKNOWN, label: 'Ainda não sabemos' },
        ],
      },
      {
        id: 'divergencias',
        label: 'Com que frequência aparecem divergências?',
        kind: 'single',
        options: [
          { value: 'constante', label: 'Constantemente', weight: 4 },
          { value: 'frequente', label: 'Com frequência', weight: 3 },
          { value: 'ocasional', label: 'Ocasionalmente', weight: 1 },
          { value: 'rara', label: 'Raramente', weight: 0 },
          { value: UNKNOWN, label: 'Ainda não sabemos' },
        ],
      },
      {
        id: 'recontagens',
        label: 'Quanta recontagem o último inventário exigiu?',
        kind: 'single',
        options: [
          { value: 'muita', label: 'Boa parte dos itens', weight: 3 },
          { value: 'alguma', label: 'Alguns itens', weight: 2 },
          { value: 'pouca', label: 'Quase nenhum', weight: 0 },
          { value: UNKNOWN, label: 'Ainda não sabemos' },
        ],
      },
      {
        id: 'prazo',
        label: 'Concluir o inventário no prazo é um problema?',
        kind: 'single',
        options: [
          { value: 'sempre', label: 'Sempre atrasa', weight: 3 },
          { value: 'as_vezes', label: 'Às vezes atrasa', weight: 2 },
          { value: 'nao', label: 'Fecha no prazo', weight: 0 },
          { value: UNKNOWN, label: 'Ainda não sabemos' },
        ],
      },
      {
        id: 'cadastro',
        label: 'Há produtos sem localização, EAN ou saldo confiável?',
        kind: 'single',
        options: [
          { value: 'maioria', label: 'Boa parte do cadastro', weight: 3 },
          { value: 'parte', label: 'Uma parte', weight: 2 },
          { value: 'poucos', label: 'Quase nenhum', weight: 0 },
          { value: UNKNOWN, label: 'Ainda não sabemos' },
        ],
      },
    ],
  },
  {
    id: 'objetivos',
    title: 'Objetivos da operação',
    description: 'Selecione o que a empresa precisa resolver.',
    questions: [
      {
        id: 'objetivos',
        label: 'O que você quer alcançar com o InventoryBlind?',
        kind: 'multi',
        options: [
          { value: 'reduzir_divergencias', label: 'Reduzir divergências', weight: 1 },
          { value: 'produtividade', label: 'Aumentar produtividade', weight: 1 },
          { value: 'auditorias', label: 'Automatizar auditorias', weight: 2 },
          { value: 'erp', label: 'Integrar o ERP', weight: 2 },
          { value: 'causas', label: 'Identificar causas dos problemas', weight: 2 },
          { value: 'multiplos_locais', label: 'Gerenciar múltiplos locais', weight: 2 },
          { value: 'treinar', label: 'Treinar operadores', weight: 1 },
          { value: 'indicadores', label: 'Melhorar indicadores', weight: 1 },
          { value: 'confiabilidade', label: 'Aumentar a confiabilidade do estoque', weight: 1 },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pontuação
// ─────────────────────────────────────────────────────────────────────────────

/** Teto de contribuição de uma pergunta `multi`.
 *
 *  Sem o teto, marcar todos os objetivos somaria 13 pontos e levaria qualquer
 *  operação ao topo — o que transformaria uma lista de desejos em porte de
 *  operação. */
const MULTI_QUESTION_CAP = 4;

/** Limiares acumulados por plano, do maior para o menor.
 *
 *  A soma máxima possível dos pesos acima é 60. Os cortes dividem essa faixa de
 *  forma que o degrau mais caro exija sinal forte em várias dimensões ao mesmo
 *  tempo: uma operação de porte médio (poucos locais, milhares de SKUs, um ERP)
 *  pontua na casa dos 30 e fica no Pro, não no Business. Recomendar acima do
 *  necessário é pior do que recomendar abaixo — quem precisa de mais migra; quem
 *  foi empurrado para cima desconfia da recomendação inteira. */
const TIER_THRESHOLDS: { key: PlanKey; min: number }[] = [
  { key: 'enterprise', min: 48 },
  { key: 'business', min: 34 },
  { key: 'pro', min: 16 },
  { key: 'free', min: 0 },
];

const ALL_QUESTIONS: DiagnosticQuestion[] = DIAGNOSTIC_STEPS.flatMap(s => s.questions);

export function findQuestion(id: string): DiagnosticQuestion | null {
  return ALL_QUESTIONS.find(q => q.id === id) ?? null;
}

export function findOptionLabel(questionId: string, value: string): string {
  return findQuestion(questionId)?.options.find(o => o.value === value)?.label ?? value;
}

/** Pontos de uma pergunta isolada, já com o teto de múltipla escolha aplicado. */
function questionScore(question: DiagnosticQuestion, answers: DiagnosticAnswers): number {
  const selected = answers[question.id] ?? [];
  const total = selected.reduce((sum, value) => {
    const option = question.options.find(o => o.value === value);
    return sum + (option?.weight ?? 0);
  }, 0);
  return question.kind === 'multi' ? Math.min(total, MULTI_QUESTION_CAP) : total;
}

function tierForScore(score: number): PlanKey {
  return (TIER_THRESHOLDS.find(t => score >= t.min) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]).key;
}

function tierIndex(key: PlanKey): number {
  return TIER_THRESHOLDS.length - 1 - TIER_THRESHOLDS.findIndex(t => t.key === key);
}

function tierByIndex(index: number): PlanKey {
  const clamped = Math.max(0, Math.min(TIER_THRESHOLDS.length - 1, index));
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1 - clamped].key;
}

export interface Recommendation {
  plan: PlanDef;
  /** Plano imediatamente inferior, para a comparação curta. */
  previous: PlanDef | null;
  score: number;
  /** Até três razões objetivas, derivadas das respostas dadas. */
  reasons: string[];
  /** Resumo curto do perfil, montado a partir das faixas escolhidas. */
  profileSummary: string;
  /** Quantas perguntas ficaram sem resposta ou marcadas como desconhecidas. */
  unknownCount: number;
}

/** Razões possíveis, em ordem de prioridade. A primeira condição verdadeira entra.
 *
 *  Texto fixo, escrito aqui: nada é gerado em tempo de execução, então a mesma
 *  resposta sempre produz a mesma justificativa. */
const REASON_RULES: { when: (a: DiagnosticAnswers) => boolean; text: string }[] = [
  {
    when: a => has(a, 'skus', ['5000-20000', '20000+']),
    text: 'O volume de SKUs informado exige priorizar o que contar em vez de contar tudo.',
  },
  {
    when: a => has(a, 'locais', ['2-3', '4-10', '10+']),
    text: 'A operação usa mais de um local de estoque, o que separa indicadores e responsabilidades.',
  },
  {
    when: a => has(a, 'operadores', ['11-30', '30+']) || has(a, 'funcionarios', ['21-50', '50+']),
    text: 'O número de operadores envolvidos nos inventários pede controle de produtividade por pessoa.',
  },
  {
    when: a => has(a, 'confianca', ['critica', 'precisa_melhorar']) || has(a, 'divergencias', ['constante', 'frequente']),
    text: 'A frequência de divergências relatada justifica acompanhar risco e confiança por produto.',
  },
  {
    when: a => has(a, 'erp', ['tiny', 'bling', 'omie', 'sap', 'totvs', 'outro']) || has(a, 'objetivos', ['erp']),
    text: 'Há um ERP em uso, e manter o saldo sincronizado evita recontagem por dado desatualizado.',
  },
  {
    when: a => has(a, 'objetivos', ['auditorias', 'causas']),
    text: 'Auditoria e análise de causa foram apontadas como objetivo da operação.',
  },
  {
    when: a => has(a, 'metodo', ['papel', 'planilha']),
    text: 'O inventário ainda é feito fora de um sistema, o que limita rastreabilidade.',
  },
  {
    when: a => has(a, 'frequencia', ['mensal', 'semanal']),
    text: 'A frequência de contagem informada torna o ganho por ciclo maior.',
  },
];

function has(answers: DiagnosticAnswers, questionId: string, values: string[]): boolean {
  const selected = answers[questionId] ?? [];
  return selected.some(v => values.includes(v));
}

function buildProfileSummary(answers: DiagnosticAnswers): string {
  const parts: string[] = [];
  const skus = answers.skus?.[0];
  const locais = answers.locais?.[0];
  const operadores = answers.operadores?.[0];

  if (skus && skus !== UNKNOWN) parts.push(`${findOptionLabel('skus', skus)} SKUs ativos`);
  if (locais && locais !== UNKNOWN) parts.push(findOptionLabel('locais', locais).toLowerCase());
  if (operadores && operadores !== UNKNOWN) parts.push(`${findOptionLabel('operadores', operadores)} operadores no inventário`);

  return parts.length > 0 ? parts.join(' · ') : 'Perfil ainda não detalhado.';
}

/** Recomendação determinística.
 *
 *  ── Por que uma resposta sozinha não decide ─────────────────────────────────
 *  O plano sai do MENOR entre (a) o degrau que a pontuação total alcança e (b) um
 *  degrau acima do que a pontuação alcança sem a pergunta que mais pontuou. Quem
 *  marcou uma única faixa alta e o resto baixo sobe no máximo um degrau, e nunca
 *  chega ao topo por causa de um clique só. */
export function recommendPlan(answers: DiagnosticAnswers): Recommendation {
  const perQuestion = ALL_QUESTIONS.map(q => questionScore(q, answers));
  const total = perQuestion.reduce((sum, n) => sum + n, 0);
  const highest = perQuestion.length > 0 ? Math.max(...perQuestion) : 0;

  const fullTier = tierForScore(total);
  const withoutTopTier = tierForScore(total - highest);
  const key = tierByIndex(Math.min(tierIndex(fullTier), tierIndex(withoutTopTier) + 1));

  const unknownCount = ALL_QUESTIONS.filter(q => {
    const selected = answers[q.id] ?? [];
    return selected.length === 0 || selected.includes(UNKNOWN);
  }).length;

  return {
    plan: getPlan(key),
    previous: planBelow(key),
    score: total,
    reasons: REASON_RULES.filter(r => r.when(answers)).slice(0, 3).map(r => r.text),
    profileSummary: buildProfileSummary(answers),
    unknownCount,
  };
}

/** Uma etapa está completa quando toda pergunta obrigatória tem resposta. */
export function isStepComplete(step: DiagnosticStep, answers: DiagnosticAnswers): boolean {
  return step.questions.every(q => q.optional || (answers[q.id]?.length ?? 0) > 0);
}

export const DIAGNOSTIC_UNKNOWN_VALUE = UNKNOWN;
