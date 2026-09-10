// PDF operacional (spec §10) — mesma técnica de captura já usada em
// src/lib/barcode/barcodeExport.ts (`captureElementToCanvas`, html2canvas a
// scale alto + jsPDF `addImage`) para embutir o desenho 2D, combinada com a
// renderização de texto por cursor de src/lib/spreadsheet-comparator/
// exportUtils.ts (`buildAndDownloadPdfReport`) para as seções textuais.

import type { PalletCalcResult } from './calculatePallet';

export async function captureDiagramToPng(el: HTMLElement): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(el, { scale: 3, useCORS: true, backgroundColor: '#ffffff', allowTaint: false });
  return { dataUrl: canvas.toDataURL('image/png'), widthPx: canvas.width, heightPx: canvas.height };
}

export interface PalletReportOptions {
  result: PalletCalcResult;
  diagramElement: HTMLElement;
  filename: string;
}

const VALIDATION_NOTICE = 'Resultado geométrico estimado. Valide resistência das caixas, amarração e condições reais de transporte.';

export async function downloadPalletReportPdf({ result, diagramElement, filename }: PalletReportOptions): Promise<void> {
  const [{ jsPDF }, diagram] = await Promise.all([import('jspdf'), captureDiagramToPng(diagramElement)]);
  const { box, pallet, recommended } = result;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 15;
  const pageBottom = 280;
  let y = 15;

  const ensureSpace = (needed: number) => { if (y + needed > pageBottom) { doc.addPage(); y = 15; } };
  const line = (text: string, size = 10, bold = false) => {
    ensureSpace(size * 0.5 + 3);
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(text, marginX, y);
    y += size * 0.5 + 3;
  };
  const heading = (text: string) => { y += 2; line(text, 13, true); };

  heading('Relatório de Paletização');
  line(`Gerado por InventoryBlind — Calculadora de Paletização`, 8);
  y += 2;

  heading('Produto');
  line(`SKU: ${box.sku ?? '—'}    Descrição: ${box.description ?? '—'}`);
  line(`Dimensões: ${box.lengthMm.toFixed(0)} × ${box.widthMm.toFixed(0)} × ${box.heightMm.toFixed(0)} mm`);
  line(`Peso unitário: ${box.weightKg.toFixed(2)} kg    Quantidade total: ${box.quantity}`);

  heading('Palete e restrições');
  line(`Palete: ${pallet.name} (${pallet.lengthMm.toFixed(0)} × ${pallet.widthMm.toFixed(0)} mm, altura ${pallet.heightMm.toFixed(0)} mm)`);
  line(`Carga máxima: ${pallet.maxLoadKg.toFixed(0)} kg    Altura total máxima: ${pallet.maxTotalHeightMm.toFixed(0)} mm`);

  heading(`Padrão selecionado: ${recommended.pattern.label}`);
  line(`Caixas por camada: ${recommended.pattern.boxesPerLayer}    Ocupação da base: ${recommended.pattern.occupationPct.toFixed(1)}%`);
  line(`Camadas: ${recommended.layers.layers} (limitado por: ${recommended.layers.limitingFactor})`);
  line(`Caixas por palete: ${recommended.capacityPerPallet}`);

  heading('Quantidade de paletes');
  line(`Paletes completos: ${recommended.palletsNeeded.fullPallets}    Último palete: ${recommended.palletsNeeded.lastPalletQty} caixas    Total: ${recommended.palletsNeeded.totalPallets}`);

  heading('Peso e altura');
  line(`Peso líquido: ${recommended.netKg.toFixed(1)} kg    Tara: ${recommended.tareKg.toFixed(1)} kg    Peso bruto: ${recommended.grossKg.toFixed(1)} kg`);
  line(`Altura da carga: ${recommended.cargoHeightMm.toFixed(0)} mm    Altura total: ${recommended.totalHeightMm.toFixed(0)} mm`);

  heading('Desenho 2D (vista superior)');
  const imgWidthMm = 180;
  const imgHeightMm = imgWidthMm * (diagram.heightPx / diagram.widthPx);
  ensureSpace(imgHeightMm + 4);
  doc.addImage(diagram.dataUrl, 'PNG', marginX, y, imgWidthMm, imgHeightMm);
  y += imgHeightMm + 6;

  if (recommended.alerts.length > 0) {
    heading('Alertas');
    for (const alert of recommended.alerts) {
      line(`${alert.severity === 'error' ? '[Erro]' : '[Aviso]'} ${alert.message}`, 9);
    }
  }

  y += 3;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  ensureSpace(10);
  doc.text(doc.splitTextToSize(VALIDATION_NOTICE, 180), marginX, y);

  doc.save(filename);
}
