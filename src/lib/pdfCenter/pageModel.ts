// Operações puras sobre a lista de páginas do editor visual — nenhuma delas
// toca em File/canvas/PDF real, só no array `PdfCenterPage[]`. É essa
// separação que torna arrastar/rotacionar/duplicar/excluir testável sem
// navegador (spec §14).

import type { PdfCenterPage, PdfCenterSource, Rotation } from './types';

let pageIdCounter = 0;
export function nextPageId(): string {
  pageIdCounter += 1;
  return `page-${pageIdCounter}-${Date.now().toString(36)}`;
}

export function addPagesFromSource(pages: PdfCenterPage[], source: PdfCenterSource, atIndex?: number): PdfCenterPage[] {
  const newPages: PdfCenterPage[] = Array.from({ length: source.pageCount }, (_, i) => ({
    id: nextPageId(),
    sourceId: source.id,
    sourcePageIndex: i,
    rotation: 0,
    selected: false,
  }));

  const insertAt = atIndex == null ? pages.length : Math.max(0, Math.min(atIndex, pages.length));
  return [...pages.slice(0, insertAt), ...newPages, ...pages.slice(insertAt)];
}

export function removeSource(state: { sources: PdfCenterSource[]; pages: PdfCenterPage[] }, sourceId: string) {
  return {
    sources: state.sources.filter(s => s.id !== sourceId),
    pages: state.pages.filter(p => p.sourceId !== sourceId),
  };
}

/** Move um subconjunto de páginas (por id, na ordem em que já aparecem) para
 *  logo antes de `targetIndex` (índice no array ORIGINAL, antes de remover as
 *  páginas movidas) — comportamento de arrastar-e-soltar multi-seleção. */
export function movePages(pages: PdfCenterPage[], ids: string[], targetIndex: number): PdfCenterPage[] {
  const idSet = new Set(ids);
  const moving = pages.filter(p => idSet.has(p.id));
  if (moving.length === 0) return pages;

  const remaining = pages.filter(p => !idSet.has(p.id));
  const removedBeforeTarget = pages.slice(0, targetIndex).filter(p => idSet.has(p.id)).length;
  const adjustedTarget = Math.max(0, Math.min(targetIndex - removedBeforeTarget, remaining.length));

  return [...remaining.slice(0, adjustedTarget), ...moving, ...remaining.slice(adjustedTarget)];
}

function rotateOne(rotation: Rotation, deltaDeg: 90 | 180 | 270): Rotation {
  return (((rotation + deltaDeg) % 360) as Rotation);
}

export function rotatePages(pages: PdfCenterPage[], ids: string[], deltaDeg: 90 | 180 | 270): PdfCenterPage[] {
  const idSet = new Set(ids);
  return pages.map(p => (idSet.has(p.id) ? { ...p, rotation: rotateOne(p.rotation, deltaDeg) } : p));
}

export function deletePages(pages: PdfCenterPage[], ids: string[]): PdfCenterPage[] {
  const idSet = new Set(ids);
  return pages.filter(p => !idSet.has(p.id));
}

export function duplicatePages(pages: PdfCenterPage[], ids: string[]): PdfCenterPage[] {
  const idSet = new Set(ids);
  const result: PdfCenterPage[] = [];
  for (const page of pages) {
    result.push(page);
    if (idSet.has(page.id)) {
      result.push({ ...page, id: nextPageId(), selected: false });
    }
  }
  return result;
}

export function invertOrder(pages: PdfCenterPage[]): PdfCenterPage[] {
  return [...pages].reverse();
}

export function moveToStart(pages: PdfCenterPage[], ids: string[]): PdfCenterPage[] {
  const idSet = new Set(ids);
  const moving = pages.filter(p => idSet.has(p.id));
  const rest = pages.filter(p => !idSet.has(p.id));
  return [...moving, ...rest];
}

export function moveToEnd(pages: PdfCenterPage[], ids: string[]): PdfCenterPage[] {
  const idSet = new Set(ids);
  const moving = pages.filter(p => idSet.has(p.id));
  const rest = pages.filter(p => !idSet.has(p.id));
  return [...rest, ...moving];
}

export function toggleSelect(pages: PdfCenterPage[], id: string): PdfCenterPage[] {
  return pages.map(p => (p.id === id ? { ...p, selected: !p.selected } : p));
}

export function setSelection(pages: PdfCenterPage[], ids: string[], selected: boolean): PdfCenterPage[] {
  const idSet = new Set(ids);
  return pages.map(p => (idSet.has(p.id) ? { ...p, selected } : p));
}

export function selectAll(pages: PdfCenterPage[]): PdfCenterPage[] {
  return pages.map(p => ({ ...p, selected: true }));
}

export function clearSelection(pages: PdfCenterPage[]): PdfCenterPage[] {
  return pages.map(p => ({ ...p, selected: false }));
}

export function selectedIds(pages: PdfCenterPage[]): string[] {
  return pages.filter(p => p.selected).map(p => p.id);
}

/** Ponte para pdfLibOps.ts: cada `PdfCenterPage` do editor já carrega tudo
 *  que a camada de PDF precisa (fonte + índice + rotação extra). */
export function resolvePageRefs(pages: PdfCenterPage[]): Array<{ sourceId: string; sourcePageIndex: number; rotationCw: Rotation }> {
  return pages.map(p => ({ sourceId: p.sourceId, sourcePageIndex: p.sourcePageIndex, rotationCw: p.rotation }));
}
