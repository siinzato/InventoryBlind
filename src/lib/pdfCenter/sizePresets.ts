export interface SizePreset {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  category: 'termica' | 'papel';
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: '40x25', label: '40 × 25 mm (etiqueta térmica)', widthMm: 40, heightMm: 25, category: 'termica' },
  { id: '100x40', label: '100 × 40 mm (etiqueta térmica)', widthMm: 100, heightMm: 40, category: 'termica' },
  { id: '100x150', label: '100 × 150 mm (etiqueta térmica)', widthMm: 100, heightMm: 150, category: 'termica' },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, category: 'papel' },
  { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210, category: 'papel' },
  { id: 'carta', label: 'Carta (Letter)', widthMm: 215.9, heightMm: 279.4, category: 'papel' },
];

export const CUSTOM_SIZE_ID = 'custom';

export function findSizePreset(id: string): SizePreset | undefined {
  return SIZE_PRESETS.find(p => p.id === id);
}
