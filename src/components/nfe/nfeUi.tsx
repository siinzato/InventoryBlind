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
  not_started: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  with_divergences: 'bg-amber-50 text-amber-700 border-amber-200',
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
  unlinked: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  pending: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  missing: 'bg-red-50 text-red-700 border-red-200',
  surplus: 'bg-amber-50 text-amber-700 border-amber-200',
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
