// Product Import Types

export interface ProductRaw {
  [key: string]: string | number | undefined;
}

export interface ProductValidated {
  id?: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
  price: number | null;
  isNew: boolean;
  isValid: boolean;
  error?: string;
  status: 'new' | 'update' | 'error' | 'skip';
  oldData?: {
    name: string;
    sku: string;
    ean: string | null;
    location: string | null;
    price: number | null;
  };
  changesDetected?: string[];
}

export interface ImportSummary {
  totalRows: number;
  validProducts: number;
  invalidProducts: number;
  newProducts: number;
  updateProducts: number;
  skippedRows: number;
  importedCount: number;
  productsWithChanges: number;
}

export interface ImportProgress {
  current: number;
  total: number;
  percentage: number;
  status: 'idle' | 'reading' | 'mapping' | 'validating' | 'importing' | 'completed' | 'error';
  message: string;
}

export interface ImportError {
  row: number;
  sku?: string;
  name?: string;
  error: string;
}

export type ImportStatus = 'upload' | 'mapping' | 'preview' | 'importing' | 'complete' | 'error';

// Column mapping types
export interface ColumnMapping {
  name: string | null; // Which column from the file maps to 'name'
  sku: string | null;
  ean: string | null;
  location: string | null;
  price: string | null;
}

export interface DetectedColumn {
  name: string;
  sampleValues: string[];
  detectedField: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

// Import history types
export interface ImportHistoryRecord {
  id: string;
  fileName: string;
  fileSize: number | null;
  fileContent: string | null;
  totalProducts: number;
  newProducts: number;
  updatedProducts: number;
  errors: number;
  importedBy: string;
  createdAt: string;
  status: 'completed' | 'undone';
  undoneAt?: string;
  columnMapping: ColumnMapping | null;
}

export interface ProductFromDB {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
  price: number | null;
  createdAt: string;
  updatedAt: string;
}
