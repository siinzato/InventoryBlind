// Mapeamento de colunas do lote da Calculadora de Paletização — mesmo padrão
// de src/lib/barcode/barcodeBatchUtils.ts (campos próprios, cópia local do
// fuzzy-match por Levenshtein; precedente documentado lá: cada ferramenta
// mantém seu próprio detector em vez de compartilhar um genérico).

export const PALLET_BATCH_FIELDS = [
  { key: 'sku', label: 'SKU', required: false, aliases: ['sku', 'codigo', 'código', 'codigointerno', 'ref', 'referencia'] },
  { key: 'description', label: 'Descrição', required: false, aliases: ['descricao', 'descrição', 'produto', 'nome'] },
  { key: 'length', label: 'Comprimento', required: true, aliases: ['comprimento', 'length', 'compr'] },
  { key: 'width', label: 'Largura', required: true, aliases: ['largura', 'width', 'larg'] },
  { key: 'height', label: 'Altura', required: true, aliases: ['altura', 'height', 'alt'] },
  { key: 'lengthUnit', label: 'Unidade dimensional', required: false, aliases: ['unidade', 'unidadedimensional', 'unidademedida', 'unit'] },
  { key: 'weight', label: 'Peso', required: true, aliases: ['peso', 'weight'] },
  { key: 'weightUnit', label: 'Unidade de peso', required: false, aliases: ['unidadepeso', 'unidadedopeso', 'weightunit'] },
  { key: 'quantity', label: 'Quantidade', required: true, aliases: ['quantidade', 'qty', 'quantity', 'qtd'] },
  { key: 'palletType', label: 'Tipo de palete', required: false, aliases: ['tipodepalete', 'palete', 'pallet', 'tipopalete'] },
  { key: 'maxHeight', label: 'Altura máxima', required: false, aliases: ['alturamaxima', 'alturamáxima', 'maxheight'] },
  { key: 'maxWeight', label: 'Peso máximo', required: false, aliases: ['pesomaximo', 'pesomáximo', 'maxweight'] },
  { key: 'rotation', label: 'Rotação permitida', required: false, aliases: ['rotacao', 'rotação', 'rotation', 'giro'] },
] as const;

export type PalletBatchFieldKey = typeof PALLET_BATCH_FIELDS[number]['key'];
export type PalletColumnMapping = Record<PalletBatchFieldKey, string | null>;

export interface DetectedPalletColumn {
  name: string;
  detectedField: PalletBatchFieldKey | null;
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

export function detectPalletColumnMappings(headers: string[]): DetectedPalletColumn[] {
  return headers.map(header => {
    const norm = normalize(header);
    let best: { field: PalletBatchFieldKey; confidence: DetectedPalletColumn['confidence'] } | null = null;

    for (const field of PALLET_BATCH_FIELDS) {
      for (const alias of field.aliases) {
        const normAlias = normalize(alias);
        if (norm === normAlias) { best = { field: field.key, confidence: 'high' }; break; }
        if (!best && (norm.includes(normAlias) || normAlias.includes(norm))) {
          best = { field: field.key, confidence: 'medium' };
        }
        if (!best && levenshteinDistance(norm, normAlias) <= 2 && norm.length > 2) {
          best = { field: field.key, confidence: 'low' };
        }
      }
      if (best?.confidence === 'high') break;
    }

    return { name: header, detectedField: best?.field ?? null, confidence: best?.confidence ?? 'none' };
  });
}

export function suggestPalletMapping(detected: DetectedPalletColumn[]): PalletColumnMapping {
  const mapping = Object.fromEntries(PALLET_BATCH_FIELDS.map(f => [f.key, null])) as PalletColumnMapping;
  detected.forEach(d => {
    if (d.detectedField && d.confidence !== 'none' && !mapping[d.detectedField]) {
      mapping[d.detectedField] = d.name;
    }
  });
  return mapping;
}

export function applyPalletColumnMapping(rawRows: Array<Record<string, unknown>>, mapping: PalletColumnMapping): Array<Record<PalletBatchFieldKey, unknown>> {
  return rawRows.map(row => {
    const mapped = {} as Record<PalletBatchFieldKey, unknown>;
    for (const field of PALLET_BATCH_FIELDS) {
      const sourceCol = mapping[field.key];
      mapped[field.key] = sourceCol ? row[sourceCol] : undefined;
    }
    return mapped;
  });
}

export function requiredFieldsMapped(mapping: PalletColumnMapping): boolean {
  return PALLET_BATCH_FIELDS.filter(f => f.required).every(f => mapping[f.key] != null);
}
