// Count Management Utilities — supports the "Centro de Gestão da Contagem" screen.
// Mirrors the patterns in productImportUtils.ts without modifying that file.

import { parseCSV } from './productImportUtils';

export interface CountRow {
  [key: string]: string | number | undefined;
}

export const COUNT_FIELDS = [
  { key: 'produto', label: 'Produto', required: false, aliases: ['produto', 'nome', 'name', 'descricao', 'description'] },
  { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'code', 'item', 'ref', 'referencia'] },
  { key: 'ean', label: 'EAN', required: false, aliases: ['ean', 'barcode', 'codigobarras', 'barras', 'gtin', 'upc'] },
  { key: 'local', label: 'Local', required: false, aliases: ['local', 'location', 'localizacao', 'endereco', 'posicao', 'rua', 'vao'] },
  { key: 'saldoContado', label: 'Saldo Contado', required: true, aliases: ['saldocontado', 'saldo contado', 'contado', 'quantidadecontada', 'qtdcontada', 'saldo', 'quantity', 'qty'] },
];

export interface CountColumnMapping {
  produto: string | null;
  sku: string | null;
  ean: string | null;
  local: string | null;
  saldoContado: string | null;
}

export interface DetectedCountColumn {
  name: string;
  detectedField: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

// Simple Levenshtein distance for fuzzy matching (mirrors productImportUtils.ts)
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

export const detectCountColumnMappings = (headers: string[]): DetectedCountColumn[] => {
  const detected: DetectedCountColumn[] = [];

  for (const header of headers) {
    const headerLower = header.toLowerCase().trim();
    let detectedField: string | null = null;
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';

    for (const field of COUNT_FIELDS) {
      if (field.aliases.some(alias => alias === headerLower)) {
        detectedField = field.key;
        confidence = 'high';
        break;
      }
      if (field.aliases.some(alias => headerLower.includes(alias) || alias.includes(headerLower))) {
        detectedField = field.key;
        confidence = 'medium';
      }
      if (!detectedField) {
        for (const alias of field.aliases) {
          if (levenshteinDistance(headerLower, alias) <= 2) {
            detectedField = field.key;
            confidence = 'low';
          }
        }
      }
    }

    detected.push({ name: header, detectedField, confidence });
  }

  return detected;
};

export const suggestCountMapping = (detected: DetectedCountColumn[]): CountColumnMapping => {
  const mapping: CountColumnMapping = { produto: null, sku: null, ean: null, local: null, saldoContado: null };

  for (const col of detected) {
    if (col.detectedField && col.confidence !== 'none') {
      (mapping as unknown as Record<string, string | null>)[col.detectedField] = col.name;
    }
  }

  return mapping;
};

export const applyCountColumnMapping = (rawData: CountRow[], mapping: CountColumnMapping): CountRow[] => {
  return rawData.map(row => {
    const mapped: CountRow = {};
    const fieldMapping: Record<string, string | null> = {
      produto: mapping.produto,
      sku: mapping.sku,
      ean: mapping.ean,
      local: mapping.local,
      saldoContado: mapping.saldoContado,
    };

    for (const [targetField, sourceCol] of Object.entries(fieldMapping)) {
      if (sourceCol && row[sourceCol] !== undefined) {
        mapped[targetField] = row[sourceCol];
      }
    }

    return mapped;
  });
};

// Parses .csv (via the existing parseCSV) or .xlsx/.xls (mirrors ProductImportPage.tsx's inline branch, kept local so that file is never touched)
export const parseCountFile = async (file: File): Promise<{ headers: string[]; rows: CountRow[] }> => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    const content = await file.text();
    return parseCSV(content);
  }

  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (jsonData.length === 0) return { headers: [], rows: [] };

  const headers = (jsonData[0] as string[]).map(String);
  const rows: CountRow[] = (jsonData.slice(1) as string[][]).map(row => {
    const obj: CountRow = {};
    headers.forEach((header, idx) => { obj[header] = row[idx]; });
    return obj;
  });

  return { headers, rows };
};

export type CountItemStatus = 'correct' | 'divergent' | 'missing' | 'surplus';

export interface SystemProductLookup {
  id: string;
  sku: string;
  name: string;
  ean: string | null;
  location: string | null;
  price: number | null;
  stock_quantity: number;
}

export interface ClassifiedCountRow {
  productId: string | null;
  produto: string;
  sku: string;
  ean: string | null;
  local: string | null;
  saldoSistema: number | null;
  saldoContado: number;
  diferenca: number | null;
  precoUnitario: number | null;
  status: CountItemStatus;
  responsavel: string | null;
}

const parseCount = (value: string | number | undefined): number => {
  if (value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return isNaN(num) ? 0 : num;
};

// Classifies one imported row against the system's product record (matched by SKU upstream)
export const classifyCountRow = (
  row: CountRow,
  systemProduct: SystemProductLookup | undefined,
  responsavel?: string
): ClassifiedCountRow => {
  const sku = String(row.sku ?? '').trim();
  const produto = String(row.produto ?? systemProduct?.name ?? '').trim();
  const ean = row.ean ? String(row.ean).trim() : systemProduct?.ean ?? null;
  const local = row.local ? String(row.local).trim() : systemProduct?.location ?? null;
  const saldoContado = parseCount(row.saldoContado);

  if (!systemProduct) {
    return {
      productId: null, produto, sku, ean, local,
      saldoSistema: null, saldoContado, diferenca: null, precoUnitario: null,
      status: 'surplus', responsavel: responsavel ?? null,
    };
  }

  const saldoSistema = systemProduct.stock_quantity;
  const diferenca = saldoContado - saldoSistema;

  return {
    productId: systemProduct.id, produto, sku, ean, local,
    saldoSistema, saldoContado, diferenca, precoUnitario: systemProduct.price,
    status: diferenca === 0 ? 'correct' : 'divergent',
    responsavel: responsavel ?? null,
  };
};

// Products that belong to a counted location but were never present in the imported file
export const findMissingProducts = (
  classifiedRows: ClassifiedCountRow[],
  systemProducts: SystemProductLookup[]
): ClassifiedCountRow[] => {
  const countedSkus = new Set(classifiedRows.map(r => r.sku.toUpperCase()));
  const countedLocations = new Set(classifiedRows.map(r => r.local).filter((l): l is string => !!l));
  if (countedLocations.size === 0) return [];

  return systemProducts
    .filter(p => p.location && countedLocations.has(p.location) && !countedSkus.has(p.sku.toUpperCase()))
    .map(p => ({
      productId: p.id, produto: p.name, sku: p.sku, ean: p.ean, local: p.location,
      saldoSistema: p.stock_quantity, saldoContado: 0, diferenca: -p.stock_quantity, precoUnitario: p.price,
      status: 'missing' as CountItemStatus, responsavel: null,
    }));
};

export interface CountMetricsInput {
  skusContados: number;
  divergenciasEncontradas: number;
  divergenciasReais: number;
}

export interface CountMetrics {
  accuracyInitial: number | null;
  accuracyFinal: number | null;
  divergenciasEliminadas: number;
  percentReduction: number | null;
}

// accuracyInitial/Final compare counted SKUs against divergences found/confirmed real;
// divergenciasEliminadas/percentReduction compare the recount outcome to the original find.
export const calculateCountMetrics = ({ skusContados, divergenciasEncontradas, divergenciasReais }: CountMetricsInput): CountMetrics => {
  const accuracyInitial = skusContados > 0 ? ((skusContados - divergenciasEncontradas) / skusContados) * 100 : null;
  const accuracyFinal = skusContados > 0 ? ((skusContados - divergenciasReais) / skusContados) * 100 : null;
  const divergenciasEliminadas = Math.max(0, divergenciasEncontradas - divergenciasReais);
  const percentReduction = divergenciasEncontradas > 0 ? (divergenciasEliminadas / divergenciasEncontradas) * 100 : null;

  return { accuracyInitial, accuracyFinal, divergenciasEliminadas, percentReduction };
};

export const shouldRecommendThirdCount = (divergenciasReais: number): boolean => divergenciasReais > 10;

// Auto-generated "Inteligência" analysis text, same threshold-based-sentence style as App.tsx's generateInsights()
export const generateCountInsight = (metrics: CountMetrics, divergenciasReais: number, brandName?: string): string => {
  const parts: string[] = [];
  const linha = brandName ? ` na linha ${brandName}` : '';

  if (metrics.percentReduction !== null) {
    if (metrics.percentReduction >= 70) {
      parts.push(`✅ Excelente resultado${linha}: redução de ${metrics.percentReduction.toFixed(0)}% das divergências após a recontagem.`);
    } else if (metrics.percentReduction >= 30) {
      parts.push(`📊 Redução moderada${linha}: ${metrics.percentReduction.toFixed(0)}% das divergências eliminadas após a recontagem.`);
    } else {
      parts.push(`⚠️ Baixa redução de divergências${linha} (${metrics.percentReduction.toFixed(0)}%) — a maioria das divergências encontradas se confirmou real.`);
    }
  }

  if (shouldRecommendThirdCount(divergenciasReais)) {
    parts.push(`🔍 Recomenda-se auditoria física: ${divergenciasReais} divergências reais confirmadas, acima do limite de 10.`);
  }

  if (metrics.accuracyFinal !== null) {
    parts.push(`🎯 Acuracidade final: ${metrics.accuracyFinal.toFixed(1)}%.`);
  }

  return parts.length > 0 ? parts.join(' ') : 'Contagem registrada sem divergências relevantes a destacar.';
};
