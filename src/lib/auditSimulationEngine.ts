// Simulação de Inventário — cálculo puro (sem I/O), no mesmo espírito de slottingEngine.ts/
// riskAlgorithm.ts. Hoje a estimativa de produtividade vem de uma média histórica simples
// (ver estimateHistoricalProductivity); quando houver um modelo de IA/histórico mais rico,
// só o cálculo de `avgSkusPerHourPerOperator` muda — a assinatura de simulateCount não precisa
// mudar, então o restante da tela (SimulationInput/Estimate) já está pronto para a integração.

export interface OperatorHistoricalSample {
  skusContados: number;
  tempoMedioSegundos: number | null;
}

export interface HistoricalProductivityResult {
  value: number;
  /** Total de horas somadas entre as amostras — base para o Confiança da previsão
   *  (mais horas observadas = estimativa mais confiável), não usada para o próprio cálculo. */
  sampleHours: number;
}

/** SKUs/hora médio observado no histórico da empresa (ponderado por volume contado de cada
 *  operador, não uma média simples entre operadores, para não deixar um operador com poucas
 *  contagens distorcer o número). Retorna null se não houver histórico suficiente. */
export function estimateHistoricalProductivityDetailed(samples: OperatorHistoricalSample[]): HistoricalProductivityResult | null {
  let totalSkus = 0;
  let totalHours = 0;
  for (const s of samples) {
    if (!s.tempoMedioSegundos || s.tempoMedioSegundos <= 0 || s.skusContados <= 0) continue;
    totalSkus += s.skusContados;
    totalHours += s.tempoMedioSegundos / 3600;
  }
  if (totalHours <= 0) return null;
  return { value: totalSkus / totalHours, sampleHours: totalHours };
}

export function estimateHistoricalProductivity(samples: OperatorHistoricalSample[]): number | null {
  return estimateHistoricalProductivityDetailed(samples)?.value ?? null;
}

export interface SimulationInput {
  totalSkus: number;
  numOperators: number;
  avgSkusPerHourPerOperator: number;
  costPerHourPerOperator: number;
  hoursPerWorkday: number;
  startDate: string;
}

export interface SimulationEstimate {
  totalWorkHours: number;
  wallClockHours: number;
  workdaysNeeded: number;
  estimatedCost: number;
  expectedCompletionDate: string;
  productivityPerOperator: number;
}

/** Núcleo da simulação: quantas horas-pessoa o total de SKUs exige na produtividade
 *  informada, dividido pelo número de operadores para o tempo de parede, e projetado em
 *  dias úteis a partir de `startDate` (jornada de `hoursPerWorkday` por dia). */
export function simulateCount(input: SimulationInput): SimulationEstimate {
  const { totalSkus, numOperators, avgSkusPerHourPerOperator, costPerHourPerOperator, hoursPerWorkday, startDate } = input;

  const totalWorkHours = avgSkusPerHourPerOperator > 0 ? totalSkus / avgSkusPerHourPerOperator : 0;
  const wallClockHours = numOperators > 0 ? totalWorkHours / numOperators : totalWorkHours;
  const workdaysNeeded = hoursPerWorkday > 0 ? wallClockHours / hoursPerWorkday : wallClockHours;
  const estimatedCost = totalWorkHours * costPerHourPerOperator;

  const completion = new Date(startDate);
  const daysToAdd = Math.ceil(workdaysNeeded);
  let addedDays = 0;
  while (addedDays < daysToAdd) {
    completion.setDate(completion.getDate() + 1);
    const dow = completion.getDay();
    if (dow !== 0 && dow !== 6) addedDays += 1;
  }

  return {
    totalWorkHours,
    wallClockHours,
    workdaysNeeded,
    estimatedCost,
    expectedCompletionDate: completion.toISOString(),
    productivityPerOperator: avgSkusPerHourPerOperator,
  };
}

export type CapacityClassification = 'adequada' | 'atencao' | 'sobrecarga';

export interface CapacityAssessment {
  /** % das horas disponíveis (operadores × jornada) que a contagem consome. Pode passar de 100. */
  utilizationPercent: number;
  /** Folga — sempre 0 quando em sobrecarga, nunca negativa na tela. */
  slackPercent: number;
  availableHours: number;
  usedHours: number;
  classification: CapacityClassification;
}

export const CAPACITY_LABEL: Record<CapacityClassification, string> = {
  adequada: 'Capacidade adequada',
  atencao: 'Atenção',
  sobrecarga: 'Sobrecarga',
};

/** Carga = horas-pessoa necessárias / horas-pessoa disponíveis numa única jornada (operadores ×
 *  horas por jornada). Acima de 100% significa que a equipe não fecha a contagem dentro de um
 *  dia útil com essa configuração. */
export function assessCapacity(totalWorkHours: number, numOperators: number, hoursPerWorkday: number): CapacityAssessment {
  const availableHours = numOperators * hoursPerWorkday;
  const utilizationPercent = availableHours > 0 ? (totalWorkHours / availableHours) * 100 : 0;
  const classification: CapacityClassification =
    utilizationPercent > 100 ? 'sobrecarga' : utilizationPercent > 80 ? 'atencao' : 'adequada';

  return {
    utilizationPercent,
    slackPercent: Math.max(0, 100 - utilizationPercent),
    availableHours,
    usedHours: totalWorkHours,
    classification,
  };
}

export type RiskLevel = 'Muito baixo' | 'Baixo' | 'Médio' | 'Alto';

/** Risco operacional do cenário: cresce com a carga (menos margem para imprevistos) e é
 *  penalizado quando há um único operador (sem redundância — falta desse operador para o
 *  turno inteiro). */
function scenarioRisk(utilizationPercent: number, operators: number): RiskLevel {
  const order: RiskLevel[] = ['Muito baixo', 'Baixo', 'Médio', 'Alto'];
  let idx = utilizationPercent > 100 ? 3 : utilizationPercent > 85 ? 2 : utilizationPercent > 60 ? 1 : 0;
  if (operators === 1) idx = Math.min(order.length - 1, idx + 1);
  return order[idx];
}

/** Eficiência do cenário: penaliza tanto sobrecarga (pouca margem) quanto ociosidade (equipe
 *  grande demais para o volume, carga muito abaixo do ideal) e desestimula operadores extras
 *  além do 2º sem ganho de carga proporcional (custo de coordenação). Faixa 0–100, determinística. */
function scenarioEfficiency(utilizationPercent: number, operators: number): number {
  const idealUtilization = 75;
  let score = 100 - Math.abs(utilizationPercent - idealUtilization);
  if (utilizationPercent > 100) score -= (utilizationPercent - 100) * 0.5;
  score -= Math.max(0, operators - 2) * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface ScenarioRow {
  key: 'economico' | 'recomendado' | 'acelerado';
  label: string;
  operators: number;
  wallClockHours: number;
  estimatedCost: number;
  risk: RiskLevel;
  efficiencyPercent: number;
}

/** Ponto de "Tempo estimado x Operadores" para o gráfico — mesmos campos usados pelo
 *  ScenarioRow, sem o rótulo/classificação (não é um cenário nomeado, é um ponto da curva). */
export interface OperatorsCurvePoint {
  operators: number;
  wallClockHours: number;
}

function candidateOperatorCounts(currentOperators: number): number[] {
  const max = Math.min(10, Math.max(5, currentOperators + 2));
  return Array.from({ length: max }, (_, i) => i + 1);
}

/** Melhor nº de operadores pela eficiência determinística acima — em empate, fica com o menor
 *  número (regra do enunciado: não recomendar gente a mais por ganho marginal irrelevante). */
function pickRecommendedOperators(input: SimulationInput, candidates: number[]): number {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const n of candidates) {
    const estimate = simulateCount({ ...input, numOperators: n });
    const capacity = assessCapacity(estimate.totalWorkHours, n, input.hoursPerWorkday);
    const score = scenarioEfficiency(capacity.utilizationPercent, n);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

function buildScenarioRow(key: ScenarioRow['key'], label: string, operators: number, input: SimulationInput): ScenarioRow {
  const estimate = simulateCount({ ...input, numOperators: operators });
  const capacity = assessCapacity(estimate.totalWorkHours, operators, input.hoursPerWorkday);
  return {
    key,
    label,
    operators,
    wallClockHours: estimate.wallClockHours,
    estimatedCost: estimate.estimatedCost,
    risk: scenarioRisk(capacity.utilizationPercent, operators),
    efficiencyPercent: scenarioEfficiency(capacity.utilizationPercent, operators),
  };
}

/** Três cenários comparáveis lado a lado. O "recomendado" busca o nº de operadores de maior
 *  eficiência (ver scenarioEfficiency); econômico/acelerado são um operador a menos/a mais —
 *  todos recalculados a partir da configuração atual, nada fixo. */
export function buildScenarios(input: SimulationInput): ScenarioRow[] {
  const candidates = candidateOperatorCounts(input.numOperators);
  const recommended = pickRecommendedOperators(input, candidates);
  const economic = Math.max(1, recommended - 1);
  const accelerated = Math.min(candidates[candidates.length - 1], recommended + 1);

  return [
    buildScenarioRow('economico', 'Econômico', economic, input),
    buildScenarioRow('recomendado', 'Recomendado', recommended, input),
    buildScenarioRow('acelerado', 'Acelerado', accelerated, input),
  ];
}

export function buildOperatorsCurve(input: SimulationInput): OperatorsCurvePoint[] {
  return candidateOperatorCounts(input.numOperators).map(operators => ({
    operators,
    wallClockHours: simulateCount({ ...input, numOperators: operators }).wallClockHours,
  }));
}

/** Diagnóstico textual determinístico (sem IA) a partir da carga calculada — três faixas fixas,
 *  mesma classificação usada no card de Capacidade do Cenário. */
export function buildScenarioDiagnostic(capacity: CapacityAssessment, recommendedOperators: number): string {
  const messages: Record<CapacityClassification, string> = {
    adequada: 'A equipe possui capacidade suficiente para concluir este inventário dentro da janela planejada, com baixa probabilidade de atraso.',
    atencao: 'A configuração atual está próxima do limite da jornada — pequenos imprevistos podem levar a contagem para o dia seguinte.',
    sobrecarga: 'A configuração atual não é suficiente para concluir a contagem dentro de uma jornada — considere aumentar o número de operadores ou dividir em mais dias.',
  };
  return `${messages[capacity.classification]} Cenário recomendado pelo InventoryBlind: ${recommendedOperators} operador${recommendedOperators === 1 ? '' : 'es'}.`;
}

export type ForecastConfidenceLevel = 'Alta' | 'Média' | 'Baixa';

export interface ForecastConfidence {
  level: ForecastConfidenceLevel;
  percent: number;
}

/** Confiança da previsão a partir do VOLUME de horas históricas por trás da produtividade usada
 *  (mais horas observadas = estimativa mais estável) — heurística determinística local, não a
 *  arquitetura de Confidence Score do CBC (que mede estabilidade de vendas por SKU, domínio
 *  diferente). Retorna null sem histórico suficiente — a tela deve omitir o card nesse caso. */
export function assessForecastConfidence(sampleHours: number | null): ForecastConfidence | null {
  if (sampleHours === null || sampleHours <= 0) return null;
  if (sampleHours >= 40) return { level: 'Alta', percent: 92 };
  if (sampleHours >= 10) return { level: 'Média', percent: 70 };
  return { level: 'Baixa', percent: 45 };
}
