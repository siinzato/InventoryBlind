// Simulação de Inventário — cálculo puro (sem I/O), no mesmo espírito de slottingEngine.ts/
// riskAlgorithm.ts. Hoje a estimativa de produtividade vem de uma média histórica simples
// (ver estimateHistoricalProductivity); quando houver um modelo de IA/histórico mais rico,
// só o cálculo de `avgSkusPerHourPerOperator` muda — a assinatura de simulateCount não precisa
// mudar, então o restante da tela (SimulationInput/Estimate) já está pronto para a integração.

export interface OperatorHistoricalSample {
  skusContados: number;
  tempoMedioSegundos: number | null;
}

/** SKUs/hora médio observado no histórico da empresa (ponderado por volume contado de cada
 *  operador, não uma média simples entre operadores, para não deixar um operador com poucas
 *  contagens distorcer o número). Retorna null se não houver histórico suficiente. */
export function estimateHistoricalProductivity(samples: OperatorHistoricalSample[]): number | null {
  let totalSkus = 0;
  let totalHours = 0;
  for (const s of samples) {
    if (!s.tempoMedioSegundos || s.tempoMedioSegundos <= 0 || s.skusContados <= 0) continue;
    totalSkus += s.skusContados;
    totalHours += s.tempoMedioSegundos / 3600;
  }
  if (totalHours <= 0) return null;
  return totalSkus / totalHours;
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
