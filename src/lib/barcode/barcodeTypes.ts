// Tipos e catálogos estáticos do Laboratório de Códigos de Barras.
// Ferramenta separada do Gerador de Etiquetas — não compartilha estado, chave de
// localStorage nem componentes de etiqueta com ele.

export type BarcodeSymbology =
  | 'ean13' | 'ean8' | 'upca' | 'code128' | 'itf14' | 'qrcode' | 'datamatrix';

export type BarcodeKind = '1d' | '2d';

export interface BarcodeSymbologyInfo {
  id: BarcodeSymbology;
  label: string;
  kind: BarcodeKind;
  bwipBcid: string;
  numeric: boolean;
  /** Só para os 4 formatos numéricos com dígito verificador GS1 Mod10. */
  fixedLength?: { withoutCheck: number; withCheck: number };
}

export const BARCODE_SYMBOLOGIES: BarcodeSymbologyInfo[] = [
  { id: 'ean13', label: 'EAN-13', kind: '1d', bwipBcid: 'ean13', numeric: true, fixedLength: { withoutCheck: 12, withCheck: 13 } },
  { id: 'ean8', label: 'EAN-8', kind: '1d', bwipBcid: 'ean8', numeric: true, fixedLength: { withoutCheck: 7, withCheck: 8 } },
  { id: 'upca', label: 'UPC-A', kind: '1d', bwipBcid: 'upca', numeric: true, fixedLength: { withoutCheck: 11, withCheck: 12 } },
  { id: 'code128', label: 'Code 128', kind: '1d', bwipBcid: 'code128', numeric: false },
  { id: 'itf14', label: 'ITF-14', kind: '1d', bwipBcid: 'itf14', numeric: true, fixedLength: { withoutCheck: 13, withCheck: 14 } },
  { id: 'qrcode', label: 'QR Code', kind: '2d', bwipBcid: 'qrcode', numeric: false },
  { id: 'datamatrix', label: 'Data Matrix', kind: '2d', bwipBcid: 'datamatrix', numeric: false },
];

export const BARCODE_SYMBOLOGY_MAP: Record<BarcodeSymbology, BarcodeSymbologyInfo> =
  BARCODE_SYMBOLOGIES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {} as Record<BarcodeSymbology, BarcodeSymbologyInfo>);

export function symbologyInfo(id: BarcodeSymbology): BarcodeSymbologyInfo {
  return BARCODE_SYMBOLOGY_MAP[id];
}

// ── Tamanhos de etiqueta ─────────────────────────────────────────────────────

export type LabelSizeId = '40x25' | '100x150' | '100x40' | 'custom';

export interface LabelSizeSpec {
  id: LabelSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
}

// Ordem exigida: 40×25 (principal) → 100×150 (grande) → 100×40 (vão) → Personalizado.
export const LABEL_SIZES: LabelSizeSpec[] = [
  { id: '40x25', label: '40 × 25 mm — Pequena', widthMm: 40, heightMm: 25 },
  { id: '100x150', label: '100 × 150 mm — Grande', widthMm: 100, heightMm: 150 },
  { id: '100x40', label: '100 × 40 mm — Vão', widthMm: 100, heightMm: 40 },
];

export const CUSTOM_SIZE_LIMITS_MM = { minWidth: 15, maxWidth: 200, minHeight: 10, maxHeight: 200 };

export function resolveLabelSize(
  sizeId: LabelSizeId,
  customWidthMm?: number,
  customHeightMm?: number
): { widthMm: number; heightMm: number } {
  if (sizeId === 'custom') {
    const w = clampMm(customWidthMm ?? 40, CUSTOM_SIZE_LIMITS_MM.minWidth, CUSTOM_SIZE_LIMITS_MM.maxWidth);
    const h = clampMm(customHeightMm ?? 25, CUSTOM_SIZE_LIMITS_MM.minHeight, CUSTOM_SIZE_LIMITS_MM.maxHeight);
    return { widthMm: w, heightMm: h };
  }
  const spec = LABEL_SIZES.find(s => s.id === sizeId) ?? LABEL_SIZES[0];
  return { widthMm: spec.widthMm, heightMm: spec.heightMm };
}

function clampMm(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** Layout físico usado por BarcodeLabel — escolhido pelo tamanho, não pelo conteúdo. */
export type LabelLayoutVariant = 'compact' | 'wide' | 'tall';

export function pickLayoutVariant(sizeId: LabelSizeId, widthMm: number, heightMm: number): LabelLayoutVariant {
  if (sizeId === '40x25') return 'compact';
  if (sizeId === '100x40') return 'wide';
  if (sizeId === '100x150') return 'tall';
  // Personalizado: heurística simples por proporção/altura, sem layout dedicado.
  if (heightMm <= 30) return 'compact';
  if (widthMm / heightMm >= 1.8) return 'wide';
  return 'tall';
}

// ── Campos de conteúdo (unitário e lote) ─────────────────────────────────────

export interface BarcodeFieldValues {
  value: string;
  symbology: BarcodeSymbology;
  name: string;
  sku: string;
  location: string;
  lot: string;
  expiry: string;
  quantity: string;
}

export const EMPTY_BARCODE_FIELDS: BarcodeFieldValues = {
  value: '', symbology: 'ean13', name: '', sku: '', location: '', lot: '', expiry: '', quantity: '',
};

// ── Preferências persistidas (localStorage) ──────────────────────────────────

export interface BarcodeLabSettings {
  showName: boolean;
  showSku: boolean;
  showLocation: boolean;
  showLot: boolean;
  showExpiry: boolean;
  showQuantity: boolean;
  showHumanReadable: boolean;
  fontScale: number;     // 0.7 – 1.6
  barcodeScale: number;  // 0.6 – 1.4
  eccLevel: 'L' | 'M' | 'Q' | 'H';
  copies: number;
  sizeId: LabelSizeId;
  customWidthMm: number;
  customHeightMm: number;
}

export const BARCODE_SETTINGS_LIMITS = {
  fontScale: { min: 0.7, max: 1.6 },
  barcodeScale: { min: 0.6, max: 1.4 },
  copies: { min: 1, max: 999 },
};

export const DEFAULT_BARCODE_LAB_SETTINGS: BarcodeLabSettings = {
  showName: true,
  showSku: true,
  showLocation: true,
  showLot: true,
  showExpiry: true,
  showQuantity: true,
  showHumanReadable: true,
  fontScale: 1,
  barcodeScale: 1,
  eccLevel: 'M',
  copies: 1,
  sizeId: '40x25',
  customWidthMm: 40,
  customHeightMm: 25,
};
