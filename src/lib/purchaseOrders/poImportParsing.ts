// Importação de OC (CSV/XLSX) — detecção/mapeamento de colunas por perfil, mesmo
// padrão de countManagementUtils.ts (detectCountColumnMappings/suggestCountMapping/
// applyCountColumnMapping), adaptado aos campos da OC. Parsing de arquivo reaproveita
// parseCSV (productImportUtils.ts) e a biblioteca `xlsx` já instalada no projeto —
// nenhuma dependência nova.
//
// Segurança: XLSX é lido só como dados (`bookVBA` não é habilitado, fórmulas nunca
// são executadas — `xlsx` não executa nada, só lê valores/células) e `.xlsm`
// (macro-enabled) é rejeitado antes do parse por extensão, já que macro nunca é um
// dado de planilha legítimo para este importador.

import { parseCSV } from '../productImportUtils';
import type { PoColumnMapping, PoImportRow, ClassifiedPoImportRow } from './poTypes';
import { normalizeEan } from '../nfe/nfeEanUtils';

// Nenhum outro importador do projeto documenta um teto explícito de linhas; adoto
// 5.000 como limite seguro para uma OC (uma planilha de pedido de compra real não
// chega a essa ordem de grandeza) — acima disso, erro claro em vez de travar a UI.
export const MAX_PO_IMPORT_ROWS = 5000;

export const PO_IMPORT_FIELDS = [
  { key: 'poNumber', label: 'Número da OC', required: true, aliases: ['numero', 'numeroda oc', 'numero oc', 'pedido', 'ordem de compra', 'oc', 'po', 'ponumber', 'ponumero'] },
  { key: 'supplierName', label: 'Fornecedor', required: true, aliases: ['fornecedor', 'supplier', 'razao social', 'emitente'] },
  { key: 'code', label: 'SKU/Código', required: true, aliases: ['sku', 'codigo', 'code', 'item', 'ref', 'referencia', 'cprod'] },
  { key: 'ean', label: 'EAN/GTIN', required: false, aliases: ['ean', 'gtin', 'barcode', 'codigobarras', 'cean'] },
  { key: 'description', label: 'Descrição', required: true, aliases: ['descricao', 'produto', 'nome', 'xprod', 'description'] },
  { key: 'unit', label: 'Unidade', required: false, aliases: ['unidade', 'un', 'unit', 'ucom'] },
  { key: 'quantity', label: 'Quantidade', required: true, aliases: ['quantidade', 'qtd', 'qcom', 'quantity', 'qty'] },
  { key: 'unitPrice', label: 'Preço Unitário', required: false, aliases: ['precounitario', 'preco unitario', 'vuncom', 'unitprice', 'valor unitario'] },
  { key: 'total', label: 'Total', required: false, aliases: ['total', 'vprod', 'valortotal', 'valor total'] },
] as const;

export interface DetectedPoColumn {
  name: string;
  detectedField: string | null;
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

export function detectPoColumnMappings(headers: string[]): DetectedPoColumn[] {
  return headers.map(header => {
    const headerLower = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    let detectedField: string | null = null;
    let confidence: DetectedPoColumn['confidence'] = 'none';

    for (const field of PO_IMPORT_FIELDS) {
      const aliasesNorm = field.aliases.map(a => a.replace(/[^a-z0-9]/g, ''));
      if (aliasesNorm.some(alias => alias === headerLower)) {
        detectedField = field.key;
        confidence = 'high';
        break;
      }
      // Só considera inclusão de substring para aliases com pelo menos 3 caracteres —
      // aliases curtos como "un" (unidade) dão falso positivo dentro de qualquer
      // cabeçalho comum ("coluna", "conta" etc.).
      if (aliasesNorm.some(alias => alias.length >= 3 && (headerLower.includes(alias) || alias.includes(headerLower)))) {
        detectedField = field.key;
        confidence = 'medium';
      }
      if (!detectedField) {
        for (const alias of aliasesNorm) {
          if (levenshteinDistance(headerLower, alias) <= 2) {
            detectedField = field.key;
            confidence = 'low';
          }
        }
      }
    }

    return { name: header, detectedField, confidence };
  });
}

export function suggestPoColumnMapping(detected: DetectedPoColumn[]): PoColumnMapping {
  const mapping: PoColumnMapping = {
    poNumber: null, supplierName: null, code: null, ean: null, description: null,
    unit: null, quantity: null, unitPrice: null, total: null,
  };
  for (const col of detected) {
    if (col.detectedField && col.confidence !== 'none') {
      (mapping as unknown as Record<string, string | null>)[col.detectedField] = col.name;
    }
  }
  return mapping;
}

export function applyPoColumnMapping(rawRows: PoImportRow[], mapping: PoColumnMapping): PoImportRow[] {
  const fieldMapping: Record<string, string | null> = {
    poNumber: mapping.poNumber, supplierName: mapping.supplierName, code: mapping.code, ean: mapping.ean,
    description: mapping.description, unit: mapping.unit, quantity: mapping.quantity,
    unitPrice: mapping.unitPrice, total: mapping.total,
  };
  return rawRows.map(row => {
    const mapped: PoImportRow = {};
    for (const [targetField, sourceCol] of Object.entries(fieldMapping)) {
      if (sourceCol && row[sourceCol] !== undefined) mapped[targetField] = row[sourceCol];
    }
    return mapped;
  });
}

const UNSAFE_EXTENSIONS = new Set(['xlsm', 'xlsb', 'xls']); // .xls/.xlsb podem carregar macro legada; só .xlsx/.csv são aceitos como dado puro
const SAFE_EXTENSIONS = new Set(['csv', 'xlsx']);

/** `null` quando o arquivo é seguro para processar; mensagem pronta para a tela quando não. */
export function validatePoImportFile(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (UNSAFE_EXTENSIONS.has(extension)) {
    return 'Arquivos com macro (.xlsm/.xlsb) ou o formato legado .xls não são aceitos — exporte como .xlsx ou .csv.';
  }
  if (!SAFE_EXTENSIONS.has(extension)) {
    return 'Formato de arquivo não suportado — use .csv ou .xlsx.';
  }
  return null;
}

export async function parsePoImportFile(file: File): Promise<{ headers: string[]; rows: PoImportRow[] }> {
  const fileError = validatePoImportFile(file.name);
  if (fileError) throw new Error(fileError);

  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    const content = await file.text();
    const { headers, rows } = parseCSV(content);
    if (rows.length > MAX_PO_IMPORT_ROWS) {
      throw new Error(`O arquivo tem ${rows.length} linhas — o limite para importação de OC é ${MAX_PO_IMPORT_ROWS}.`);
    }
    return { headers, rows: rows as PoImportRow[] };
  }

  // .xlsx — a lib só lê valores de célula (raw), nunca fórmula/macro/link ativo.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, bookVBA: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });

  if (jsonData.length === 0) return { headers: [], rows: [] };

  const headers = (jsonData[0] as string[]).map(String);
  const dataRows = jsonData.slice(1) as unknown[][];
  if (dataRows.length > MAX_PO_IMPORT_ROWS) {
    throw new Error(`O arquivo tem ${dataRows.length} linhas — o limite para importação de OC é ${MAX_PO_IMPORT_ROWS}.`);
  }

  const rows: PoImportRow[] = dataRows.map(row => {
    const obj: PoImportRow = {};
    headers.forEach((header, idx) => { obj[header] = row[idx] as string | number | undefined; });
    return obj;
  });

  return { headers, rows };
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

/** Classifica uma linha mapeada: nunca descarta silenciosamente — linhas inválidas
 *  carregam seus próprios `errors[]` para a prévia mostrar e o operador corrigir. */
export function classifyPoImportRow(row: PoImportRow, lineNumber: number): ClassifiedPoImportRow {
  const errors: string[] = [];

  const poNumber = String(row.poNumber ?? '').trim();
  if (!poNumber) errors.push('Número da OC ausente.');

  const description = String(row.description ?? '').trim();
  if (!description) errors.push('Descrição ausente.');

  const quantity = parseNumber(row.quantity);
  if (quantity === null) errors.push('Quantidade ausente ou inválida.');
  else if (quantity <= 0) errors.push('Quantidade precisa ser maior que zero.');

  const unitPrice = parseNumber(row.unitPrice);
  const totalValue = parseNumber(row.total);

  const eanRaw = row.ean !== undefined ? String(row.ean).trim() : null;

  return {
    lineNumber,
    poNumber,
    originCode: row.code !== undefined ? String(row.code).trim() : null,
    ean: normalizeEan(eanRaw) ? eanRaw : null,
    description,
    unit: row.unit !== undefined ? String(row.unit).trim() : null,
    quantity: quantity ?? 0,
    unitPrice,
    totalValue,
    errors,
  };
}
