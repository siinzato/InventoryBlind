// Detecção genérica de colunas por nome (exata → substring → distância de
// Levenshtein). O mesmo algoritmo já existe, hardcoded para seus próprios
// campos, em productImportUtils.ts (produtos) e countManagementUtils.ts
// (contagem) — nenhum dos dois foi tocado (zero risco de regressão). Esta é a
// versão genérica, parametrizada por uma lista de campos, para o Comparador de
// Planilhas (e qualquer novo consumidor futuro) não reimplementar de novo.

export interface FuzzyFieldDef<K extends string> {
  key: K;
  aliases: string[];
}

export interface DetectedFuzzyColumn<K extends string> {
  name: string;
  detectedField: K | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

/** Para cada header, encontra o campo cujo alias mais se parece — exato > substring > Levenshtein ≤2. */
export function detectFuzzyColumnMappings<K extends string>(
  headers: string[],
  fields: FuzzyFieldDef<K>[]
): DetectedFuzzyColumn<K>[] {
  return headers.map(header => {
    const norm = normalize(header);
    let best: { field: K; confidence: DetectedFuzzyColumn<K>['confidence'] } | null = null;

    for (const field of fields) {
      for (const alias of field.aliases) {
        const normAlias = normalize(alias);
        if (norm === normAlias) { best = { field: field.key, confidence: 'high' }; break; }
        if (!best && (norm.includes(normAlias) || normAlias.includes(norm)) && normAlias.length > 0) {
          best = { field: field.key, confidence: 'medium' };
        }
        if (!best && norm.length > 2 && levenshteinDistance(norm, normAlias) <= 2) {
          best = { field: field.key, confidence: 'low' };
        }
      }
      if (best?.confidence === 'high') break;
    }

    return { name: header, detectedField: best?.field ?? null, confidence: best?.confidence ?? 'none' };
  });
}

/** Sugere um mapeamento inicial a partir da detecção — primeira coluna compatível ganha cada campo. */
export function suggestFuzzyMapping<K extends string>(
  detected: DetectedFuzzyColumn<K>[],
  fieldKeys: K[]
): Record<K, string | null> {
  const mapping = Object.fromEntries(fieldKeys.map(k => [k, null])) as Record<K, string | null>;
  detected.forEach(d => {
    if (d.detectedField && d.confidence !== 'none' && !mapping[d.detectedField]) {
      mapping[d.detectedField] = d.name;
    }
  });
  return mapping;
}
