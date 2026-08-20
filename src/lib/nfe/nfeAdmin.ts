// Controles administrativos da NF-e / Entradas — regras puras.
//
// As regras genéricas vivem em lib/admin/recordAdmin.ts. Aqui fica a adaptação
// para este módulo, que difere da Contagem Física em duas coisas:
//
// 1. As linhas de NF-e são consumidas em snake_case direto do PostgREST
//    (nfeTypes.ts não mapeia para camelCase), então os helpers compartilhados
//    recebem um adaptador em vez de a linha crua.
// 2. A nota é IMUTÁVEL. Não existe "editar nota": chave, número, série, emitente,
//    valores e XML são documento fiscal. O que existe é arquivar, restaurar,
//    excluir uma nota nunca conferida e CORRIGIR uma quantidade conferida — e a
//    correção nunca sobrescreve o log, ela acrescenta um evento.

import { buildReasonedRpcArgs, isArchived, normalizeAdminReason } from '../admin/recordAdmin';
import type { InvoiceStatus, NfeInvoice } from './nfeTypes';

type ArchivableInvoice = { deleted_at?: string | null };

/** Coluna ausente (migration 062 não aplicada) é tratada como nota ativa — é o
 *  que mantém a tela funcionando antes e depois da migration. */
function toArchivable(invoice: ArchivableInvoice) {
  return { deletedAt: invoice.deleted_at ?? null };
}

export function isInvoiceArchived(invoice: ArchivableInvoice): boolean {
  return isArchived(toArchivable(invoice));
}

export function filterActiveInvoices<T extends ArchivableInvoice>(invoices: T[]): T[] {
  return invoices.filter(i => !isInvoiceArchived(i));
}

export function filterArchivedInvoices<T extends ArchivableInvoice>(invoices: T[]): T[] {
  return invoices.filter(isInvoiceArchived);
}

/** Status em que a nota nunca foi conferida — o único caso em que a exclusão
 *  física é possível. O banco ainda confere ausência de eventos e de itens já
 *  contados; isto é o espelho para a tela não oferecer um botão que vai falhar. */
export const DRAFT_INVOICE_STATUSES: readonly InvoiceStatus[] = ['not_started'];

export function canHardDeleteInvoice(invoice: Pick<NfeInvoice, 'status'> & ArchivableInvoice): boolean {
  if (isInvoiceArchived(invoice)) return false;
  return DRAFT_INVOICE_STATUSES.includes(invoice.status);
}

/** Correção de quantidade só existe para nota já finalizada. Antes disso o
 *  caminho é a contagem normal, que já registra evento e mantém a nota cega. */
export function canCorrectInvoiceCounts(invoice: Pick<NfeInvoice, 'status'> & ArchivableInvoice): boolean {
  if (isInvoiceArchived(invoice)) return false;
  return invoice.status === 'completed' || invoice.status === 'with_divergences';
}

export function buildInvoiceReasonRpcArgs(
  invoiceId: string,
  reason: string
): { p_invoice_id: string; p_reason: string } {
  return buildReasonedRpcArgs('p_invoice_id', invoiceId, reason) as {
    p_invoice_id: string;
    p_reason: string;
  };
}

/** Payload da correção. Nunca inclui empresa, status da nota nem o papel de quem
 *  chama — os três são resolvidos no servidor a partir de auth.uid(). */
export function buildCountCorrectionRpcArgs(
  itemId: string,
  quantity: number,
  reason: string
): { p_item_id: string; p_quantity: number; p_reason: string } {
  return { p_item_id: itemId, p_quantity: quantity, p_reason: normalizeAdminReason(reason) };
}

/** `null` quando a quantidade serve. Aceita zero: "conferi e não veio nenhum" é
 *  uma correção legítima, e diferente de "não conferi". */
export function validateCorrectionQuantity(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 'Informe a quantidade corrigida.';
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return 'Informe um número válido.';
  if (value < 0) return 'A quantidade não pode ser negativa.';
  return null;
}

export function parseCorrectionQuantity(raw: string): number {
  return Number(raw.trim().replace(',', '.'));
}
