// Curva ABC — detecção/mapeamento de colunas e parsing de arquivo, generalizado para os 4
// tipos de planilha (vendas, preços/custos, estoque, ABC opcional do Tiny). Mesmo padrão de
// src/lib/adminSales/salesImportUtils.ts (que por sua vez espelha countManagementUtils.ts),
// aqui parametrizado por FieldDef[] em vez de fixo, para não duplicar 4x a mesma lógica.

import { parseCSV } from '../productImportUtils';

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
}

export const VENDAS_FIELDS: FieldDef[] = [
  { key: 'produto', label: 'Produto', required: false, aliases: ['produto', 'nome', 'descricao'] },
  { key: 'sku', label: 'Código (SKU)', required: true, aliases: ['codigosku', 'codigo', 'sku', 'code', 'referencia'] },
  { key: 'quantidade', label: 'Quantidade', required: true, aliases: ['quantidade', 'qtd', 'qty'] },
  { key: 'valor', label: 'Valor', required: true, aliases: ['valor', 'faturamento'] },
  { key: 'frete', label: 'Frete', required: false, aliases: ['frete', 'freight'] },
  { key: 'total', label: 'Total', required: false, aliases: ['total', 'valortotal'] },
];

export const PRECOS_CUSTOS_FIELDS: FieldDef[] = [
  { key: 'descricao', label: 'Descrição', required: false, aliases: ['descricao', 'produto', 'nome'] },
  { key: 'sku', label: 'Código (SKU)', required: true, aliases: ['codigosku', 'codigo', 'sku', 'code', 'referencia'] },
  { key: 'unidade', label: 'Unidade', required: false, aliases: ['unidade', 'un', 'unit'] },
  { key: 'preco', label: 'Preço', required: true, aliases: ['preco', 'precotabela', 'price'] },
  { key: 'precoPromocional', label: 'Preço promocional', required: false, aliases: ['precopromocional', 'promo', 'precopromo'] },
  { key: 'custo', label: 'Custo', required: true, aliases: ['custo', 'cost', 'custounitario'] },
];

export const ESTOQUE_FIELDS: FieldDef[] = [
  { key: 'sku', label: 'SKU', required: true, aliases: ['codigosku', 'codigo', 'sku', 'code', 'referencia'] },
  { key: 'estoqueDisponivel', label: 'Estoque disponível', required: true, aliases: ['estoquedisponivel', 'estoque', 'saldo', 'disponivel'] },
  { key: 'estoqueReservado', label: 'Estoque reservado', required: false, aliases: ['estoquereservado', 'reservado'] },
  { key: 'comprasEmTransito', label: 'Compras em trânsito', required: false, aliases: ['comprasemtransito', 'emtransito', 'transito'] },
  { key: 'leadTimeDias', label: 'Lead time (dias)', required: false, aliases: ['leadtime', 'leadtimedias', 'prazoentrega'] },
  { key: 'estoqueSeguranca', label: 'Estoque de segurança', required: false, aliases: ['estoqueseguranca', 'seguranca', 'safetystock'] },
];

export const ABC_TINY_FIELDS: FieldDef[] = [
  { key: 'produto', label: 'Produto', required: false, aliases: ['produto', 'nome', 'descricao'] },
  { key: 'sku', label: 'Código', required: true, aliases: ['codigo', 'sku', 'code'] },
  { key: 'quantidade', label: 'Quantidade', required: false, aliases: ['quantidade', 'qtd'] },
  { key: 'valor', label: 'Valor', required: false, aliases: ['valor'] },
  { key: 'percentualIndividual', label: '% Individual', required: false, aliases: ['percentualindividual', 'individual'] },
  { key: 'percentualAcumulado', label: '% Acumulado', required: false, aliases: ['percentualacumulado', 'acumulado'] },
  { key: 'classificacao', label: 'Classificação', required: false, aliases: ['classificacao', 'classe'] },
];

export type ColumnMapping = Record<string, string | null>;

export interface DetectedColumn {
  name: string;
  detectedField: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

const normalize = (value: string): string => value.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

const levenshteinDistance = (a: string, b: string): number => {
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
};

export const detectColumns = (headers: string[], fields: FieldDef[]): DetectedColumn[] => {
  return headers.map(header => {
    const headerLower = normalize(header);
    let detectedField: string | null = null;
    let confidence: DetectedColumn['confidence'] = 'none';

    for (const field of fields) {
      const aliases = field.aliases.map(normalize);
      if (aliases.some(a => a === headerLower)) {
        return { name: header, detectedField: field.key, confidence: 'high' };
      }
    }
    for (const field of fields) {
      const aliases = field.aliases.map(normalize);
      if (aliases.some(a => headerLower.includes(a) || a.includes(headerLower))) {
        detectedField = field.key;
        confidence = 'medium';
        break;
      }
    }
    if (!detectedField) {
      for (const field of fields) {
        const aliases = field.aliases.map(normalize);
        if (aliases.some(a => levenshteinDistance(headerLower, a) <= 2)) {
          detectedField = field.key;
          confidence = 'low';
          break;
        }
      }
    }
    return { name: header, detectedField, confidence };
  });
};

export const suggestMapping = (detected: DetectedColumn[], fields: FieldDef[]): ColumnMapping => {
  const mapping: ColumnMapping = {};
  fields.forEach(f => { mapping[f.key] = null; });
  for (const col of detected) {
    if (col.detectedField && col.confidence !== 'none' && !mapping[col.detectedField]) {
      mapping[col.detectedField] = col.name;
    }
  }
  return mapping;
};

export interface RawRow {
  [key: string]: string | number | undefined;
}

export const applyMapping = (rawRows: RawRow[], mapping: ColumnMapping): RawRow[] => {
  return rawRows.map(row => {
    const mapped: RawRow = {};
    Object.keys(mapping).forEach(field => {
      const sourceCol = mapping[field];
      if (sourceCol && row[sourceCol] !== undefined) mapped[field] = row[sourceCol];
    });
    return mapped;
  });
};

// Parses .csv (via parseCSV existente) ou .xlsx/.xls — mesmo branch de salesImportUtils.ts.
export const parseTabularFile = async (file: File): Promise<{ headers: string[]; rows: RawRow[] }> => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    const content = await file.text();
    return parseCSV(content) as unknown as { headers: string[]; rows: RawRow[] };
  }

  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });

  if (jsonData.length === 0) return { headers: [], rows: [] };

  const headers = (jsonData[0] as string[]).map(String);
  const rows: RawRow[] = (jsonData.slice(1) as (string | number)[][]).map(row => {
    const obj: RawRow = {};
    headers.forEach((header, idx) => { obj[header] = row[idx]; });
    return obj;
  });

  return { headers, rows };
};

export const computeFileHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Normaliza só espaços nas extremidades do SKU — nunca altera o conteúdo (maiúsculas, hífens etc).
export const normalizeSku = (value: string | number | undefined): string | null => {
  if (value === undefined || value === '') return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

export const parseNumber = (value: string | number | undefined): number | null => {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  const normalized = String(value).trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  if (!isNaN(num)) return num;
  const plain = parseFloat(String(value));
  return isNaN(plain) ? null : plain;
};
