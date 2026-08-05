import type { InvoiceStatus, ItemResultStatus } from '../../lib/nfe/nfeTypes';

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

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  not_started: 'bg-surface-3 text-fg-muted border-edge',
  in_progress: 'bg-accent/10 text-accent border-accent/20',
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  with_divergences: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em contagem',
  completed: 'Concluída',
  with_divergences: 'Com divergências',
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${INVOICE_BADGE[status]}`}>
      {INVOICE_LABEL[status]}
    </span>
  );
}

const ITEM_BADGE: Record<ItemResultStatus, string> = {
  unlinked: 'bg-surface-3 text-fg-subtle border-edge',
  pending: 'bg-surface-3 text-fg-muted border-edge',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  missing: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  surplus: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
};

const ITEM_LABEL: Record<ItemResultStatus, string> = {
  unlinked: 'Não vinculado',
  pending: 'Não conferido',
  ok: 'OK',
  missing: 'Falta',
  surplus: 'Sobra',
};

export function ItemStatusBadge({ status }: { status: ItemResultStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ITEM_BADGE[status]}`}>
      {ITEM_LABEL[status]}
    </span>
  );
}
