// Carregamento de arquivo no navegador — só aqui pdfjs-dist é importado (e só
// dinamicamente: ver `getPdfjs()`), pra não engordar o bundle principal com
// os ~2MB da lib antes de o usuário realmente soltar um PDF. `pdf-lib` (usado
// pela estrutura em pdfLibOps.ts) é leve e não precisa desse cuidado.

import { classifyPdfError } from './pdfErrorClassification';
import { PdfCenterError, PDF_CENTER_ERROR_MESSAGES, type PdfCenterErrorReason } from './types';

let pdfjsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null;

export async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = (async () => {
      const [pdfjs, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then(m => m.default),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsModulePromise;
}

export interface LoadedPdfPage {
  widthPt: number;
  heightPt: number;
  /** Rotação nativa já lida do PDF (graus horários, convenção `/Rotate`). */
  rotationCw: number;
}

export interface LoadedPdf {
  bytes: Uint8Array;
  pdfjsDoc: import('pdfjs-dist').PDFDocumentProxy;
  numPages: number;
  pages: LoadedPdfPage[];
  /** `PDFDocumentProxy` não expõe `destroy()` no tipo público — quem libera
   *  o worker é a `PDFDocumentLoadingTask` que o gerou (`getDocument(...)`,
   *  antes do `.promise`). Guardamos essa referência aqui. */
  destroy: () => Promise<void>;
}

function throwClassified(reason: PdfCenterErrorReason, fileName: string): never {
  throw new PdfCenterError(reason, PDF_CENTER_ERROR_MESSAGES[reason](fileName), fileName);
}

export async function loadPdfFile(file: File): Promise<LoadedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throwClassified('empty-document', file.name);

  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  let pdfjsDoc: import('pdfjs-dist').PDFDocumentProxy;
  try {
    pdfjsDoc = await loadingTask.promise;
  } catch (err) {
    throwClassified(classifyPdfError(err), file.name);
  }

  if (pdfjsDoc.numPages === 0) throwClassified('empty-document', file.name);

  const pages: LoadedPdfPage[] = [];
  for (let i = 1; i <= pdfjsDoc.numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const rotationCw = ((page.rotate % 360) + 360) % 360;
    const isSideways = rotationCw === 90 || rotationCw === 270;
    pages.push({
      widthPt: isSideways ? page.view[3] - page.view[1] : page.view[2] - page.view[0],
      heightPt: isSideways ? page.view[2] - page.view[0] : page.view[3] - page.view[1],
      rotationCw,
    });
  }

  return { bytes, pdfjsDoc, numPages: pdfjsDoc.numPages, pages, destroy: () => loadingTask.destroy() };
}
