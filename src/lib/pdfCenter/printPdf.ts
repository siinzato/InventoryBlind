// Impressão do PDF final (spec §11) — carrega o PDF de verdade num iframe
// invisível e aciona o diálogo de impressão nativo do navegador, que já
// respeita o tamanho físico de cada página. Não dá (nem deveria dar) pra
// controlar o driver da impressora a partir daqui — só abrir o diálogo; a
// UI que chama isto é responsável por avisar sobre escala 100%/tamanho real.

export function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;

  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  };

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      cleanup();
    }
  };

  document.body.appendChild(iframe);
  window.setTimeout(cleanup, 60000);
}
