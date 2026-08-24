// Leitura de arquivos de imagem no navegador (PNG/JPG/WebP) para a conversão
// Imagens -> PDF. WebP precisa ser convertido para PNG aqui (via canvas) antes
// de chegar em pdfLibOps.ts — pdf-lib só embute PNG/JPEG nativamente.

import { PdfCenterError, PDF_CENTER_ERROR_MESSAGES } from './types';

/** 96 CSS px por polegada é a convenção usada pelos navegadores (e pela
 *  maioria das ferramentas de PDF) quando a imagem não carrega nenhuma
 *  informação própria de DPI — é essa suposição que define o tamanho
 *  "original" de uma imagem sem medida física conhecida. */
const ASSUMED_DPI = 96;
const PT_PER_PX = 72 / ASSUMED_DPI;

export interface LoadedImageFile {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  widthPt: number;
  heightPt: number;
}

function loadHtmlImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('render-failed'));
    img.src = objectUrl;
  });
}

async function canvasEncode(img: HTMLImageElement, mime: 'image/png' | 'image/jpeg'): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('render-failed');
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, 0.92));
  if (!blob) throw new Error('render-failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Carrega PNG/JPG direto; converte WebP (e qualquer outro tipo que o
 *  navegador saiba decodificar) para PNG via canvas. */
export async function loadImageFile(file: File): Promise<LoadedImageFile> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl).catch(() => {
      throw new PdfCenterError('unsupported-format', PDF_CENTER_ERROR_MESSAGES['unsupported-format'](file.name), file.name);
    });

    const widthPt = img.naturalWidth * PT_PER_PX;
    const heightPt = img.naturalHeight * PT_PER_PX;

    if (file.type === 'image/png' || file.type === 'image/jpeg') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { bytes, mime: file.type, widthPt, heightPt };
    }

    const bytes = await canvasEncode(img, 'image/png').catch(() => {
      throw new PdfCenterError('render-failed', PDF_CENTER_ERROR_MESSAGES['render-failed'](file.name), file.name);
    });
    return { bytes, mime: 'image/png', widthPt, heightPt };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
