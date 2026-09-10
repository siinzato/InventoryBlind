// Exportação do fechamento — PDF (jsPDF, já no projeto) e Word (.doc via HTML + Blob,
// sem nova dependência). As duas leem exclusivamente o ClosingDocument canônico, então
// não há como divergirem entre si nem do que está na tela. Exportar é leitura: nada
// aqui grava no banco nem toca o relatório.

import { downloadBlob } from '../pdfCenter/downloadFile';
import {
  CLOSING_METRIC_ROWS,
  formatClosingDateTime,
  type ClosingDocument,
} from './closingDocumentModel';

const DOC_TITLE = 'Relatório de Fechamento de Inventário';

/** Nome de arquivo estável a partir da marca e da data real do fechamento. */
export function closingExportFilename(doc: ClosingDocument, extension: 'pdf' | 'doc'): string {
  const slug = doc.brandName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'linha';
  const day = doc.closedAt.slice(0, 10);
  return `fechamento-${slug}-${day}.${extension}`;
}

/** Converte a URL assinada do logo em dataURL para embutir no PDF. Best-effort: qualquer
 *  falha devolve null e a exportação segue sem logo. */
async function logoAsDataUrl(url: string | null | undefined): Promise<{ dataUrl: string; format: string } | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const format = blob.type === 'image/png' ? 'PNG' : blob.type === 'image/webp' ? 'WEBP' : 'JPEG';
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { dataUrl, format };
  } catch {
    return null;
  }
}

export async function downloadClosingReportPdf(doc: ClosingDocument): Promise<void> {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), logoAsDataUrl(doc.brandLogo)]);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const marginX = 18;
  const pageBottom = 280;
  let y = 18;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageBottom) { pdf.addPage(); y = 18; }
  };
  const line = (text: string, size = 10, bold = false, indent = 0) => {
    ensureSpace(size * 0.5 + 3);
    pdf.setFontSize(size);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    for (const wrapped of pdf.splitTextToSize(text, 174 - indent) as string[]) {
      ensureSpace(size * 0.5 + 3);
      pdf.text(wrapped, marginX + indent, y);
      y += size * 0.5 + 3;
    }
  };
  const heading = (text: string) => { y += 3; line(text, 12, true); y += 1; };

  line('InventoryBlind', 15, true);
  line(DOC_TITLE, 12, true);
  y += 2;

  if (logo) {
    try {
      pdf.addImage(logo.dataUrl, logo.format, marginX, y, 18, 18);
      pdf.setFontSize(13);
      pdf.setFont('helvetica', 'bold');
      pdf.text(doc.brandName, marginX + 22, y + 8);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text(formatClosingDateTime(doc.closedAt), marginX + 22, y + 14);
      y += 24;
    } catch {
      // Logo ilegível para o jsPDF: segue em texto, sem interromper a exportação.
      line(`Linha/Marca: ${doc.brandName}`, 11, true);
      line(`Fechamento: ${formatClosingDateTime(doc.closedAt)}`);
    }
  } else {
    line(`Linha/Marca: ${doc.brandName}`, 11, true);
    line(`Fechamento: ${formatClosingDateTime(doc.closedAt)}`);
  }

  heading('Indicadores do fechamento');
  for (const row of CLOSING_METRIC_ROWS) {
    line(`${row.label}: ${row.value(doc.metrics)}`);
  }

  heading('Categorias identificadas');
  if (doc.categories.length === 0) {
    line('Nenhuma categoria identificada neste fechamento.');
  } else {
    for (const category of doc.categories) {
      line(`${category.name} — ${category.count} ${category.count === 1 ? 'registro' : 'registros'}`, 10, true);
      for (const observation of category.observations) {
        line(`• ${observation}`, 9, false, 4);
      }
    }
  }

  heading('Observações não classificadas');
  if (doc.unclassifiedObservations.length === 0) {
    line('Nenhuma observação não classificada.');
  } else {
    for (const observation of doc.unclassifiedObservations) {
      line(`• ${observation}`, 9, false, 4);
    }
  }

  pdf.save(closingExportFilename(doc, 'pdf'));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML estruturado que o Word abre como documento — mesmo conteúdo do PDF. */
export function buildClosingReportWordHtml(doc: ClosingDocument): string {
  const metrics = CLOSING_METRIC_ROWS
    .map(row => `<tr><td class="k">${escapeHtml(row.label)}</td><td class="v">${escapeHtml(row.value(doc.metrics))}</td></tr>`)
    .join('');

  const categories = doc.categories.length === 0
    ? '<p>Nenhuma categoria identificada neste fechamento.</p>'
    : doc.categories.map(category => `
        <p class="cat"><strong>${escapeHtml(category.name)}</strong> — ${category.count} ${category.count === 1 ? 'registro' : 'registros'}</p>
        ${category.observations.length > 0 ? `<ul>${category.observations.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>` : ''}
      `).join('');

  const unclassified = doc.unclassifiedObservations.length === 0
    ? '<p>Nenhuma observação não classificada.</p>'
    : `<ul>${doc.unclassifiedObservations.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`;

  const logo = doc.brandLogo
    ? `<img src="${escapeHtml(doc.brandLogo)}" alt="" width="56" height="56" style="object-fit:contain;vertical-align:middle;margin-right:10px" />`
    : '';

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8" /><title>${escapeHtml(DOC_TITLE)} — ${escapeHtml(doc.brandName)}</title>
<style>
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1c1f23; }
h1 { font-size: 16pt; margin: 0 0 2pt; }
h2 { font-size: 12pt; margin: 16pt 0 6pt; }
table { border-collapse: collapse; }
td.k { padding: 2pt 14pt 2pt 0; color: #555; }
td.v { padding: 2pt 0; font-weight: bold; }
p.cat { margin: 8pt 0 2pt; }
ul { margin: 0 0 6pt 18pt; }
</style></head>
<body>
<h1>InventoryBlind</h1>
<p><strong>${escapeHtml(DOC_TITLE)}</strong></p>
<p>${logo}<strong>${escapeHtml(doc.brandName)}</strong><br />${escapeHtml(formatClosingDateTime(doc.closedAt))}</p>
<h2>Indicadores do fechamento</h2>
<table>${metrics}</table>
<h2>Categorias identificadas</h2>
${categories}
<h2>Observações não classificadas</h2>
${unclassified}
</body></html>`;
}

export async function downloadClosingReportWord(doc: ClosingDocument): Promise<void> {
  // O logo vai embutido como dataURL: a URL assinada do bucket privado expira e o Word
  // não a buscaria de forma confiável. Falha ao carregar => documento sem logo.
  const logo = await logoAsDataUrl(doc.brandLogo);
  const html = buildClosingReportWordHtml({ ...doc, brandLogo: logo?.dataUrl ?? null });
  const blob = new Blob([String.fromCharCode(0xfeff) + html], { type: 'application/msword' });
  downloadBlob(blob, closingExportFilename(doc, 'doc'));
}
