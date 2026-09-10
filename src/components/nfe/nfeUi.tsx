import type { InvoiceStatus, ItemResultStatus } from '../../lib/nfe/nfeTypes';
import { Badge } from '../ui';

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('pt-BR');
}

export function formatQty(value: number | null): string {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

const INVOICE_VARIANT: Record<InvoiceStatus, 'neutral' | 'accent' | 'success' | 'warning'> = {
  not_started: 'neutral',
  in_progress: 'accent',
  completed: 'success',
  with_divergences: 'warning',
};

const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em contagem',
  completed: 'Concluída',
  with_divergences: 'Com divergências',
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge variant={INVOICE_VARIANT[status]}>{INVOICE_LABEL[status]}</Badge>;
}

const ITEM_VARIANT: Record<ItemResultStatus, 'neutral' | 'success' | 'danger' | 'warning'> = {
  unlinked: 'neutral',
  pending: 'neutral',
  ok: 'success',
  missing: 'danger',
  surplus: 'warning',
};

const ITEM_LABEL: Record<ItemResultStatus, string> = {
  unlinked: 'Não vinculado',
  pending: 'Não conferido',
  ok: 'OK',
  missing: 'Falta',
  surplus: 'Sobra',
};

export function ItemStatusBadge({ status }: { status: ItemResultStatus }) {
  return <Badge variant={ITEM_VARIANT[status]}>{ITEM_LABEL[status]}</Badge>;
}
