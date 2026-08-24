// Renderização de páginas de PDF no navegador via pdfjs-dist + canvas —
// miniaturas do editor, exportação PDF->imagem e rasterização para a
// otimização "modo 2". Tudo aqui depende de DOM (canvas), por isso fica
// separado de pdfLibOps.ts (que roda em Node também, sem canvas nenhum).

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfCenterError, PDF_CENTER_ERROR_MESSAGES } from './types';

async function renderPageToCanvas(pdfjsDoc: PDFDocumentProxy, pageNumber: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await pdfjsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PdfCenterError('render-failed', PDF_CENTER_ERROR_MESSAGES['render-failed']());

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Miniatura de página, encaixada em `maxDimPx` (lado maior). */
export async function renderPageThumbnail(pdfjsDoc: PDFDocumentProxy, pageNumber: number, maxDimPx: number): Promise<string> {
  const page = await pdfjsDoc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = maxDimPx / Math.max(base.width, base.height);

  const canvas = await renderPageToCanvas(pdfjsDoc, pageNumber, scale);
  return canvas.toDataURL('image/png');
}

export type PdfToImageFormat = 'png' | 'jpeg';

export interface ExportPageImageOptions {
  format: PdfToImageFormat;
  dpi: number;
  jpegQuality: number;
  /** PNG suporta transparência; forçar fundo branco evita "manchas" pretas
   *  quando o arquivo é depois aberto num visualizador sem transparência. */
  whiteBackground: boolean;
}

export interface ExportedPageImage {
  pageNumber: number;
  blob: Blob;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('render-failed'))), mime, quality);
  });
}

export async function exportPagesToImages(pdfjsDoc: PDFDocumentProxy, pageNumbers: number[], options: ExportPageImageOptions): Promise<ExportedPageImage[]> {
  const scale = options.dpi / 72;
  const results: ExportedPageImage[] = [];

  for (const pageNumber of pageNumbers) {
    const canvas = await renderPageToCanvas(pdfjsDoc, pageNumber, scale);

    if (options.whiteBackground || options.format === 'jpeg') {
      const ctx = canvas.getContext('2d')!;
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, options.format === 'jpeg' ? options.jpegQuality : undefined);
    results.push({ pageNumber, blob });
  }

  return results;
}

export type RasterizeQuality = 'alta' | 'media' | 'compacta';

export const RASTERIZE_QUALITY_PRESETS: Record<RasterizeQuality, { dpi: number; jpegQuality: number }> = {
  alta: { dpi: 200, jpegQuality: 0.92 },
  media: { dpi: 150, jpegQuality: 0.85 },
  compacta: { dpi: 96, jpegQuality: 0.7 },
};

export interface RasterizedPage {
  bytes: Uint8Array;
  mime: 'image/jpeg';
  widthPt: number;
  heightPt: number;
}

/** Rasteriza todas as páginas mantendo o tamanho FÍSICO original de cada uma
 *  (spec §10, modo 2) — quem monta o PDF final por cima (pdfLibOps
 *  `buildPdfFromImages` com `fitToPage:false`) usa `widthPt`/`heightPt` para
 *  criar uma página do mesmo tamanho, então a impressão não muda de escala. */
export async function rasterizePdfPages(pdfjsDoc: PDFDocumentProxy, quality: RasterizeQuality): Promise<RasterizedPage[]> {
  const preset = RASTERIZE_QUALITY_PRESETS[quality];
  const pages: RasterizedPage[] = [];

  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const nativeViewport = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(pdfjsDoc, i, preset.dpi / 72);

    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, 'image/jpeg', preset.jpegQuality);
    pages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', widthPt: nativeViewport.width, heightPt: nativeViewport.height });
  }

  return pages;
}
