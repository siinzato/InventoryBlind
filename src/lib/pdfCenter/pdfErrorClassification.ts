// Classifica falhas de leitura de PDF num motivo específico (spec §14: nunca
// só "Erro desconhecido" quando dá pra dizer mais). Reconhece tanto os erros
// do pdf-lib (usado para estrutura) quanto os do pdfjs-dist (usado para
// renderização) — por nome, sem precisar importar pdfjs-dist aqui (evita
// puxar a lib pesada só pra classificar um erro).

import { EncryptedPDFError } from 'pdf-lib';
import type { PdfCenterErrorReason } from './types';

export function classifyPdfError(err: unknown): PdfCenterErrorReason {
  if (err instanceof EncryptedPDFError) return 'password-protected';

  const name = err instanceof Error ? err.name : undefined;
  if (name === 'PasswordException') return 'password-protected';
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return 'corrupted';

  const message = err instanceof Error ? err.message : '';
  if (/encrypt/i.test(message)) return 'password-protected';
  if (/out of memory|allocation failed/i.test(message)) return 'out-of-memory';

  if (err instanceof Error) return 'corrupted';
  return 'unknown';
}
