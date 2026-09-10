// Auditoria Estatística — amostragem por atributos nos moldes da ISO 2859-1 / ANSI/ASQ Z1.4
// (a norma "MIL-STD-105E" civil). Cálculo puro, sem I/O — mesmo espírito de riskAlgorithm.ts.
//
// O que é fiel à norma (Tabela I e progressão de tamanhos de amostra — dados de referência
// estáveis e amplamente publicados):
// - getSampleSizeCodeLetter: faixa de tamanho de lote + nível de inspeção → letra-código.
// - SAMPLE_SIZE_BY_CODE_LETTER: letra-código → tamanho de amostra "n".
//
// O que é uma APROXIMAÇÃO (documentada, não a tabela oficial completa): o número de
// aceitação (Ac) e rejeição (Re) da Tabela II-A oficial usa substituições por seta entre
// células que dependem de qual célula vizinha é usada — reproduzir isso célula-a-célula sem
// a tabela impressa ao lado seria arriscar números errados numa ferramenta de compliance.
// Em vez disso, `computeAcceptanceNumber` deriva Ac pela aproximação de Poisson padrão da
// teoria de amostragem por atributos (maior c com P(X≤c | λ=n·AQL/100) ≈ 95%), que converge
// para os mesmos valores da norma na grande maioria das combinações práticas de n/AQL usadas
// em auditoria de estoque. Estrutura pronta para trocar por uma tabela oficial completa
// depois, sem mudar quem chama esta função.

export type InspectionLevel = 'I' | 'II' | 'III';

export const INSPECTION_LEVEL_LABEL: Record<InspectionLevel, string> = {
  I: 'Nível I (inspeção reduzida)',
  II: 'Nível II (inspeção normal)',
  III: 'Nível III (inspeção rigorosa)',
};

// Tabela I (ANSI Z1.4) — faixas de tamanho de lote x nível de inspeção → letra-código.
const LOT_SIZE_RANGES: { max: number; codeByLevel: Record<InspectionLevel, string> }[] = [
  { max: 8, codeByLevel: { I: 'A', II: 'A', III: 'B' } },
  { max: 15, codeByLevel: { I: 'A', II: 'B', III: 'C' } },
  { max: 25, codeByLevel: { I: 'B', II: 'C', III: 'D' } },
  { max: 50, codeByLevel: { I: 'C', II: 'D', III: 'E' } },
  { max: 90, codeByLevel: { I: 'C', II: 'E', III: 'F' } },
  { max: 150, codeByLevel: { I: 'D', II: 'F', III: 'G' } },
  { max: 280, codeByLevel: { I: 'E', II: 'G', III: 'H' } },
  { max: 500, codeByLevel: { I: 'F', II: 'H', III: 'J' } },
  { max: 1200, codeByLevel: { I: 'G', II: 'J', III: 'K' } },
  { max: 3200, codeByLevel: { I: 'H', II: 'K', III: 'L' } },
  { max: 10000, codeByLevel: { I: 'J', II: 'L', III: 'M' } },
  { max: 35000, codeByLevel: { I: 'K', II: 'M', III: 'N' } },
  { max: 150000, codeByLevel: { I: 'L', II: 'N', III: 'P' } },
  { max: 500000, codeByLevel: { I: 'M', II: 'P', III: 'Q' } },
  { max: Infinity, codeByLevel: { I: 'N', II: 'Q', III: 'R' } },
];

const SAMPLE_SIZE_BY_CODE_LETTER: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50,
  J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

export const COMMON_AQL_OPTIONS = [1.0, 1.5, 2.5, 4.0, 6.5] as const;

export function getSampleSizeCodeLetter(populationSize: number, level: InspectionLevel): string {
  const range = LOT_SIZE_RANGES.find(r => populationSize <= r.max) ?? LOT_SIZE_RANGES[LOT_SIZE_RANGES.length - 1];
  return range.codeByLevel[level];
}

export function getSampleSize(codeLetter: string): number {
  return SAMPLE_SIZE_BY_CODE_LETTER[codeLetter] ?? 0;
}

function poissonCdf(k: number, lambda: number): number {
  let sum = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) {
    if (i > 0) term *= lambda / i;
    sum += term;
  }
  return sum;
}

/** Maior Ac (0..n) cuja probabilidade de aceitação num lote exatamente no AQL fique >= 95%
 *  (risco do produtor convencional da norma). Re = Ac + 1, convenção da amostragem simples
 *  normal para a grande maioria das células da Tabela II-A. */
export function computeAcceptanceNumber(sampleSize: number, aqlPercent: number): { ac: number; re: number } {
  const lambda = sampleSize * (aqlPercent / 100);
  let ac = 0;
  for (let c = 0; c <= sampleSize; c++) {
    if (poissonCdf(c, lambda) >= 0.95) { ac = c; break; }
    ac = c;
  }
  return { ac, re: ac + 1 };
}

export interface SamplingPlan {
  populationSize: number;
  inspectionLevel: InspectionLevel;
  aqlPercent: number;
  codeLetter: string;
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
}

export function computeSamplingPlan(populationSize: number, inspectionLevel: InspectionLevel, aqlPercent: number): SamplingPlan {
  const codeLetter = getSampleSizeCodeLetter(populationSize, inspectionLevel);
  const sampleSize = Math.min(getSampleSize(codeLetter), populationSize);
  const { ac, re } = computeAcceptanceNumber(sampleSize, aqlPercent);
  return { populationSize, inspectionLevel, aqlPercent, codeLetter, sampleSize, acceptanceNumber: ac, rejectionNumber: re };
}

/** Amostragem sistemática (item a cada k, começando no meio do primeiro intervalo) — usada
 *  em vez de aleatória pura para o resultado ser reprodutível/auditável sem precisar guardar
 *  a amostra sorteada; é uma variante aceita quando a lista já está em ordem operacional
 *  neutra (ordem de importação), não uma ordenação que favoreça um resultado. */
export function pickSystematicSampleIndexes(populationSize: number, sampleSize: number): number[] {
  if (sampleSize <= 0 || populationSize <= 0) return [];
  if (sampleSize >= populationSize) return Array.from({ length: populationSize }, (_, i) => i);
  const step = populationSize / sampleSize;
  const start = step / 2;
  const indexes: number[] = [];
  for (let i = 0; i < sampleSize; i++) {
    indexes.push(Math.min(populationSize - 1, Math.floor(start + i * step)));
  }
  return Array.from(new Set(indexes));
}

export interface AuditResult {
  plan: SamplingPlan;
  defectsFound: number;
  accepted: boolean;
}

export function evaluateSample(plan: SamplingPlan, defectsFound: number): AuditResult {
  return { plan, defectsFound, accepted: defectsFound <= plan.acceptanceNumber };
}
