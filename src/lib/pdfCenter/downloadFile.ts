// Helper de download — mesma técnica de src/lib/barcode/barcodeExport.ts
// (`<a download>` temporário), cópia própria desta ferramenta.

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Adiado: revogar a URL antes do clique disparar o download derrubaria o arquivo.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}
