// Curva ABC — política comercial de UMA análise. Antes esses limiares eram constantes fixas
// dentro de abcCurveRecommendations.ts: a recomendação existia, mas o critério que a produziu
// não ficava registrado em lugar nenhum. Agora a política viaja explícita até a regra e é
// gravada junto da análise (migration 109), então uma análise publicada continua explicável
// mesmo depois de o padrão do produto mudar.
//
// Módulo puro: nenhum I/O, nenhuma leitura de constante escondida por quem consome.

import { validateThresholds } from './abcCurveEngine';

export interface AbcCommercialPolicy {
  /** Limite de % acumulado da classe A (exclusivo: acumulado ANTES do item < thresholdA). */
  thresholdA: number;
  /** Limite de % acumulado da classe B. */
  thresholdB: number;
  /** Abaixo disso, a cobertura é considerada baixa (dias). */
  lowCoverageDays: number;
  /** A partir disso, a cobertura é considerada saudável (dias). */
  healthyCoverageDays: number;
  /** Acima disso, há excesso de cobertura (dias). */
  excessCoverageDays: number;
  /** Abaixo disso, a margem é considerada baixa (percentual, 0–100). */
  lowMarginPct: number;
  /** A partir disso, a margem é considerada forte (percentual, 0–100). */
  strongMarginPct: number;
}

/** Exatamente os valores que estavam fixos no código antes da Fase 2 — e os DEFAULTs da
 *  migration 109. Análise antiga, sem política gravada, resolve para isto. */
export const DEFAULT_ABC_POLICY: AbcCommercialPolicy = {
  thresholdA: 80,
  thresholdB: 95,
  lowCoverageDays: 7,
  healthyCoverageDays: 30,
  excessCoverageDays: 90,
  lowMarginPct: 15,
  strongMarginPct: 40,
};

const finite = (value: number): boolean => Number.isFinite(value);

/** Primeira inconsistência encontrada, em texto de tela; null quando a política é válida.
 *  Bloqueia publicação: uma política incoerente geraria recomendação sem significado.
 *
 *  A parte de A/B delega para validateThresholds (Fase 1) para não existirem duas versões da
 *  mesma regra — as mensagens de limite continuam as mesmas de antes. */
export function validateAbcPolicy(policy: AbcCommercialPolicy): string | null {
  const values = [
    policy.thresholdA, policy.thresholdB, policy.lowCoverageDays, policy.healthyCoverageDays,
    policy.excessCoverageDays, policy.lowMarginPct, policy.strongMarginPct,
  ];
  if (!values.every(finite)) return 'Preencha todos os parâmetros da política comercial com números.';

  const thresholdError = validateThresholds(policy.thresholdA, policy.thresholdB);
  if (thresholdError) return thresholdError;

  if (policy.lowCoverageDays < 0) return 'A baixa cobertura não pode ser negativa.';
  if (policy.lowCoverageDays >= policy.healthyCoverageDays) return 'A baixa cobertura deve ser menor que a cobertura saudável.';
  if (policy.healthyCoverageDays >= policy.excessCoverageDays) return 'A cobertura saudável deve ser menor que o excesso de cobertura.';

  if (policy.lowMarginPct < 0) return 'A margem baixa não pode ser negativa.';
  if (policy.lowMarginPct >= policy.strongMarginPct) return 'A margem baixa deve ser menor que a margem forte.';
  if (policy.strongMarginPct > 100) return 'A margem forte deve ser no máximo 100%.';

  return null;
}

export interface PolicyRow {
  label: string;
  value: string;
}

const days = (value: number): string => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d`;
const pct = (value: number): string => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Leitura da política publicada, para exibir sem virar formulário. Os operadores (<, ≥, >)
 *  são os mesmos que as regras aplicam, para o texto não sugerir um corte diferente do real. */
export function policySummaryRows(policy: AbcCommercialPolicy): PolicyRow[] {
  return [
    { label: 'ABC', value: `${pct(policy.thresholdA)} / ${pct(policy.thresholdB)}` },
    { label: 'Baixa cobertura', value: `< ${days(policy.lowCoverageDays)}` },
    { label: 'Cobertura saudável', value: `≥ ${days(policy.healthyCoverageDays)}` },
    { label: 'Excesso', value: `> ${days(policy.excessCoverageDays)}` },
    { label: 'Margem baixa', value: `< ${pct(policy.lowMarginPct)}` },
    { label: 'Margem forte', value: `≥ ${pct(policy.strongMarginPct)}` },
  ];
}
