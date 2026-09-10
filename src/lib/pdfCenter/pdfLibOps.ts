// Operações estruturais reais de PDF (união, divisão, intercalação, preparo
// térmico, montagem de folhas, imagens->PDF, otimização conservadora) via
// pdf-lib. Só pdf-lib — nada de pdfjs-dist/canvas aqui, de propósito: isso é
// o que permite testar união/divisão/rotação/recorte com PDFs de verdade em
// Node puro (pdf-lib não depende de DOM), sem precisar de navegador.
//
// A rotação de páginas de origem é sempre lida do PDF na hora (nunca
// duplicada em `PdfCenterPage`) — `nativeRotationCw` abaixo vem de
// `page.getRotation().angle`, que já é a convenção horária do `/Rotate`.

import { PDFDocument, type PDFPage, degrees, rgb } from 'pdf-lib';
import { computeEmbeddedDrawTransform, effectiveSize, normalizeAngle } from './embeddedDrawTransform';
import { computeAlignedPosition, computeFitPlacement, type AlignX, type AlignY } from './fitPlacement';
import { computeNupGrid } from './nupLayout';
import { computeThermalLayout, type ThermalLayoutInput } from './thermalLayout';

/** `PDFDocument.embedPage` só registra a página para embutir depois — o
 *  embed de verdade só roda dentro de `save()` (preguiçoso), então um
 *  try/catch em volta de `embedPage`/`.embed()` não protege nada: a página
 *  fica registrada mesmo se a primeira tentativa falhar, e o `save()` tenta
 *  de novo e derruba o documento INTEIRO (todas as folhas, não só a página
 *  problemática). Por isso a checagem tem que vir ANTES de chamar
 *  `embedPage`, nunca depois. */
function hasEmbeddableContent(page: PDFPage): boolean {
  return page.node.Contents() != null;
}
import type { EdgeInsets, FitMode, Rotation } from './types';

export interface SourceBytes {
  sourceId: string;
  bytes: Uint8Array;
}

export interface ResolvedPageRef {
  sourceId: string;
  sourcePageIndex: number;
  /** Rotação extra aplicada no editor (graus horários), somada à rotação
   *  nativa da página na hora de processar. */
  rotationCw: Rotation;
}

class SourceDocCache {
  private docs = new Map<string, PDFDocument>();

  constructor(private readonly sources: SourceBytes[]) {}

  async get(sourceId: string): Promise<PDFDocument> {
    const cached = this.docs.get(sourceId);
    if (cached) return cached;

    const entry = this.sources.find(s => s.sourceId === sourceId);
    if (!entry) throw new Error(`Fonte "${sourceId}" não foi carregada.`);

    const doc = await PDFDocument.load(entry.bytes, { ignoreEncryption: false });
    this.docs.set(sourceId, doc);
    return doc;
  }
}

/** Primitivo único por trás de união, divisão/extração e intercalação: as
 *  três são, no fundo, "escolher um conjunto ordenado de páginas de uma ou
 *  mais fontes e copiar para um documento novo". Preserva tamanho e conteúdo
 *  originais — nunca impõe A4. */
export async function buildPdfFromPageRefs(sources: SourceBytes[], pageRefs: ResolvedPageRef[]): Promise<Uint8Array> {
  const cache = new SourceDocCache(sources);
  const output = await PDFDocument.create();

  for (const ref of pageRefs) {
    const srcDoc = await cache.get(ref.sourceId);
    const [copied] = await output.copyPages(srcDoc, [ref.sourcePageIndex]);
    if (ref.rotationCw !== 0) {
      const current = normalizeAngle(copied.getRotation().angle);
      copied.setRotation(degrees(normalizeAngle(current + ref.rotationCw)));
    }
    output.addPage(copied);
  }

  return output.save({ useObjectStreams: true });
}

export interface ThermalApplyConfig {
  targetWidthPt: number;
  targetHeightPt: number;
  fitMode: FitMode;
  orientation: ThermalLayoutInput['orientation'];
  alignX: AlignX;
  alignY: AlignY;
  marginPt: EdgeInsets;
  scale: number;
  offsetXPt: number;
  offsetYPt: number;
  backgroundWhite: boolean;
}

export interface ThermalApplyResult {
  bytes: Uint8Array;
  warnings: string[];
}

/** Preparo térmico (spec §6): cria uma página nova no tamanho alvo por
 *  página de entrada e desenha o conteúdo original encaixado (contain/fill/
 *  original), respeitando a rotação nativa + a rotação extra do editor. */
export async function buildThermalPdf(sources: SourceBytes[], pageRefs: ResolvedPageRef[], config: ThermalApplyConfig): Promise<ThermalApplyResult> {
  const cache = new SourceDocCache(sources);
  const output = await PDFDocument.create();
  const warnings: string[] = [];

  for (const ref of pageRefs) {
    const srcDoc = await cache.get(ref.sourceId);
    const srcPage = srcDoc.getPage(ref.sourcePageIndex);
    const nativeRotationCw = normalizeAngle(srcPage.getRotation().angle);
    const raw = srcPage.getSize();
    const eff = effectiveSize(raw.width, raw.height, nativeRotationCw);

    const layout = computeThermalLayout({
      sourceWidthPt: eff.width,
      sourceHeightPt: eff.height,
      targetWidthPt: config.targetWidthPt,
      targetHeightPt: config.targetHeightPt,
      fitMode: config.fitMode,
      orientation: config.orientation,
      alignX: config.alignX,
      alignY: config.alignY,
      marginPt: config.marginPt,
      scale: config.scale,
      offsetXPt: config.offsetXPt,
      offsetYPt: config.offsetYPt,
      rotationDeg: ref.rotationCw,
    });
    warnings.push(...layout.warnings);

    const newPage = output.addPage([layout.pageWidthPt, layout.pageHeightPt]);
    if (config.backgroundWhite) {
      newPage.drawRectangle({ x: 0, y: 0, width: layout.pageWidthPt, height: layout.pageHeightPt, color: rgb(1, 1, 1) });
    }

    if (layout.placedWidthPt > 0 && layout.placedHeightPt > 0) {
      if (!hasEmbeddableContent(srcPage)) {
        // Página de origem sem conteúdo próprio (em branco) — a folha de
        // saída fica só com o fundo (se pedido) em vez de travar o lote.
        warnings.push('Uma página de origem está em branco e não pôde ser desenhada.');
      } else {
        const embedded = await output.embedPage(srcPage);
        const transform = computeEmbeddedDrawTransform(nativeRotationCw, ref.rotationCw, layout.x, layout.y, layout.placedWidthPt, layout.placedHeightPt);
        newPage.drawPage(embedded, {
          x: transform.x, y: transform.y,
          width: transform.drawWidth, height: transform.drawHeight,
          rotate: degrees(transform.rotateDegCcw),
        });
      }
    }
  }

  return { bytes: await output.save({ useObjectStreams: true }), warnings };
}

export interface NupApplyConfig {
  pageWidthPt: number;
  pageHeightPt: number;
  rows: number;
  cols: number;
  marginPt: EdgeInsets;
  spacingPt: { row: number; col: number };
  fillOrder: 'linhas' | 'colunas';
  cellFit: FitMode;
  showCutMarks: boolean;
  showBorder: boolean;
}

export interface NupApplyResult {
  bytes: Uint8Array;
  warnings: string[];
}

const CUT_MARK_LENGTH_PT = 8;

function drawCutMarksForCell(page: PDFPage, x: number, y: number, width: number, height: number) {
  const corners: Array<[number, number, number, number][]> = [
    [[x, y, x - CUT_MARK_LENGTH_PT, y], [x, y, x, y - CUT_MARK_LENGTH_PT]],
    [[x + width, y, x + width + CUT_MARK_LENGTH_PT, y], [x + width, y, x + width, y - CUT_MARK_LENGTH_PT]],
    [[x, y + height, x - CUT_MARK_LENGTH_PT, y + height], [x, y + height, x, y + height + CUT_MARK_LENGTH_PT]],
    [[x + width, y + height, x + width + CUT_MARK_LENGTH_PT, y + height], [x + width, y + height, x + width, y + height + CUT_MARK_LENGTH_PT]],
  ];
  for (const lines of corners) {
    for (const [x1, y1, x2, y2] of lines) {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
    }
  }
}

/** Montagem de folhas / N-up (spec §7): agrupa `pageRefs` em blocos de
 *  `rows*cols` e desenha cada bloco numa folha do tamanho alvo. Para repetir
 *  uma página (ou repetição individual por página), o chamador já entrega
 *  `pageRefs` com as repetições expandidas — esta função só sabe montar a
 *  grade com o que recebe, sem noção de "modos". */
export async function buildNupPdf(sources: SourceBytes[], pageRefs: ResolvedPageRef[], config: NupApplyConfig): Promise<NupApplyResult> {
  const cache = new SourceDocCache(sources);
  const output = await PDFDocument.create();
  const warnings: string[] = [];

  const grid = computeNupGrid({
    pageWidthPt: config.pageWidthPt, pageHeightPt: config.pageHeightPt,
    rows: config.rows, cols: config.cols, marginPt: config.marginPt,
    spacingPt: config.spacingPt, fillOrder: config.fillOrder,
  });
  warnings.push(...grid.warnings);
  if (!grid.fits) return { bytes: new Uint8Array(0), warnings };

  const perSheet = config.rows * config.cols;
  for (let sheetStart = 0; sheetStart < pageRefs.length; sheetStart += perSheet) {
    const sheetRefs = pageRefs.slice(sheetStart, sheetStart + perSheet);
    const newPage = output.addPage([config.pageWidthPt, config.pageHeightPt]);
    if (config.showBorder) {
      newPage.drawRectangle({
        x: config.marginPt.left, y: config.marginPt.bottom,
        width: config.pageWidthPt - config.marginPt.left - config.marginPt.right,
        height: config.pageHeightPt - config.marginPt.top - config.marginPt.bottom,
        borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.75,
      });
    }

    for (let i = 0; i < sheetRefs.length; i++) {
      const ref = sheetRefs[i];
      const cell = grid.cells[i];
      const srcDoc = await cache.get(ref.sourceId);
      const srcPage = srcDoc.getPage(ref.sourcePageIndex);
      const nativeRotationCw = normalizeAngle(srcPage.getRotation().angle);
      const raw = srcPage.getSize();
      const eff = effectiveSize(raw.width, raw.height, nativeRotationCw);

      const fit = computeFitPlacement(eff.width, eff.height, cell.width, cell.height, config.cellFit);
      const aligned = computeAlignedPosition(fit.placedWidth, fit.placedHeight, cell.width, cell.height, 'center', 'center');
      const targetX = cell.x + aligned.x;
      const targetY = cell.y + aligned.y;

      if (fit.placedWidth > 0 && fit.placedHeight > 0) {
        if (!hasEmbeddableContent(srcPage)) {
          warnings.push('Uma página de origem está em branco e não pôde ser desenhada.');
        } else {
          const embedded = await output.embedPage(srcPage);
          const transform = computeEmbeddedDrawTransform(nativeRotationCw, ref.rotationCw, targetX, targetY, fit.placedWidth, fit.placedHeight);
          newPage.drawPage(embedded, {
            x: transform.x, y: transform.y,
            width: transform.drawWidth, height: transform.drawHeight,
            rotate: degrees(transform.rotateDegCcw),
          });
        }
      }
      if (config.showCutMarks) drawCutMarksForCell(newPage, cell.x, cell.y, cell.width, cell.height);
    }
  }

  return { bytes: await output.save({ useObjectStreams: true }), warnings };
}

export interface ImageToEmbed {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  /** Tamanho natural da imagem, em pt (já convertido — normalmente a 96dpi
   *  padrão do navegador, mas o chamador decide). */
  widthPt: number;
  heightPt: number;
}

export interface ImagesToPdfConfig {
  onePerPage: boolean;
  gridRows: number;
  gridCols: number;
  pageWidthPt: number;
  pageHeightPt: number;
  marginPt: EdgeInsets;
  fitMode: FitMode;
  /** Quando falso, cada imagem forma uma página do seu próprio tamanho
   *  natural (ignora pageWidthPt/pageHeightPt) — "tamanho original". */
  fitToPage: boolean;
}

/** Imagens -> PDF (spec §8). PNG/JPEG entram direto; WebP precisa ser
 *  convertido para PNG ANTES de chegar aqui (só o navegador decodifica WebP —
 *  ver pdfRenderOps.ts). */
export async function buildPdfFromImages(images: ImageToEmbed[], config: ImagesToPdfConfig): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const embedded = await Promise.all(images.map(img => (img.mime === 'image/png' ? output.embedPng(img.bytes) : output.embedJpg(img.bytes))));

  if (!config.fitToPage) {
    for (let i = 0; i < embedded.length; i++) {
      const img = embedded[i];
      const src = images[i];
      const page = output.addPage([src.widthPt, src.heightPt]);
      page.drawImage(img, { x: 0, y: 0, width: src.widthPt, height: src.heightPt });
    }
    return output.save({ useObjectStreams: true });
  }

  const perPage = config.onePerPage ? 1 : Math.max(1, config.gridRows * config.gridCols);
  for (let start = 0; start < embedded.length; start += perPage) {
    const page = output.addPage([config.pageWidthPt, config.pageHeightPt]);
    const chunk = embedded.slice(start, start + perPage);
    const srcChunk = images.slice(start, start + perPage);

    if (perPage === 1) {
      const availW = config.pageWidthPt - config.marginPt.left - config.marginPt.right;
      const availH = config.pageHeightPt - config.marginPt.top - config.marginPt.bottom;
      const fit = computeFitPlacement(srcChunk[0].widthPt, srcChunk[0].heightPt, availW, availH, config.fitMode);
      const aligned = computeAlignedPosition(fit.placedWidth, fit.placedHeight, availW, availH, 'center', 'center');
      page.drawImage(chunk[0], { x: config.marginPt.left + aligned.x, y: config.marginPt.bottom + aligned.y, width: fit.placedWidth, height: fit.placedHeight });
      continue;
    }

    const grid = computeNupGrid({
      pageWidthPt: config.pageWidthPt, pageHeightPt: config.pageHeightPt,
      rows: config.gridRows, cols: config.gridCols, marginPt: config.marginPt,
      spacingPt: { row: 0, col: 0 }, fillOrder: 'linhas',
    });
    for (let i = 0; i < chunk.length && i < grid.cells.length; i++) {
      const cell = grid.cells[i];
      const fit = computeFitPlacement(srcChunk[i].widthPt, srcChunk[i].heightPt, cell.width, cell.height, config.fitMode);
      const aligned = computeAlignedPosition(fit.placedWidth, fit.placedHeight, cell.width, cell.height, 'center', 'center');
      page.drawImage(chunk[i], { x: cell.x + aligned.x, y: cell.y + aligned.y, width: fit.placedWidth, height: fit.placedHeight });
    }
  }

  return output.save({ useObjectStreams: true });
}

export interface OptimizeConservativeResult {
  bytes: Uint8Array;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
}

/** Otimização conservadora (spec §10, modo 1): não perde texto/vetores. Só
 *  reescreve com object streams (o próprio pdf-lib comprime a estrutura) e,
 *  opcionalmente, limpa metadados. NUNCA promete redução — quem chama compara
 *  `originalSizeBytes` com `optimizedSizeBytes` e decide o que mostrar. */
export async function optimizeConservative(bytes: Uint8Array, removeMetadata: boolean): Promise<OptimizeConservativeResult> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  if (removeMetadata) {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('');
    doc.setCreator('');
  }
  const optimized = await doc.save({ useObjectStreams: true });
  return { bytes: optimized, originalSizeBytes: bytes.byteLength, optimizedSizeBytes: optimized.byteLength };
}

export async function getPdfLibPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}
