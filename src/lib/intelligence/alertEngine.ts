// Alert Engine — metrics into things worth doing.
//
// Pure. Every alert is derived from a counted observation, and the count appears in
// the title.
//
// ── The rule this file follows ──────────────────────────────────────────────
// An alert with no number is not an alert, it is a mood. "Seu estoque parece
// precisar de atenção" tells the operator nothing they can act on and trains them
// to skip the section. So: no count, no alert. Every entry here carries a number
// pulled from an available metric, and an unavailable metric produces silence
// rather than a hedge.
//
// ── Three things, always ────────────────────────────────────────────────────
// title   what happened, with the count
// detail  why it matters
// action  what to do next, plus where clicking goes
//
// An alert missing the third is an observation, and observations belong on a card.

import {
  isAvailable,
  type AlertSeverity,
  type InventoryAlert,
  type InventoryMetrics,
} from './contracts';

/** Thresholds at which a merely-nonzero count becomes worth interrupting someone
 *  over. Exported so tests pin the same numbers the copy implies. */
export const ALERT_THRESHOLDS = {
  /** Any negative balance is critical. No threshold: one SKU overselling is enough
   *  to cancel real orders, and a "3 or more" rule would sit on the first two. */
  negativeStock: 1,
  /** Discrepancies are normal in small numbers — a count in progress produces them.
   *  Worth surfacing once there are enough to suggest a systemic cause. */
  discrepancies: 5,
  /** Missing EANs only become a story in bulk. */
  missingEan: 20,
  missingWarehouse: 20,
  /** A single failed adjustment matters: someone approved a correction and the ERP
   *  never got it. */
  failedAdjustments: 1,
  /** One sync failure can be a provider hiccup; the alert exists to catch the
   *  pattern, and the sync card already shows the state. */
  syncFailures: 1,
} as const;

export function buildInventoryAlerts(metrics: InventoryMetrics): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];

  const push = (
    id: string,
    severity: AlertSeverity,
    count: number,
    title: string,
    detail: string,
    action: string,
    drillTo: InventoryAlert['drillTo']
  ) => alerts.push({ id, severity, count, title, detail, action, drillTo });

  // ── Negative stock ────────────────────────────────────────────────────────
  // First, and always critical. It is the only condition here that is actively
  // costing the customer money while they read the screen.
  if (isAvailable(metrics.stock.negativeProducts) && metrics.stock.negativeProducts.value >= ALERT_THRESHOLDS.negativeStock) {
    const count = metrics.stock.negativeProducts.value;
    push(
      'negative_stock',
      'critical',
      count,
      `${count} ${plural(count, 'SKU', 'SKUs')} com saldo negativo`,
      'Um saldo negativo no ERP é publicado aos marketplaces como disponível. Cada um é um risco real de venda que será cancelada.',
      'Ver produtos e corrigir o saldo',
      'negative_stock'
    );
  }

  // ── Negative deposit under a healthy total ────────────────────────────────
  if (
    isAvailable(metrics.stock.negativeWarehouseProducts) &&
    metrics.stock.negativeWarehouseProducts.value > 0
  ) {
    const count = metrics.stock.negativeWarehouseProducts.value;
    push(
      'negative_warehouse',
      'warning',
      count,
      `${count} ${plural(count, 'produto', 'produtos')} com depósito negativo`,
      'O saldo total está positivo, mas um depósito está negativo — as unidades existem e estão registradas no lugar errado. Normalmente é lançamento invertido ou transferência não concluída.',
      'Conferir os lançamentos do depósito',
      'negative_stock'
    );
  }

  // ── Sync failures ────────────────────────────────────────────────────────
  // High in the list because it invalidates everything below it: if the sync is
  // failing, the other counts describe an older reality.
  if (isAvailable(metrics.sync.failedRecent) && metrics.sync.failedRecent.value >= ALERT_THRESHOLDS.syncFailures) {
    const count = metrics.sync.failedRecent.value;
    push(
      'sync_failures',
      'critical',
      count,
      `${count} ${plural(count, 'falha', 'falhas')} de sincronização nas últimas 24 h`,
      'Enquanto a sincronização falha, os indicadores desta página descrevem a última leitura bem-sucedida, não o estado atual do ERP.',
      'Ver o histórico da integração',
      'sync_log'
    );
  }

  // ── Stale data ───────────────────────────────────────────────────────────
  // Not gated on a count — staleness is a state. Included because presenting the
  // numbers without it would be the misleading option.
  if (metrics.sync.freshness.state === 'very_stale' || metrics.sync.freshness.state === 'stale') {
    const critical = metrics.sync.freshness.state === 'very_stale';
    push(
      'stale_data',
      critical ? 'critical' : 'warning',
      0,
      critical ? 'Dados do ERP muito desatualizados' : 'Dados do ERP desatualizados',
      `A última leitura do provedor foi ${describeAgeShort(metrics.sync.freshness.ageMs)}. Os números desta página refletem aquele momento.`,
      'Sincronizar agora',
      'integration_settings'
    );
  }

  // ── Failed adjustments ───────────────────────────────────────────────────
  if (isAvailable(metrics.adjustments.failed) && metrics.adjustments.failed.value >= ALERT_THRESHOLDS.failedAdjustments) {
    const count = metrics.adjustments.failed.value;
    push(
      'failed_adjustments',
      'critical',
      count,
      `${count} ${plural(count, 'ajuste', 'ajustes')} não ${plural(count, 'chegou', 'chegaram')} ao ERP`,
      'Alguém aprovou estas correções e o envio falhou. O ERP continua com o saldo antigo, que já se sabe estar errado.',
      'Ver a fila de lançamentos',
      'adjustment_queue'
    );
  }

  // ── Discrepancies ────────────────────────────────────────────────────────
  if (isAvailable(metrics.discrepancies.open) && metrics.discrepancies.open.value >= ALERT_THRESHOLDS.discrepancies) {
    const count = metrics.discrepancies.open.value;
    push(
      'discrepancies',
      'warning',
      count,
      `${count} divergências entre ERP e InventoryBlind`,
      'Cada divergência é um saldo sobre o qual os dois sistemas discordam e ninguém decidiu qual está certo. Nada é sobrescrito automaticamente.',
      'Revisar e decidir a origem correta',
      'discrepancies'
    );
  }

  // ── Adjustments waiting ──────────────────────────────────────────────────
  // Informational: the queue draining is the normal state, so this exists to stop
  // an approved correction from sitting unnoticed, not to demand action now.
  if (isAvailable(metrics.adjustments.pending) && metrics.adjustments.pending.value > 0) {
    const count = metrics.adjustments.pending.value;
    push(
      'pending_adjustments',
      'info',
      count,
      `${count} ${plural(count, 'lançamento', 'lançamentos')} aguardando envio ao ERP`,
      'Já aprovados e ainda não enviados. Cada envio relê o saldo real do provedor antes de escrever.',
      'Revisar e enviar',
      'adjustment_queue'
    );
  }

  // ── Catalogue quality ────────────────────────────────────────────────────
  if (isAvailable(metrics.catalog.withoutEan) && metrics.catalog.withoutEan.value >= ALERT_THRESHOLDS.missingEan) {
    const count = metrics.catalog.withoutEan.value;
    push(
      'missing_ean',
      'info',
      count,
      `${count} produtos sem EAN`,
      'Sem EAN a conferência por leitor de código de barras e a associação por NF-e não funcionam para estes produtos.',
      'Ver produtos e completar o cadastro',
      'missing_ean'
    );
  }

  if (
    isAvailable(metrics.stock.withoutWarehouse) &&
    metrics.stock.withoutWarehouse.value >= ALERT_THRESHOLDS.missingWarehouse
  ) {
    const count = metrics.stock.withoutWarehouse.value;
    push(
      'missing_warehouse',
      'info',
      count,
      `${count} produtos sem depósito identificado`,
      'O provedor devolveu saldo sem informar o depósito, então estes produtos não entram em nenhuma análise por localização.',
      'Conferir o mapeamento de depósitos',
      'missing_warehouse'
    );
  }

  // Severity first, then size. Two criticals sorted by count put the worst one on
  // top; severity alone would let a 2-SKU critical outrank nothing, and count alone
  // would put 400 missing EANs above 3 SKUs overselling.
  const ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.count ?? 0) - (a.count ?? 0));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function describeAgeShort(ageMs: number | null): string {
  if (ageMs == null) return 'em momento desconhecido';
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `há ${minutes} ${plural(minutes, 'minuto', 'minutos')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${plural(hours, 'hora', 'horas')}`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${plural(days, 'dia', 'dias')}`;
}
