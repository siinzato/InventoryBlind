// Empacotamento em ZIP (múltiplas saídas — divisão, lote, PDF->imagem).
// JSZip é importado dinamicamente pelo mesmo motivo de pdfjs-dist: só carrega
// quando alguém realmente pede uma saída em ZIP.

import { dedupeFilenames } from './filenames';

export interface ZipEntryInput {
  name: string;
  data: Uint8Array | Blob;
}

export async function buildZip(entries: ZipEntryInput[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const names = dedupeFilenames(entries.map(e => e.name));
  entries.forEach((entry, i) => zip.file(names[i], entry.data));

  return zip.generateAsync({ type: 'blob' });
}
