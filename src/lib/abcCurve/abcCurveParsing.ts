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

// Converte texto de planilha em número de forma determinística, aceitando os dois padrões
// (pt-BR e internacional) sem heurística de idioma. A regra é a posição do ÚLTIMO separador:
// ele é o decimal, e todos os anteriores são de milhar. Isso corrige o bug anterior, que
// removia todos os pontos antes de converter e transformava "4002.80" em 400280.
//
// Ambiguidade real: um único separador seguido de exatamente 3 dígitos ("1.234" / "1,234")
// é milhar nos dois padrões — tratado como milhar, mas só quando a parte inteira tem a forma
// de um grupo de milhar (1 a 3 dígitos, sem zero à esquerda), para "0.500" continuar 0,5.
export const parseNumber = (value: string | number | undefined): number | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (raw === '') return null;

  const firstDigit = raw.search(/[0-9]/);
  if (firstDigit === -1) return null;
  // Sinal negativo é o que aparece antes do primeiro dígito ("-10", "R$ -10", "-R$ 10").
  const negative = raw.slice(0, firstDigit).includes('-');

  // Descarta símbolo monetário, espaço (inclusive NBSP), % e qualquer outro ruído.
  const digits = raw.replace(/[^0-9.,]/g, '');
  if (digits === '') return null;

  const separatorCount = (digits.match(/[.,]/g) ?? []).length;
  const decimalPos = Math.max(digits.lastIndexOf('.'), digits.lastIndexOf(','));

  let normalized: string;
  if (decimalPos === -1) {
    normalized = digits;
  } else {
    const intPart = digits.slice(0, decimalPos).replace(/[.,]/g, '');
    const fracPart = digits.slice(decimalPos + 1);
    if (fracPart === '' || !/^[0-9]+$/.test(fracPart)) return null;
    const looksLikeThousands = separatorCount === 1 && fracPart.length === 3 && /^[1-9][0-9]{0,2}$/.test(intPart);
    normalized = looksLikeThousands ? `${intPart}${fracPart}` : `${intPart === '' ? '0' : intPart}.${fracPart}`;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return negative ? -num : num;
};

// Campos obrigatórios do tipo de arquivo que ainda não têm coluna escolhida. Usado para
// bloquear prévia/publicação com mensagem explícita, em vez de gerar análise incompleta.
export const missingRequiredFields = (fields: FieldDef[], mapping: ColumnMapping): string[] =>
  fields.filter(f => f.required && !mapping[f.key]).map(f => f.label);
