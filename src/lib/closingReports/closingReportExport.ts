// Exportação do fechamento — PDF (jsPDF, já no projeto) e Word (.doc via HTML + Blob,
// sem nova dependência). As duas leem exclusivamente o ClosingDocument canônico, então
// não há como divergirem entre si nem do que está na tela. Exportar é leitura: nada
// aqui grava no banco nem toca o relatório.

import { downloadBlob } from '../pdfCenter/downloadFile';
import {
  CLOSING_METRIC_ROWS,
  formatClosingDateTime,
  formatClosingDuration,
  formatClosingTime,
  formatAccuracy,
  type ClosingDocument,
  type ClosingDocumentSession,
} from './closingDocumentModel';
import { int, plural } from '../formatPtBr';

const DOC_TITLE = 'Relatório de Fechamento de Inventário';

/** Geometria do `public/icon-mark.svg`, nas mesmas coordenadas de 100x100. Desenhada em
 *  vetor em vez de embutir o PNG: não depende de fetch, não tem caminho de falha e sai
 *  nítida em qualquer impressão. As cores são as da marca. */
const MARK_SLATS = [10, 34, 58, 82];
const MARK_ACCENT_SLAT = 58;
const MARK_DARK: [number, number, number] = [0x22, 0x26, 0x2b];
const MARK_BLUE: [number, number, number] = [0x0f, 0x3d, 0x68];

type Pdf = import('jspdf').jsPDF;

/** Desenha a marca do InventoryBlind num quadrado de `size` mm a partir de (x, y). */
function drawInventoryBlindMark(pdf: Pdf, x: number, y: number, size: number): void {
  const k = size / 100;
  for (const slat of MARK_SLATS) {
    const [r, g, b] = slat === MARK_ACCENT_SLAT ? MARK_BLUE : MARK_DARK;
    pdf.setFillColor(r, g, b);
    pdf.roundedRect(x + slat * k, y + 20 * k, 14 * k, 60 * k, 3 * k, 3 * k, 'F');
  }
  pdf.setFillColor(...MARK_BLUE);
  pdf.roundedRect(x + 4 * k, y + 46 * k, 92 * k, 6 * k, 3 * k, 3 * k, 'F');
  pdf.setFillColor(0, 0, 0);
}

/** "João e Maria" / "João" / "—". Operador é nome de gente, não lista separada por vírgula. */
function operatorsLabel(session: ClosingDocumentSession): string {
  if (session.operators.length === 0) return 'operador não informado';
  if (session.operators.length === 1) return session.operators[0];
  return session.operators.slice(0, -1).join(', ') + ' e ' + session.operators[session.operators.length - 1];
}

/**
 * Título da sessão: a DATA primeiro, porque é o que distingue uma contagem da outra.
 * `count_number` não serve de título — numa linha com nove primeiras contagens de lotes
 * diferentes, nove linhas dizendo "1ª contagem" não diferenciam nada.
 */
function sessionTitle(session: ClosingDocumentSession): string {
  const quando = session.startedAt
    ? new Date(session.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'Data não registrada';
  return `${quando} — ${operatorsLabel(session)}`;
}

/** Linha de contexto da sessão. Só entra o que existe: sem horário gravado, não se
 *  imprime "— · —" para preencher espaço. */
function sessionContext(session: ClosingDocumentSession): string {
  const partes = [`${session.countNumber}ª contagem${session.source === 'import' ? ', importada' : ''}`];
  if (session.startedAt) {
    const ini = formatClosingTime(session.startedAt);
    const fim = formatClosingTime(session.finishedAt);
    partes.push(fim === '—' || fim === ini ? ini : `${ini} às ${fim}`);
  } else {
    partes.push('horário não registrado');
  }
  if (session.durationSeconds !== null && session.durationSeconds > 0) {
    partes.push(formatClosingDuration(session.durationSeconds));
  }
  return partes.join('  ·  ');
}

/** Números da sessão, na mesma ordem dos indicadores do fechamento. */
function sessionMetrics(session: ClosingDocumentSession): string {
  return (
    `${int(session.skusContados)} ${plural(session.skusContados, 'SKU contado', 'SKUs contados')}  ·  ` +
    `${int(session.divergenciasReais)} ${plural(session.divergenciasReais, 'divergência real', 'divergências reais')}  ·  ` +
    `acuracidade ${formatAccuracy(session.accuracyFinal)}`
  );
}

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

  // Cabeçalho: marca do I.B à esquerda, título à direita, régua fina embaixo.
  drawInventoryBlindMark(pdf, marginX, y, 12);
  pdf.setFontSize(15);
  pdf.setFont('helvetica', 'bold');
  pdf.text('InventoryBlind', marginX + 16, y + 6);
  pdf.setFontSize(10.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(DOC_TITLE, marginX + 16, y + 11);
  y += 16;
  pdf.setDrawColor(...MARK_BLUE);
  pdf.setLineWidth(0.6);
  pdf.line(marginX, y, 210 - marginX, y);
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.2);
  y += 7;

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

  heading('Período da linha');
  if (doc.startedAt) {
    const mesmoDia = doc.finishedAt && doc.startedAt.slice(0, 10) === doc.finishedAt.slice(0, 10);
    line(mesmoDia
      ? `Início: ${formatClosingDateTime(doc.startedAt)}  ·  Término: ${formatClosingTime(doc.finishedAt)}`
      : `Início: ${formatClosingDateTime(doc.startedAt)}`);
    if (!mesmoDia) {
      line(doc.finishedAt ? `Término: ${formatClosingDateTime(doc.finishedAt)}` : 'Término: não registrado');
    }
  } else {
    // Dizer que não foi registrado é diferente de omitir a linha: sem isso o leitor
    // não sabe se a contagem foi instantânea ou se o dado não existe.
    line('Início e término não registrados nas contagens deste ciclo.');
  }
  if (doc.countingSeconds !== null) line(`Tempo contando: ${formatClosingDuration(doc.countingSeconds)}`);
  line(`Universo da linha: ${int(doc.totalSku)} ${plural(doc.totalSku, 'SKU', 'SKUs')}`);
  // A data do fechamento NÃO se repete aqui: o cabeçalho já a declara, e dizer duas
  // vezes a mesma data em meia página é ruído.

  heading('Indicadores do fechamento');
  for (const row of CLOSING_METRIC_ROWS) {
    line(`${row.label}: ${row.value(doc.metrics)}`);
  }

  heading('Sessões de contagem');
  if (doc.sessions.length === 0) {
    line('Nenhuma contagem registrada para este ciclo.');
  } else {
    for (const s of doc.sessions) {
      line(sessionTitle(s), 10, true);
      line(sessionContext(s), 9, false, 4);
      line(sessionMetrics(s), 9, false, 4);
    }
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

  // Mesma geometria do icon-mark.svg, inline: o Word abre o HTML de um Blob local, então
  // uma <img> apontando para /icon-mark.png não resolveria fora do navegador.
  const marca =
    '<span style="display:inline-block;vertical-align:middle;margin-right:8px">' +
    `<svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${
      MARK_SLATS.map(s =>
        `<rect x="${s}" y="20" width="14" height="60" rx="3" fill="${s === MARK_ACCENT_SLAT ? '#0F3D68' : '#22262B'}"/>`
      ).join('')
    }<rect x="4" y="46" width="92" height="6" rx="3" fill="#0F3D68"/></svg></span>`;

  const mesmoDia = doc.startedAt && doc.finishedAt && doc.startedAt.slice(0, 10) === doc.finishedAt.slice(0, 10);
  const periodoLinhas: string[] = [];
  if (doc.startedAt) {
    periodoLinhas.push(`<tr><td class="k">Início</td><td class="v">${escapeHtml(formatClosingDateTime(doc.startedAt))}</td></tr>`);
    periodoLinhas.push(`<tr><td class="k">Término</td><td class="v">${escapeHtml(
      doc.finishedAt ? (mesmoDia ? formatClosingTime(doc.finishedAt) : formatClosingDateTime(doc.finishedAt)) : 'não registrado'
    )}</td></tr>`);
  } else {
    periodoLinhas.push('<tr><td class="k">Início e término</td><td class="v">não registrados</td></tr>');
  }
  if (doc.countingSeconds !== null) {
    periodoLinhas.push(`<tr><td class="k">Tempo contando</td><td class="v">${escapeHtml(formatClosingDuration(doc.countingSeconds))}</td></tr>`);
  }
  periodoLinhas.push(`<tr><td class="k">Universo da linha</td><td class="v">${escapeHtml(`${int(doc.totalSku)} ${plural(doc.totalSku, 'SKU', 'SKUs')}`)}</td></tr>`);
  const periodo = periodoLinhas.join('');

  const sessions = doc.sessions.length === 0
    ? '<p>Nenhuma contagem registrada para este ciclo.</p>'
    : doc.sessions.map(s => `
        <p class="cat"><strong>${escapeHtml(sessionTitle(s))}</strong></p>
        <p class="sub">${escapeHtml(sessionContext(s))}</p>
        <p class="sub">${escapeHtml(sessionMetrics(s))}</p>
      `).join('');

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
p.sub { margin: 0 0 2pt 14pt; font-size: 10pt; color: #555; }
hr { border: none; border-top: 1.5pt solid #0F3D68; margin: 6pt 0 10pt; }
ul { margin: 0 0 6pt 18pt; }
</style></head>
<body>
<h1>${marca}InventoryBlind</h1>
<p><strong>${escapeHtml(DOC_TITLE)}</strong></p>
<hr />
<p>${logo}<strong>${escapeHtml(doc.brandName)}</strong><br />Fechamento: ${escapeHtml(formatClosingDateTime(doc.closedAt))}</p>
<h2>Período da linha</h2>
<table>${periodo}</table>
<h2>Indicadores do fechamento</h2>
<table>${metrics}</table>
<h2>Sessões de contagem</h2>
${sessions}
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
