// Renderização (bwip-js) e exportação (PNG/SVG/PDF/impressão) do Laboratório de
// Códigos de Barras. Print/PNG/PDF seguem a mesma técnica do Gerador de Etiquetas
// (html2canvas + jsPDF, CSS @media print injetado) — sem window.open().

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { BarcodeSymbology, symbologyInfo } from './barcodeTypes';

export interface BarcodeRenderOptions {
  /** Não usado para desenhar texto do bwip-js (o número legível é um campo próprio
   *  da etiqueta, uniforme entre 1D/2D) — mantido na assinatura para não recalcular
   *  o SVG à toa quando só esse toggle muda de valor sem afetar o símbolo. */
  showHumanReadable: boolean;
  scale: number; // barcodeScale das preferências — escala do módulo/altura dentro dos limites seguros
  eccLevel?: 'L' | 'M' | 'Q' | 'H';
}

/** Gera o SVG vetorial puro do símbolo (sem texto embutido — a etiqueta desenha seu próprio "número legível"). */
export async function renderBarcodeSVG(
  symbology: BarcodeSymbology,
  value: string,
  opts: BarcodeRenderOptions
): Promise<string> {
  const bwipjs = await import('bwip-js/browser');
  const info = symbologyInfo(symbology);
  const scale = Math.max(0.6, Math.min(1.4, opts.scale || 1));

  const params: Record<string, unknown> = {
    bcid: info.bwipBcid,
    text: value,
    scale: info.kind === '1d' ? Math.max(2, Math.round(2.6 * scale)) : Math.max(3, Math.round(4 * scale)),
    includetext: false,
    paddingwidth: 2,
    paddingheight: 2,
    backgroundcolor: 'FFFFFF',
  };

  if (info.kind === '1d') {
    params.height = 12 * scale;
  }
  if (symbology === 'qrcode' && opts.eccLevel) {
    params.eclevel = opts.eccLevel;
  }

  return bwipjs.toSVG(params as Parameters<typeof bwipjs.toSVG>[0]);
}

const SVG_DIMENSION_RE = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/;

/**
 * Compõe o SVG de exportação do modo unitário: símbolo do bwip-js + (opcional)
 * uma linha de texto com o valor legível abaixo — tudo vetorial, sem rasterizar.
 */
export function composeExportSVG(barcodeSvg: string, value: string, showHumanReadable: boolean): string {
  const match = barcodeSvg.match(SVG_DIMENSION_RE);
  const barcodeW = match ? parseFloat(match[1]) : 300;
  const barcodeH = match ? parseFloat(match[2]) : 150;

  if (!showHumanReadable) return barcodeSvg;

  const textH = 28;
  const totalW = barcodeW;
  const totalH = barcodeH + textH;
  const inner = barcodeSvg.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const escapedValue = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
    `<g>${inner}</g>` +
    `<text x="${totalW / 2}" y="${barcodeH + textH - 8}" text-anchor="middle" font-family="monospace" font-size="20" fill="#000000">${escapedValue}</text>` +
    `</svg>`;
}

function downloadURL(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function safeFileToken(value: string): string {
  return (value || 'codigo').replace(/[^a-z0-9]/gi, '_').slice(0, 40);
}

export function downloadSVG(svgMarkup: string, symbology: BarcodeSymbology, value: string) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  downloadURL(url, `barcode-${symbology}-${safeFileToken(value)}.svg`);
  URL.revokeObjectURL(url);
}

export async function captureElementToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, { scale: 4, useCORS: true, backgroundColor: '#ffffff', allowTaint: false, removeContainer: false });
}

export async function downloadLabelPNG(el: HTMLElement, symbology: BarcodeSymbology, value: string) {
  const canvas = await captureElementToCanvas(el);
  downloadURL(canvas.toDataURL('image/png'), `etiqueta-${symbology}-${safeFileToken(value)}.png`);
}

export async function downloadLabelPDF(
  el: HTMLElement,
  symbology: BarcodeSymbology,
  value: string,
  widthMm: number,
  heightMm: number,
  copies: number
) {
  const canvas = await captureElementToCanvas(el);
  const imgData = canvas.toDataURL('image/png');
  const orientation = widthMm >= heightMm ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [widthMm, heightMm] });
  for (let i = 0; i < copies; i++) {
    if (i > 0) pdf.addPage([widthMm, heightMm], orientation);
    pdf.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm);
  }
  pdf.save(`etiqueta-${symbology}-${safeFileToken(value)}.pdf`);
}

// ── Impressão direta — mesmo mecanismo do Gerador de Etiquetas ──────────────

export function injectBarcodePrintStyle(widthMm: number, heightMm: number) {
  document.getElementById('_barcode_print_style')?.remove();
  const el = document.createElement('style');
  el.id = '_barcode_print_style';
  el.textContent = `
    @media print {
      @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
      body > * { display: none !important; }
      #_barcode_print_area { display: flex !important; }
    }
    #_barcode_print_area {
      display: none;
      position: fixed; left: 0; top: 0; z-index: 99999;
      background: white; flex-direction: column;
    }
  `;
  document.head.appendChild(el);
}

export function removeBarcodePrintStyle() {
  document.getElementById('_barcode_print_style')?.remove();
  document.getElementById('_barcode_print_area')?.remove();
}

/** Monta a área de impressão fora da tela e imprime — o chamador entra com os nós já renderizados. */
export function printBarcodeArea(widthMm: number, heightMm: number, buildArea: (area: HTMLElement) => void, onDone?: () => void) {
  removeBarcodePrintStyle();
  injectBarcodePrintStyle(widthMm, heightMm);
  const area = document.createElement('div');
  area.id = '_barcode_print_area';
  document.body.appendChild(area);
  buildArea(area);

  setTimeout(() => {
    window.print();
    window.addEventListener('afterprint', () => { removeBarcodePrintStyle(); onDone?.(); }, { once: true });
  }, 200);
}

// ── PDF consolidado (lote) ───────────────────────────────────────────────────
// Uma etiqueta por página, no tamanho físico exato — o chamador (BarcodeBatchMode)
// renderiza cada linha fora da tela, captura o canvas e chama addLabelPage por
// cópia, porque manter todas as linhas montadas ao mesmo tempo não escala.

export function createBatchPDFDocument(widthMm: number, heightMm: number): jsPDF {
  const orientation = widthMm >= heightMm ? 'landscape' : 'portrait';
  return new jsPDF({ orientation, unit: 'mm', format: [widthMm, heightMm] });
}

export function addLabelPageToPDF(pdf: jsPDF, canvas: HTMLCanvasElement, widthMm: number, heightMm: number, isFirstPage: boolean) {
  const orientation = widthMm >= heightMm ? 'landscape' : 'portrait';
  if (!isFirstPage) pdf.addPage([widthMm, heightMm], orientation);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, widthMm, heightMm);
}
