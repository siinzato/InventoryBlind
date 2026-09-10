// Sanitização de nomes de arquivo — cópia própria desta ferramenta (mesma
// convenção de `src/lib/barcode/barcodeExport.ts`: cada ferramenta mantém sua
// própria função, sem compartilhar estado ou helpers entre si).

const FORBIDDEN_FILENAME_CHARS = ['"', '*', '/', ':', '<', '>', '?', '\\', '|'];

function stripForbiddenChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f) continue;
    if (FORBIDDEN_FILENAME_CHARS.includes(ch)) continue;
    out += ch;
  }
  return out;
}

export function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/** Remove caracteres inválidos em nomes de arquivo/entradas de ZIP, colapsa
 *  espaços e limita o tamanho. Nunca retorna string vazia. */
export function sanitizeFileBaseName(name: string): string {
  const cleaned = stripForbiddenChars(name).replace(/\s+/g, ' ').trim();
  const truncated = cleaned.slice(0, 120).trim();
  return truncated.length > 0 ? truncated : 'documento';
}

export interface BuildOutputFilenameOptions {
  prefix?: string;
  suffix?: string;
  index?: number;
  ext: string;
}

export function buildOutputFilename(baseName: string, opts: BuildOutputFilenameOptions): string {
  const base = sanitizeFileBaseName(stripExtension(baseName));
  const prefix = opts.prefix ? `${sanitizeFileBaseName(opts.prefix)}-` : '';
  const suffix = opts.suffix ? `-${sanitizeFileBaseName(opts.suffix)}` : '';
  const index = opts.index != null ? `-${String(opts.index).padStart(3, '0')}` : '';
  return `${prefix}${base}${suffix}${index}.${opts.ext}`;
}

/** Garante nomes únicos dentro de um mesmo lote/ZIP, sufixando "(2)", "(3)"...
 *  em colisões — sem isso um ZIP com dois arquivos "nota.pdf" perde um deles
 *  silenciosamente. */
export function dedupeFilenames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map(name => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;

    const ext = extensionOf(name);
    const base = ext ? name.slice(0, -(ext.length + 1)) : name;
    return ext ? `${base} (${count + 1}).${ext}` : `${base} (${count + 1})`;
  });
}
