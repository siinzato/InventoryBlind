import { describe, expect, it } from 'vitest';
import {
  addPagesFromSource, deletePages, duplicatePages, invertOrder, movePages,
  moveToEnd, moveToStart, resolvePageRefs, rotatePages, selectedIds, setSelection,
} from '../pageModel';
import type { PdfCenterSource } from '../types';

function makeSource(id: string, pageCount: number): PdfCenterSource {
  return { id, name: `${id}.pdf`, kind: 'pdf', mimeType: 'application/pdf', sizeBytes: 1000, pageCount, file: new File([], `${id}.pdf`) };
}

describe('pageModel', () => {
  it('adiciona páginas de uma nova fonte com ids únicos', () => {
    const pages = addPagesFromSource([], makeSource('a', 3));
    expect(pages).toHaveLength(3);
    expect(pages.map(p => p.sourcePageIndex)).toEqual([0, 1, 2]);
    expect(new Set(pages.map(p => p.id)).size).toBe(3);
  });

  it('insere páginas no meio (inserir PDF entre páginas)', () => {
    const base = addPagesFromSource([], makeSource('a', 2));
    const withInsert = addPagesFromSource(base, makeSource('b', 1), 1);
    expect(withInsert.map(p => p.sourceId)).toEqual(['a', 'b', 'a']);
  });

  it('rotaciona só as páginas selecionadas, somando ao módulo 360', () => {
    const pages = addPagesFromSource([], makeSource('a', 2));
    const rotated = rotatePages(pages, [pages[0].id], 90);
    expect(rotated[0].rotation).toBe(90);
    expect(rotated[1].rotation).toBe(0);
    const rotatedAgain = rotatePages(rotated, [pages[0].id], 270);
    expect(rotatedAgain[0].rotation).toBe(0);
  });

  it('duplica páginas logo após o original', () => {
    const pages = addPagesFromSource([], makeSource('a', 2));
    const dup = duplicatePages(pages, [pages[0].id]);
    expect(dup).toHaveLength(3);
    expect(dup[0].sourcePageIndex).toBe(0);
    expect(dup[1].sourcePageIndex).toBe(0);
    expect(dup[1].id).not.toBe(pages[0].id);
  });

  it('exclui páginas', () => {
    const pages = addPagesFromSource([], makeSource('a', 3));
    const remaining = deletePages(pages, [pages[1].id]);
    expect(remaining.map(p => p.sourcePageIndex)).toEqual([0, 2]);
  });

  it('inverte a ordem de todas as páginas', () => {
    const pages = addPagesFromSource([], makeSource('a', 3));
    expect(invertOrder(pages).map(p => p.sourcePageIndex)).toEqual([2, 1, 0]);
  });

  it('move para início e para fim', () => {
    const pages = addPagesFromSource([], makeSource('a', 3));
    const lastId = pages[2].id;
    expect(moveToStart(pages, [lastId]).map(p => p.sourcePageIndex)).toEqual([2, 0, 1]);
    expect(moveToEnd(pages, [pages[0].id]).map(p => p.sourcePageIndex)).toEqual([1, 2, 0]);
  });

  it('movePages reordena por arrastar-e-soltar preservando os demais', () => {
    const pages = addPagesFromSource([], makeSource('a', 4)); // idx 0,1,2,3
    const moved = movePages(pages, [pages[0].id], 3);
    expect(moved.map(p => p.sourcePageIndex)).toEqual([1, 2, 0, 3]);
  });

  it('resolvePageRefs converte para o formato que pdfLibOps espera', () => {
    const pages = addPagesFromSource([], makeSource('a', 2));
    const rotated = rotatePages(pages, [pages[1].id], 90);
    expect(resolvePageRefs(rotated)).toEqual([
      { sourceId: 'a', sourcePageIndex: 0, rotationCw: 0 },
      { sourceId: 'a', sourcePageIndex: 1, rotationCw: 90 },
    ]);
  });

  it('seleção múltipla via setSelection/selectedIds', () => {
    const pages = addPagesFromSource([], makeSource('a', 3));
    const selected = setSelection(pages, [pages[0].id, pages[2].id], true);
    expect(selectedIds(selected)).toEqual([pages[0].id, pages[2].id]);
  });
});
