// Tipos centrais da Central de PDFs — ferramenta separada, 100% local no
// navegador (sem Supabase, sem upload). Este arquivo não importa nada de
// pdf-lib/pdfjs-dist de propósito: é o único módulo que TODOS os outros podem
// importar sem criar dependência circular ou puxar as libs pesadas.

export type PdfCenterSourceKind = 'pdf' | 'image';

export type Rotation = 0 | 90 | 180 | 270;

/** Um arquivo de entrada (PDF ou imagem) carregado pelo usuário. `file` é o
 *  `File` original — nunca é enviado a lugar nenhum, só lido localmente. */
export interface PdfCenterSource {
  id: string;
  name: string;
  kind: PdfCenterSourceKind;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  file: File;
}

/** Uma página no editor visual. `sourcePageIndex` é sempre relativo ao
 *  documento ORIGINAL (nunca muda) — a ordem de exibição vem da posição desta
 *  página dentro do array `pages` do estado, não de um campo próprio. Duas
 *  entradas podem apontar para a mesma `sourceId`+`sourcePageIndex` (duplicar
 *  página), cada uma com `id` próprio. */
export interface PdfCenterPage {
  id: string;
  sourceId: string;
  sourcePageIndex: number;
  /** Rotação adicional aplicada no editor, somada à rotação nativa da página
   *  de origem (que fica guardada em `PdfCenterSource`/lida do PDF na hora de
   *  processar — nunca duplicada aqui). */
  rotation: Rotation;
  selected: boolean;
}

export interface PdfCenterDocState {
  sources: PdfCenterSource[];
  pages: PdfCenterPage[];
}

export function emptyDocState(): PdfCenterDocState {
  return { sources: [], pages: [] };
}

/** Quatro lados — a unidade depende do contexto (mm nas preferências/UI, pt
 *  quando já convertido para o motor de layout). */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type MarginsMm = EdgeInsets;

export function uniformInsets(value: number): EdgeInsets {
  return { top: value, right: value, bottom: value, left: value };
}

export type FitMode = 'contain' | 'fill' | 'original';

export type PdfCenterErrorReason =
  | 'corrupted'
  | 'password-protected'
  | 'unsupported-format'
  | 'empty-document'
  | 'render-failed'
  | 'out-of-memory'
  | 'unknown';

/** Erro com motivo classificado — nunca "Erro desconhecido" quando dá pra
 *  dizer algo mais específico (regra do projeto, ver CLAUDE.md/spec §14). */
export class PdfCenterError extends Error {
  readonly reason: PdfCenterErrorReason;
  readonly fileName?: string;

  constructor(reason: PdfCenterErrorReason, message: string, fileName?: string) {
    super(message);
    this.name = 'PdfCenterError';
    this.reason = reason;
    this.fileName = fileName;
  }
}

export const PDF_CENTER_ERROR_MESSAGES: Record<PdfCenterErrorReason, (fileName?: string) => string> = {
  corrupted: (f) => `${f ?? 'O arquivo'} parece corrompido e não pôde ser aberto.`,
  'password-protected': (f) => `${f ?? 'O arquivo'} está protegido por senha. Remova a senha antes de importar — a Central de PDFs não tenta contornar proteções.`,
  'unsupported-format': (f) => `${f ?? 'O arquivo'} não está em um formato suportado (use PDF, PNG, JPG ou WebP).`,
  'empty-document': (f) => `${f ?? 'O arquivo'} não tem nenhuma página.`,
  'render-failed': (f) => `Não foi possível renderizar ${f ?? 'o arquivo'}. Tente novamente ou use outro arquivo.`,
  'out-of-memory': (f) => `Memória insuficiente para processar ${f ?? 'este arquivo'}. Tente com menos páginas ou arquivos menores por vez.`,
  unknown: (f) => `Falha inesperada ao processar ${f ?? 'o arquivo'}.`,
};
