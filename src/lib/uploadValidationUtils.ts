export interface UploadValidationResult {
  valid: boolean;
  error?: string;
}

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];
const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
];
const MAX_SIZE_MB  = 10;
const MAX_ROWS     = 50_000;

export function validateUploadFile(file: File): UploadValidationResult {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Tipo de arquivo não permitido (${ext}). Use: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type) && file.type !== '') {
    return {
      valid: false,
      error: `MIME type inválido: ${file.type}`,
    };
  }

  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb > MAX_SIZE_MB) {
    return {
      valid: false,
      error: `Arquivo muito grande (${sizeMb.toFixed(1)} MB). Máximo: ${MAX_SIZE_MB} MB`,
    };
  }

  return { valid: true };
}

export function validateRowCount(count: number): UploadValidationResult {
  if (count > MAX_ROWS) {
    return {
      valid: false,
      error: `Planilha contém ${count.toLocaleString()} linhas. Máximo permitido: ${MAX_ROWS.toLocaleString()}`,
    };
  }
  return { valid: true };
}

export function validateRequiredColumns(
  headers: string[],
  required: string[]
): UploadValidationResult {
  const headersLower = headers.map((h) => h.toLowerCase().trim());
  const missing = required.filter((r) => !headersLower.includes(r.toLowerCase()));
  if (missing.length > 0) {
    return { valid: false, error: `Colunas obrigatórias ausentes: ${missing.join(', ')}` };
  }
  return { valid: true };
}
