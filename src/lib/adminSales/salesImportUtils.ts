// Vendas — detecção/mapeamento de colunas e parsing de arquivo.
// Mesmo padrão de countManagementUtils.ts: espelha productImportUtils.ts sem tocar nele.

import { parseCSV } from '../productImportUtils';

export interface SalesRow {
  [key: string]: string | number | undefined;
}

export const SALES_FIELDS = [
  { key: 'data', label: 'Data', required: true, aliases: ['data', 'date', 'datavenda', 'data_venda'] },
  { key: 'sku', label: 'SKU/Código', required: true, aliases: ['sku', 'codigo', 'code', 'item', 'ref', 'referencia'] },
  { key: 'produto', label: 'Produto', required: false, aliases: ['produto', 'nome', 'name', 'descricao', 'description'] },
  { key: 'quantidade', label: 'Quantidade', required: false, aliases: ['quantidade', 'qtd', 'qty', 'quantity', 'vendas'] },
  { key: 'precoUnitario', label: 'Preço Unitário', required: false, aliases: ['precounitario', 'preco unitario', 'unitprice', 'preco', 'price', 'valorunitario'] },
  { key: 'faturamento', label: 'Faturamento Total', required: false, aliases: ['faturamento', 'total', 'valortotal', 'totalvalue', 'receita', 'revenue'] },
] as const;

export type SalesFieldKey = typeof SALES_FIELDS[number]['key'];

export interface SalesColumnMapping {
  data: string | null;
  sku: string | null;
  produto: string | null;
  quantidade: string | null;
  precoUnitario: string | null;
  faturamento: string | null;
}

export interface DetectedSalesColumn {
  name: string;
  detectedField: SalesFieldKey | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
};

export const detectSalesColumnMappings = (headers: string[]): DetectedSalesColumn[] => {
  const detected: DetectedSalesColumn[] = [];

  for (const header of headers) {
    const headerLower = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    let detectedField: SalesFieldKey | null = null;
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';

    for (const field of SALES_FIELDS) {
      const normalizedAliases = field.aliases.map(a => a.replace(/[^a-z0-9]/g, ''));
      if (normalizedAliases.some(alias => alias === headerLower)) {
        detectedField = field.key;
        confidence = 'high';
        break;
      }
      if (normalizedAliases.some(alias => headerLower.includes(alias) || alias.includes(headerLower))) {
        detectedField = field.key;
        confidence = 'medium';
      }
      if (!detectedField) {
        for (const alias of normalizedAliases) {
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

export const suggestSalesMapping = (detected: DetectedSalesColumn[]): SalesColumnMapping => {
  const mapping: SalesColumnMapping = { data: null, sku: null, produto: null, quantidade: null, precoUnitario: null, faturamento: null };
  for (const col of detected) {
    if (col.detectedField && col.confidence !== 'none' && !mapping[col.detectedField]) {
      mapping[col.detectedField] = col.name;
    }
  }
  return mapping;
};

export const applySalesColumnMapping = (rawRows: SalesRow[], mapping: SalesColumnMapping): SalesRow[] => {
  return rawRows.map(row => {
    const mapped: SalesRow = {};
    (Object.keys(mapping) as SalesFieldKey[]).forEach(field => {
      const sourceCol = mapping[field];
      if (sourceCol && row[sourceCol] !== undefined) {
        mapped[field] = row[sourceCol];
      }
    });
    return mapped;
  });
};

// Parses .csv (via parseCSV existente) ou .xlsx/.xls, mesmo branch usado em countManagementUtils.ts.
export const parseSalesFile = async (file: File): Promise<{ headers: string[]; rows: SalesRow[] }> => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    const content = await file.text();
    return parseCSV(content) as unknown as { headers: string[]; rows: SalesRow[] };
  }

  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });

  if (jsonData.length === 0) return { headers: [], rows: [] };

  const headers = (jsonData[0] as string[]).map(String);
  const rows: SalesRow[] = (jsonData.slice(1) as (string | number)[][]).map(row => {
    const obj: SalesRow = {};
    headers.forEach((header, idx) => { obj[header] = row[idx]; });
    return obj;
  });

  return { headers, rows };
};

// SHA-256 do conteúdo do arquivo (Web Crypto nativo), para detectar reimportação — mesmo
// raciocínio de automation_webhook_deliveries.payload_hash (migration 053), calculado no browser.
export const computeFileHash = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const parseNumber = (value: string | number | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/\./g, '').replace(',', '.')) || parseFloat(String(value));
  return isNaN(num) ? null : num;
};

const parseDate = (value: string | number | undefined): string | null => {
  if (value === undefined || value === '') return null;
  if (typeof value === 'number') {
    // Serial date do Excel (dias desde 1899-12-30)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(epoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

export interface ValidatedSalesRow {
  saleDate: string;
  sku: string | null;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  totalValue: number;
}

export interface SalesRowError {
  rowIndex: number;
  message: string;
}

export interface SalesImportPreview {
  valid: ValidatedSalesRow[];
  errors: SalesRowError[];
  warnings: string[];
}

// Valida e calcula faturamento quando só há quantidade+preço unitário — nunca bloqueia o restante
// do arquivo por causa de uma linha ruim ou de um SKU não reconhecido (isso é sinalizado à parte).
// fallbackDate cobre relatórios agregados sem coluna de data por linha (ex: export padrão de
// vendas do Tiny: Produto/Código (SKU)/Quantidade/Valor/Frete/Total, sem data) — o usuário informa
// a data de referência do relatório no wizard e ela é aplicada a toda linha sem data própria.
export const validateAndBuildSalesRows = (rows: SalesRow[], fallbackDate?: string | null): SalesImportPreview => {
  const valid: ValidatedSalesRow[] = [];
  const errors: SalesRowError[] = [];
  const warnings: string[] = [];
  const parsedFallbackDate = fallbackDate ? parseDate(fallbackDate) : null;

  rows.forEach((row, idx) => {
    const saleDate = parseDate(row.data) ?? parsedFallbackDate;
    if (!saleDate) {
      errors.push({ rowIndex: idx, message: 'Data ausente ou inválida.' });
      return;
    }

    const productName = String(row.produto ?? row.sku ?? '').trim();
    const sku = row.sku ? String(row.sku).trim() : null;
    const quantity = parseNumber(row.quantidade) ?? 0;
    const unitPrice = parseNumber(row.precoUnitario);
    const faturamentoInformado = parseNumber(row.faturamento);

    let totalValue: number;
    if (faturamentoInformado !== null) {
      totalValue = faturamentoInformado;
    } else if (unitPrice !== null) {
      totalValue = quantity * unitPrice;
    } else {
      errors.push({ rowIndex: idx, message: 'Informe faturamento total ou preço unitário.' });
      return;
    }

    if (!productName) {
      errors.push({ rowIndex: idx, message: 'Produto/SKU ausente.' });
      return;
    }

    if (!sku) {
      warnings.push(`Linha ${idx + 1}: sem SKU, produto ficará como "não associado".`);
    }

    valid.push({ saleDate, sku, productName, quantity, unitPrice, totalValue });
  });

  return { valid, errors, warnings };
};
