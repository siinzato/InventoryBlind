// Catálogo de planos — fonte única.
//
// Estes dados viviam apenas dentro de landing/Plans.tsx. O diagnóstico da operação
// precisa recomendar um plano real, e duplicar nome/preço/recursos criaria duas
// verdades que divergem na primeira alteração comercial. Plans.tsx passa a importar
// daqui; nada da apresentação da landing mudou.
//
// Só entra aqui o que já é praticado hoje. Nenhum limite numérico está declarado
// porque nenhum é aplicado pelo produto — inventar "até N SKUs" seria criar regra
// comercial que não existe.

export type PlanKey = 'free' | 'pro' | 'business' | 'enterprise';

export interface PlanDef {
  key: PlanKey;
  name: string;
  price: string;
  period?: string;
  desc: string;
  features: string[];
  featured?: boolean;
  cta: string;
}

export const PLANS: PlanDef[] = [
  {
    key: 'free',
    name: 'Free',
    price: 'R$ 0',
    period: '/mês',
    desc: 'Para começar a organizar e controlar seu inventário.',
    features: ['Acesso gratuito e permanente', 'Dashboard básico', 'Conferência de inventário', 'Indicadores essenciais'],
    cta: 'Comece grátis',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 'R$ 120',
    period: '/mês',
    desc: 'Para operações que precisam de mais controle e inteligência.',
    features: ['BlindAI com análises avançadas', 'Confidence & Risk Score', 'Classificação ABC/XYZ', 'Indicadores avançados'],
    cta: 'Comece grátis',
  },
  {
    key: 'business',
    name: 'Business',
    price: 'R$ 320',
    period: '/mês',
    desc: 'Para operações em crescimento que precisam de mais escala e análise.',
    features: ['BlindAI com maior profundidade operacional', 'HeatMap Inteligente', 'Auditoria avançada', 'Multiempresa'],
    featured: true,
    cta: 'Comece grátis',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Sob consulta',
    desc: 'Para operações corporativas com necessidades específicas.',
    features: ['BlindAI adaptado à operação corporativa', 'Gestão de usuários e papéis', 'Suporte dedicado', 'SLA personalizado'],
    cta: 'Falar com vendas',
  },
];

/** Ordem comercial, do menor para o maior. Usada para achar o plano imediatamente
 *  inferior ao recomendado, na comparação curta do resultado. */
export const PLAN_ORDER: PlanKey[] = ['free', 'pro', 'business', 'enterprise'];

export function getPlan(key: PlanKey): PlanDef {
  const plan = PLANS.find(p => p.key === key);
  if (plan == null) throw new Error(`Plano desconhecido: ${key}`);
  return plan;
}

/** O plano um degrau abaixo, ou null se já for o Free. */
export function planBelow(key: PlanKey): PlanDef | null {
  const index = PLAN_ORDER.indexOf(key);
  return index > 0 ? getPlan(PLAN_ORDER[index - 1]) : null;
}
