// Product Import Utilities

import type { ProductRaw, ProductValidated, ImportError, ImportSummary, ColumnMapping, DetectedColumn, ProductFromDB } from './productImportTypes';

// Standard field names
export const STANDARD_FIELDS = [
  { key: 'name', label: 'Nome', required: true, aliases: ['nome', 'name', 'produto', 'descricao', 'description'] },
  { key: 'sku', label: 'SKU', required: true, aliases: ['sku', 'codigo', 'code', 'item', 'ref', 'referencia'] },
  { key: 'ean', label: 'EAN', required: false, aliases: ['ean', 'barcode', 'codigobarras', 'barras', 'gtin', 'upc'] },
  { key: 'location', label: 'Local', required: false, aliases: ['local', 'location', 'localizacao', 'endereco', 'posicao', 'rua', 'vao'] },
  { key: 'price', label: 'Preço', required: false, aliases: ['preço', 'preco', 'price', 'valor', 'unitario', 'unit'] },
];

// Auto-detect column mappings
export const detectColumnMappings = (headers: string[]): DetectedColumn[] => {
  const detected: DetectedColumn[] = [];

  for (const header of headers) {
    const headerLower = header.toLowerCase().trim();
    let detectedField: string | null = null;
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
    let sampleValues: string[] = [];

    for (const field of STANDARD_FIELDS) {
      // Exact match
      if (field.aliases.some(alias => alias === headerLower)) {
        detectedField = field.key;
        confidence = 'high';
        break;
      }
      // Contains match
      if (field.aliases.some(alias => headerLower.includes(alias) || alias.includes(headerLower))) {
        detectedField = field.key;
        confidence = 'medium';
      }
      // Levenshtein distance match (fuzzy)
      if (!detectedField) {
        for (const alias of field.aliases) {
          const distance = levenshteinDistance(headerLower, alias);
          if (distance <= 2) {
            detectedField = field.key;
            confidence = 'low';
          }
        }
      }
    }

    detected.push({
      name: header,
      sampleValues,
      detectedField,
      confidence,
    });
  }

  return detected;
};

// Simple Levenshtein distance for fuzzy matching
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

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

// Create suggested mapping from detected columns
export const suggestMapping = (detected: DetectedColumn[]): ColumnMapping => {
  const mapping: ColumnMapping = {
    name: null,
    sku: null,
    ean: null,
    location: null,
    price: null,
  };

  for (const col of detected) {
    if (col.detectedField && col.confidence !== 'none') {
      (mapping as Record<string, string | null>)[col.detectedField] = col.name;
    }
  }

  return mapping;
};

// Apply column mapping to raw data
export const applyColumnMapping = (
  rawData: ProductRaw[],
  mapping: ColumnMapping
): ProductRaw[] => {
  return rawData.map(row => {
    const mapped: ProductRaw = {};

    const fieldMapping: Record<string, string> = {
      name: mapping.name || 'name',
      sku: mapping.sku || 'sku',
      ean: mapping.ean || 'ean',
      location: mapping.location || 'location',
      price: mapping.price || 'price',
    };

    for (const [targetField, sourceCol] of Object.entries(fieldMapping)) {
      if (sourceCol && row[sourceCol] !== undefined) {
        mapped[targetField] = row[sourceCol];
      }
    }

    return mapped;
  });
};

// Clean and trim text
const cleanText = (value: string | number | undefined | null): string => {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  return str.replace(/\s+/g, ' ');
};

// Parse price to number
const parsePrice = (value: string | number | undefined | null): number | null => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    return isNaN(value) ? null : Math.round(value * 100) / 100;
  }

  const cleaned = String(value).trim();
  if (!cleaned) return null;

  let normalized = cleaned;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
};

// Validate a single product
export const validateProduct = (
  mappedData: ProductRaw,
  existingProducts: Map<string, ProductFromDB>,
  rowIndex: number
): ProductValidated => {
  const errors: string[] = [];

  const sku = cleanText(mappedData.sku);
  const name = cleanText(mappedData.name);
  const ean = mappedData.ean ? String(mappedData.ean).trim() : null;
  const location = cleanText(mappedData.location);
  const price = parsePrice(mappedData.price);

  // Validate SKU (required)
  if (!sku) {
    errors.push('SKU é obrigatório');
  }

  // Validate Name (required)
  if (!name) {
    errors.push('Nome é obrigatório');
  }

  // Validate price if present
  if (price !== null && price < 0) {
    errors.push('Preço não pode ser negativo');
  }

  let isNew = false;
  let status: 'new' | 'update' | 'error' = 'new';
  let oldData: ProductValidated['oldData'] = undefined;
  let changesDetected: string[] = [];

  if (errors.length > 0) {
    status = 'error';
  } else {
    const existing = existingProducts.get(sku.toUpperCase());
    if (existing) {
      status = 'update';
      isNew = false;
      oldData = {
        name: existing.name,
        sku: existing.sku,
        ean: existing.ean,
        location: existing.location,
        price: existing.price,
      };

      // Detect changes
      if (name !== existing.name) changesDetected.push('Nome');
      if (ean !== existing.ean) changesDetected.push('EAN');
      if (location !== existing.location) changesDetected.push('Local');
      if (price !== existing.price) changesDetected.push('Preço');
    } else {
      status = 'new';
      isNew = true;
    }
  }

  return {
    name: name || '',
    sku: sku,
    ean: ean || null,
    location: location || null,
    price: price,
    isNew,
    isValid: errors.length === 0,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    status,
    oldData,
    changesDetected: changesDetected.length > 0 ? changesDetected : undefined,
  };
};

// Parse CSV content
export const parseCSV = (content: string): { headers: string[]; rows: ProductRaw[] } => {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = parseCSVLine(lines[0], delimiter);

  const rows: ProductRaw[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line, delimiter);
    const row: ProductRaw = {};

    headers.forEach((header, index) => {
      if (index < values.length) {
        row[header] = values[index];
      }
    });

    rows.push(row);
  }

  return { headers, rows };
};

// Parse a single CSV line
const parseCSVLine = (line: string, delimiter: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map(v => v.trim());
};

// Process raw products with mapping — chunked to avoid blocking UI
export const processRawProducts = async (
  rawData: ProductRaw[],
  existingProducts: Map<string, ProductFromDB>,
  mapping: ColumnMapping,
  onProgress?: (processed: number, total: number) => void
): Promise<{ products: ProductValidated[]; errors: ImportError[] }> => {
  // Apply mapping first
  const mappedData = applyColumnMapping(rawData, mapping);

  const products: ProductValidated[] = [];
  const errors: ImportError[] = [];
  const CHUNK_SIZE = 500;

  for (let i = 0; i < mappedData.length; i += CHUNK_SIZE) {
    const chunk = mappedData.slice(i, i + CHUNK_SIZE);

    chunk.forEach((data, j) => {
      const validated = validateProduct(data, existingProducts, i + j + 2);

      if (validated.status === 'error') {
        errors.push({
          row: i + j + 2,
          sku: validated.sku || undefined,
          name: validated.name || undefined,
          error: validated.error || 'Erro desconhecido',
        });
      }

      products.push(validated);
    });

    if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, mappedData.length), mappedData.length);

    // Yield to the event loop between chunks to keep UI responsive
    if (i + CHUNK_SIZE < mappedData.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return { products, errors };
};

// Calculate import summary
export const calculateImportSummary = (products: ProductValidated[]): ImportSummary => ({
  totalRows: products.length,
  validProducts: products.filter(p => p.isValid).length,
  invalidProducts: products.filter(p => !p.isValid).length,
  newProducts: products.filter(p => p.status === 'new').length,
  updateProducts: products.filter(p => p.status === 'update').length,
  skippedRows: products.filter(p => p.status === 'skip').length,
  importedCount: 0,
  productsWithChanges: products.filter(p => p.changesDetected && p.changesDetected.length > 0).length,
});

// Export errors to CSV
export const exportErrorsToCSV = (errors: ImportError[]): string => {
  const headers = ['Linha', 'SKU', 'Nome', 'Erro'];
  const lines = [headers.join(';')];

  errors.forEach(error => {
    const line = [
      String(error.row),
      error.sku || '',
      error.name || '',
      error.error,
    ].map(v => v.includes(';') ? `"${v}"` : v);
    lines.push(line.join(';'));
  });

  return lines.join('\n');
};

// Export products to CSV
export const exportProductsToCSV = (products: ProductValidated[]): string => {
  const headers = ['Nome', 'SKU', 'EAN', 'Local', 'Preço', 'Status'];
  const lines = [headers.join(';')];

  products.forEach(product => {
    const line = [
      product.name,
      product.sku,
      product.ean || '',
      product.location || '',
      product.price !== null ? product.price.toFixed(2) : '',
      product.status === 'new' ? 'Novo' : product.status === 'update' ? 'Atualização' : 'Erro',
    ].map(v => String(v).includes(';') ? `"${v}"` : v);
    lines.push(line.join(';'));
  });

  return lines.join('\n');
};

// Download a string as file
export const downloadFile = (content: string, filename: string, type: string = 'text/csv;charset=utf-8') => {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Format price for display
export const formatPrice = (price: number | null): string => {
  if (price === null || price === undefined) return '-';
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Format file size
export const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Format date for display
export const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'N/A';
  }
};
