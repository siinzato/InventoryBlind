// Full Manager — shared types

export type FullStatus =
  | 'scheduled'
  | 'preparing'
  | 'picking'
  | 'checking'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type FullItemStatus =
  | 'found'
  | 'no_location'
  | 'insufficient_stock'
  | 'not_found'
  | 'picked'
  | 'skipped'
  | 'picking_error';

export type Marketplace = 'Mercado Livre' | 'Shopee' | 'Amazon FBA' | 'Outro';

export interface FullOperation {
  id: string;
  company_id: string | null;
  assigned_user_id: string | null;
  full_number: string;
  marketplace: Marketplace | string;
  responsible: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: FullStatus;
  total_sku: number;
  total_pieces: number;
  notes: string | null;
  checker: string | null;
  checker_notes: string | null;
  checked_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FullOperationItem {
  id: string;
  operation_id: string;
  company_id: string | null;
  listing_id: string | null;
  product_id: string | null;
  sku: string | null;
  ean: string | null;
  product_name: string | null;
  location: string | null;
  quantity_requested: number;
  quantity_picked: number;
  status: FullItemStatus;
  picker_notes: string | null;
  picked_by_user_id: string | null;
  picked_at: string | null;
  created_at: string;
}

// ── Label helpers ─────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<FullStatus, string> = {
  scheduled: 'Agendado',
  preparing: 'Preparando',
  picking: 'Separando',
  checking: 'Conferência',
  ready: 'Pronto',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
};

export const STATUS_COLOR: Record<FullStatus, string> = {
  scheduled: 'bg-accent/10 text-accent border-accent/20',
  preparing: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  picking: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  checking: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  ready: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  completed: 'bg-surface-3 text-fg-muted border-edge',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
};

export const STATUS_DOT: Record<FullStatus, string> = {
  scheduled: 'bg-accent',
  preparing: 'bg-amber-500',
  picking: 'bg-orange-500',
  checking: 'bg-purple-500',
  ready: 'bg-emerald-500',
  completed: 'bg-fg-subtle',
  cancelled: 'bg-red-500',
};

export const ITEM_STATUS_LABEL: Record<FullItemStatus, string> = {
  found: 'Encontrado',
  no_location: 'Sem localização',
  insufficient_stock: 'Saldo insuficiente',
  not_found: 'Não encontrado',
  picked: 'Separado',
  skipped: 'Pulado',
  picking_error: 'Erro',
};

export const ITEM_STATUS_COLOR: Record<FullItemStatus, string> = {
  found: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  no_location: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  insufficient_stock: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  not_found: 'bg-red-500/10 text-red-700 dark:text-red-400',
  picked: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  skipped: 'bg-surface-3 text-fg-muted',
  picking_error: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

export const MARKETPLACES: Marketplace[] = ['Mercado Livre', 'Shopee', 'Amazon FBA', 'Outro'];

export const ALL_STATUSES: FullStatus[] = [
  'scheduled', 'preparing', 'picking', 'checking', 'ready', 'completed', 'cancelled',
];

// ── Utils ─────────────────────────────────────────────────────────────────────

export function formatFullDate(dateStr: string | null, timeStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  let label: string;
  if (d.toDateString() === today.toDateString()) label = 'Hoje';
  else if (d.toDateString() === tomorrow.toDateString()) label = 'Amanhã';
  else label = d.toLocaleDateString('pt-BR');

  return timeStr ? `${label} — ${timeStr}` : label;
}

export function pickingProgress(items: FullOperationItem[]): number {
  if (!items.length) return 0;
  const done = items.filter(i => i.status === 'picked' || i.status === 'skipped').length;
  return Math.round((done / items.length) * 100);
}
