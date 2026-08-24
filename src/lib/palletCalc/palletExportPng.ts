import { captureDiagramToPng } from './palletExportPdf';

export async function downloadDiagramPng(el: HTMLElement, filename: string): Promise<void> {
  const { dataUrl } = await captureDiagramToPng(el);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
