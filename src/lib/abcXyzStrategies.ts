// Classificação ABC+XYZ — estratégias operacionais por combinação.
// Conteúdo estático (mesmo padrão de academyContent.ts) — as 9 combinações não mudam por
// empresa, só o texto explicativo de cada uma.

import type { AbcXyzCombo } from './supabase';

export interface AbcXyzStrategy {
  combo: AbcXyzCombo;
  title: string;
  description: string;
  priority: 'maxima' | 'alta' | 'media' | 'baixa';
  countingGuidance: string;
}

export const ABC_XYZ_STRATEGIES: Record<AbcXyzCombo, AbcXyzStrategy> = {
  AX: {
    combo: 'AX',
    title: 'Alta prioridade, demanda estável',
    description: 'Alto valor movimentado com demanda previsível.',
    priority: 'alta',
    countingGuidance: 'Alta prioridade, contagem frequente, monitoramento constante.',
  },
  AY: {
    combo: 'AY',
    title: 'Alto valor, demanda moderadamente variável',
    description: 'Alto valor movimentado com variabilidade média de demanda — exige atenção a picos.',
    priority: 'alta',
    countingGuidance: 'Contagem frequente com margem de segurança maior que AX.',
  },
  AZ: {
    combo: 'AZ',
    title: 'Máxima atenção',
    description: 'Alto valor e demanda instável — maior risco financeiro combinado com imprevisibilidade.',
    priority: 'maxima',
    countingGuidance: 'Máxima atenção, alto valor e demanda instável — contagem mais frequente do catálogo.',
  },
  BX: {
    combo: 'BX',
    title: 'Prioridade intermediária, estável',
    description: 'Valor moderado com demanda previsível.',
    priority: 'media',
    countingGuidance: 'Contagem regular, ciclo intermediário.',
  },
  BY: {
    combo: 'BY',
    title: 'Prioridade intermediária, variável',
    description: 'Valor moderado com variabilidade média — acompanhar tendência de demanda.',
    priority: 'media',
    countingGuidance: 'Contagem regular com revisão periódica de previsão de demanda.',
  },
  BZ: {
    combo: 'BZ',
    title: 'Monitoramento elevado',
    description: 'Valor moderado com demanda instável — risco de ruptura ou excesso.',
    priority: 'alta',
    countingGuidance: 'Monitoramento elevado, contagem mais frequente que o padrão de classe B.',
  },
  CX: {
    combo: 'CX',
    title: 'Baixa prioridade',
    description: 'Baixo valor movimentado com demanda previsível.',
    priority: 'baixa',
    countingGuidance: 'Baixa prioridade, ciclo de contagem longo.',
  },
  CY: {
    combo: 'CY',
    title: 'Baixa prioridade, variabilidade moderada',
    description: 'Baixo valor movimentado com variabilidade média de demanda.',
    priority: 'baixa',
    countingGuidance: 'Ciclo de contagem longo, sem necessidade de monitoramento especial.',
  },
  CZ: {
    combo: 'CZ',
    title: 'Baixa prioridade financeira, comportamento imprevisível',
    description: 'Baixo valor movimentado, porém demanda altamente instável.',
    priority: 'media',
    countingGuidance: 'Baixa prioridade financeira, porém comportamento imprevisível — vale revisão ocasional para evitar ruptura silenciosa.',
  },
};
