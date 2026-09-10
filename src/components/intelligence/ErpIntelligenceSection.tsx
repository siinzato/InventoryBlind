import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Info, Loader2, Plug, RefreshCw } from 'lucide-react';
import { Badge, Button, Panel, PanelSection, SegmentedControl, Stat, StatCell, StatRow } from '../ui';
import { loadIntelligence, loadNegativeStock, type NegativeStockRow } from '../../lib/intelligence/intelligenceService';
import { describeAge } from '../../lib/intelligence/healthEngine';
import {
  HEALTH_STATUS_LABEL,
  UNAVAILABLE_COPY,
  isAvailable,
  type DrillTarget,
  type HealthScore,
  type InventoryAlert,
  type InventoryMetrics,
  type MetricValue,
  type SyncState,
} from '../../lib/intelligence/contracts';

interface Props {
  /** Where a drill-down should send the user. The section does not know about
   *  routing — the Dashboard owns tab state, so it decides what each target means. */
  onDrill: (target: DrillTarget) => void;
}

/** ERP intelligence, as a section of the existing Dashboard.
 *
 *  Does no arithmetic. Every number here came from the Analytics Engine already
 *  wrapped in an availability state, and this file's only job is to render the
 *  available branch as a figure and the unavailable branch as the reason. That is
 *  what makes "never show a fake number" structural rather than a habit — there is
 *  no `?? 0` to reach for, because the unavailable branch has no value in it. */
export function ErpIntelligenceSection({ onDrill }: Props) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; metrics: InventoryMetrics; health: HealthScore; alerts: InventoryAlert[] }
  >({ phase: 'loading' });

  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (scopeId: string | null, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setState({ phase: 'loading' });

    try {
      const result = await loadIntelligence(scopeId);
      setState({ phase: 'ready', ...result });
    } catch (thrown) {
      setState({
        phase: 'error',
        message: thrown instanceof Error ? thrown.message : UNAVAILABLE_COPY.error,
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(connectionId);
  }, [load, connectionId]);

  if (state.phase === 'loading') return <LoadingSection />;
  if (state.phase === 'error') return <ErrorSection message={state.message} onRetry={() => load(connectionId)} />;

  const { metrics, health, alerts } = state;
  const connections = metrics.scope.connections;

  // No integration at all: the onboarding state, built from the same Panel the
  // populated version uses rather than a throwaway screen.
  if (connections.length === 0) {
    return <OnboardingSection onConnect={() => onDrill('integration_settings')} />;
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="lg">
          <Header
            metrics={metrics}
            refreshing={refreshing}
            onRefresh={() => load(connectionId, true)}
            onOpenSettings={() => onDrill('integration_settings')}
          />

          {connections.length > 1 && (
            <div className="mt-5">
              <SegmentedControl
                label="Conexão"
                value={connectionId ?? '__all__'}
                onChange={value => setConnectionId(value === '__all__' ? null : value)}
                options={[
                  { value: '__all__', label: 'Todas' },
                  ...connections.map(c => ({ value: c.id, label: c.displayName })),
                ]}
              />
            </div>
          )}
        </PanelSection>

        <StaleBanner metrics={metrics} />

        <PanelSection padding="lg">
          <HealthBlock health={health} onDrill={onDrill} />
        </PanelSection>

        <PanelSection padding="lg">
          <StatRow>
            <StatCell>
              <MetricStat
                label="SKUs sincronizados"
                metric={metrics.catalog.linkedProducts}
                context={contextForCatalog(metrics)}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Saldo negativo"
                metric={metrics.stock.negativeProducts}
                context="Publicado aos marketplaces como disponível"
                criticalWhenPositive
                onClick={() => onDrill('negative_stock')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Sem estoque"
                metric={metrics.stock.zeroProducts}
                context="Saldo exatamente zero"
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Divergências"
                metric={metrics.discrepancies.open}
                context="ERP e InventoryBlind discordam"
                onClick={() => onDrill('discrepancies')}
              />
            </StatCell>
          </StatRow>
        </PanelSection>

        <PanelSection padding="lg">
          <StatRow>
            <StatCell>
              <MetricStat
                label="Depósito negativo"
                metric={metrics.stock.negativeWarehouseProducts}
                context="Total positivo, depósito negativo"
                onClick={() => onDrill('negative_stock')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Sem EAN"
                metric={metrics.catalog.withoutEan}
                context="Impede conferência por código de barras"
                onClick={() => onDrill('missing_ean')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Sem depósito"
                metric={metrics.stock.withoutWarehouse}
                context="Fora das análises por localização"
                onClick={() => onDrill('missing_warehouse')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Abaixo do mínimo"
                metric={metrics.stock.belowMinimum}
                onClick={() => onDrill('minimum_stock_settings')}
              />
            </StatCell>
          </StatRow>
        </PanelSection>

        <PanelSection padding="lg">
          <StatRow>
            <StatCell>
              <MetricStat
                label="Aguardando envio ao ERP"
                metric={metrics.adjustments.pending}
                context="Lançamentos aprovados"
                onClick={() => onDrill('adjustment_queue')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Falha no envio"
                metric={metrics.adjustments.failed}
                context="ERP segue com o saldo antigo"
                criticalWhenPositive
                onClick={() => onDrill('adjustment_queue')}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Movimentações"
                metric={metrics.activity.movements}
              />
            </StatCell>
            <StatCell>
              <MetricStat
                label="Vendas potencialmente afetadas"
                metric={metrics.activity.potentiallyAffectedSales}
              />
            </StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      {alerts.length > 0 && <AlertsBlock alerts={alerts} onDrill={onDrill} />}

      <NegativeStockDrawer connectionId={connectionId} metrics={metrics} />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

const SYNC_BADGE: Record<SyncState, { variant: 'neutral' | 'success' | 'warning' | 'danger'; label: string }> = {
  synced: { variant: 'success', label: 'Sincronizado' },
  syncing: { variant: 'accent' as 'neutral', label: 'Sincronizando' },
  warning: { variant: 'warning', label: 'Atenção' },
  error: { variant: 'danger', label: 'Com erro' },
  offline: { variant: 'neutral', label: 'Desconectado' },
  never: { variant: 'neutral', label: 'Nunca sincronizado' },
};

function Header({
  metrics,
  refreshing,
  onRefresh,
  onOpenSettings,
}: {
  metrics: InventoryMetrics;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  const connections = metrics.scope.connections;
  // Provider names come from the connections, never hardcoded — this section has no
  // idea which ERP it is describing.
  const label =
    metrics.scope.connectionId != null
      ? connections.find(c => c.id === metrics.scope.connectionId)?.displayName ?? 'Integração'
      : connections.length === 1
        ? connections[0].displayName
        : `${connections.length} integrações`;

  const badge = SYNC_BADGE[metrics.sync.state];

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-title">Estoque no ERP</h3>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <p className="text-caption mt-1">
          {label}
          {metrics.sync.freshness.observedAt != null && (
            <> · leitura {describeAge(metrics.sync.freshness.ageMs)}</>
          )}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Atualizar
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          Integrações
        </Button>
      </div>
    </div>
  );
}

/** Context line for the SKU count. Only mentions what is actually available — a
 *  fixed "ativos / inativos" string would be a promise the data does not keep. */
function contextForCatalog(metrics: InventoryMetrics): string | undefined {
  const parts: string[] = [];

  if (isAvailable(metrics.stock.positiveProducts)) parts.push(`${metrics.stock.positiveProducts.value} com estoque`);
  if (isAvailable(metrics.stock.zeroProducts)) parts.push(`${metrics.stock.zeroProducts.value} sem estoque`);

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// ── Stale banner ────────────────────────────────────────────────────────────

function StaleBanner({ metrics }: { metrics: InventoryMetrics }) {
  const { state, ageMs } = metrics.sync.freshness;
  if (state !== 'stale' && state !== 'very_stale') return null;

  // Warning tone for both, because the instruction is the same — look before
  // acting. The age in the copy is what distinguishes them.
  return (
    <PanelSection padding="sm" className="bg-amber-500/5">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
        <span>
          Os números abaixo são da última leitura bem-sucedida, {describeAge(ageMs)}. Podem não
          refletir o estado atual do ERP.
        </span>
      </p>
    </PanelSection>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

const HEALTH_TONE = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  healthy: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
  unknown: 'text-fg-subtle',
} as const;

function HealthBlock({ health, onDrill }: { health: HealthScore; onDrill: (t: DrillTarget) => void }) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      <div className="flex-shrink-0">
        <p className="text-overline">Saúde do estoque</p>
        <p className={`mt-2 font-display text-4xl font-semibold tabular-nums ${HEALTH_TONE[health.status]}`}>
          {/* Null renders as an em dash, never as 0. A score of zero means
              everything is broken; an unmeasured integration is not that. */}
          {health.score ?? '—'}
          {health.score != null && <span className="text-lg text-fg-subtle"> / 100</span>}
        </p>
        <p className="mt-1 text-sm text-fg-muted">{HEALTH_STATUS_LABEL[health.status]}</p>
      </div>

      <div className="min-w-0 flex-1">
        {health.score == null ? (
          <p className="text-sm leading-relaxed text-fg-muted">
            Ainda não há dados suficientes para calcular a saúde do estoque.
          </p>
        ) : health.deductions.length === 0 ? (
          <p className="text-sm leading-relaxed text-fg-muted">
            Nenhum problema identificado nos {health.evaluatedFactors.length} fatores avaliados.
          </p>
        ) : (
          <>
            <p className="text-overline">Principais impactos</p>
            <ul className="mt-2 space-y-1.5">
              {/* Generated from the same pass that computed the score, so the list
                  and the number cannot disagree. */}
              {health.deductions.slice(0, 5).map(deduction => (
                <li key={deduction.factor}>
                  <button
                    type="button"
                    onClick={() => deduction.drillTo && onDrill(deduction.drillTo)}
                    disabled={deduction.drillTo == null}
                    className="group flex w-full items-baseline gap-2 rounded-control py-1 text-left text-sm transition-colors hover:bg-surface-3/60 disabled:pointer-events-none"
                  >
                    <span className="w-12 flex-shrink-0 tabular-nums font-medium text-fg-muted">
                      −{deduction.points}
                    </span>
                    <span className="min-w-0 flex-1 text-fg-muted">{deduction.detail}</span>
                    {deduction.drillTo != null && (
                      <ArrowRight
                        size={13}
                        className="mt-0.5 flex-shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {health.skippedFactors.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
            {health.skippedFactors.length}{' '}
            {health.skippedFactors.length === 1 ? 'fator não pôde ser avaliado' : 'fatores não puderam ser avaliados'}{' '}
            com os dados disponíveis desta integração.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Metric stat ─────────────────────────────────────────────────────────────

/** A KPI that renders a number OR a reason, never a placeholder.
 *
 *  The unavailable branch has no `value` field, so there is nothing to accidentally
 *  render as zero. That is the whole guarantee, enforced by the type rather than by
 *  remembering. */
function MetricStat({
  label,
  metric,
  context,
  criticalWhenPositive,
  onClick,
}: {
  label: string;
  metric: MetricValue<number>;
  context?: string;
  /** Colours the value when it is above zero. Only for figures whose level is
   *  genuinely a condition — negative stock, failed writes. */
  criticalWhenPositive?: boolean;
  onClick?: () => void;
}) {
  if (!isAvailable(metric)) {
    return (
      <div>
        <p className="text-overline">{label}</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-subtle">{UNAVAILABLE_COPY[metric.reason]}</p>
      </div>
    );
  }

  const value = metric.value;
  const tone = criticalWhenPositive && value > 0 ? 'critical' : undefined;

  const stat = (
    <Stat
      label={label}
      value={value.toLocaleString('pt-BR')}
      context={context}
      valueTone={tone}
    />
  );

  // Only clickable when there is something to look at. A drill-down into an empty
  // list is a dead end that teaches the operator the card is broken.
  if (onClick == null || value === 0) return stat;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group -mx-2 -my-1 w-full rounded-control px-2 py-1 text-left transition-colors hover:bg-surface-3/60 min-h-[44px]"
    >
      {stat}
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent">
        Ver detalhes
        <ArrowRight size={11} />
      </span>
    </button>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

const ALERT_ICON_TONE = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-fg-subtle',
} as const;

function AlertsBlock({ alerts, onDrill }: { alerts: InventoryAlert[]; onDrill: (t: DrillTarget) => void }) {
  return (
    <Panel>
      <PanelSection padding="lg">
        <h3 className="text-title">Atenção necessária</h3>
        <p className="text-caption mt-0.5">
          Derivado dos dados sincronizados. Cada item traz a contagem e o que fazer.
        </p>
      </PanelSection>

      <div className="divide-y divide-edge">
        {alerts.map(alert => {
          const Icon = alert.severity === 'info' ? Info : AlertTriangle;
          return (
            <button
              key={alert.id}
              type="button"
              onClick={() => alert.drillTo && onDrill(alert.drillTo)}
              disabled={alert.drillTo == null}
              className="flex w-full items-start gap-3 px-6 py-4 text-left transition-colors hover:bg-surface-3/60 disabled:pointer-events-none"
            >
              <Icon size={15} className={`mt-0.5 flex-shrink-0 ${ALERT_ICON_TONE[alert.severity]}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold text-fg">{alert.title}</p>
                <p className="text-sm leading-relaxed text-fg-muted">{alert.detail}</p>
                <p className="flex items-start gap-1 text-xs text-fg-subtle">
                  <ArrowRight size={12} className="mt-0.5 flex-shrink-0" />
                  {alert.action}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ── Negative stock drill-down ───────────────────────────────────────────────

function NegativeStockDrawer({
  connectionId,
  metrics,
}: {
  connectionId: string | null;
  metrics: InventoryMetrics;
}) {
  const [rows, setRows] = useState<NegativeStockRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const count = useMemo(
    () => (isAvailable(metrics.stock.negativeProducts) ? metrics.stock.negativeProducts.value : 0),
    [metrics.stock.negativeProducts]
  );

  // The list is fetched on demand, not with the snapshot: most sessions never open
  // it, and embedding the rows would make everyone pay for the query.
  useEffect(() => {
    if (count === 0) {
      setRows(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    loadNegativeStock(connectionId, 100)
      .then(result => {
        if (!cancelled) {
          setRows(result);
          setFailure(null);
        }
      })
      .catch(thrown => {
        if (!cancelled) setFailure(thrown instanceof Error ? thrown.message : UNAVAILABLE_COPY.error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, count]);

  if (count === 0) return null;

  return (
    <Panel>
      <PanelSection padding="lg">
        <h3 className="text-title">Produtos com saldo negativo</h3>
        <p className="text-caption mt-0.5">
          Ordenados pelo saldo mais negativo. O depósito indicado é o que concentra o problema.
        </p>
      </PanelSection>

      {loading ? (
        <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
          <Loader2 size={16} className="animate-spin" />
          Carregando produtos…
        </PanelSection>
      ) : failure != null ? (
        <PanelSection className="text-sm text-red-600 dark:text-red-400">{failure}</PanelSection>
      ) : rows == null || rows.length === 0 ? (
        <PanelSection className="text-sm text-fg-muted">
          Nenhum produto retornado para este filtro.
        </PanelSection>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left">
                <th className="px-6 py-3 text-overline font-medium">SKU</th>
                <th className="px-6 py-3 text-overline font-medium">Produto</th>
                <th className="px-6 py-3 text-overline font-medium text-right">Saldo total</th>
                <th className="px-6 py-3 text-overline font-medium">Pior depósito</th>
                <th className="px-6 py-3 text-overline font-medium">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.entityLinkId} className="border-b border-edge/60 last:border-0">
                  <td className="px-6 py-4 font-medium text-fg">{row.sku ?? row.externalId}</td>
                  <td className="px-6 py-4 text-fg-muted">
                    <p className="truncate max-w-xs">{row.productName ?? '—'}</p>
                    {row.ean && <p className="mt-0.5 text-xs text-fg-subtle">EAN {row.ean}</p>}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">
                    {row.totalQuantity}
                  </td>
                  <td className="px-6 py-4 text-fg-muted">
                    {row.worstWarehouse ?? '—'}
                    {row.worstWarehouseQuantity != null && (
                      <span className="ml-1.5 tabular-nums text-fg-subtle">
                        ({row.worstWarehouseQuantity})
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-fg-subtle">
                    {row.observedAt == null
                      ? '—'
                      : describeAge(Date.now() - Date.parse(row.observedAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Shell states ────────────────────────────────────────────────────────────

function LoadingSection() {
  return (
    <Panel>
      <PanelSection padding="lg" className="flex items-center gap-3 text-sm text-fg-muted">
        <Loader2 size={16} className="animate-spin" />
        Consultando a integração…
      </PanelSection>
    </Panel>
  );
}

function ErrorSection({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <PanelSection padding="lg">
        <h3 className="text-title">Estoque no ERP</h3>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{UNAVAILABLE_COPY.error}</p>
        <p className="mt-1 text-xs text-fg-subtle">{message}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw size={14} />
          Tentar novamente
        </Button>
      </PanelSection>
    </Panel>
  );
}

/** The pre-integration state.
 *
 *  Built from the same Panel the populated section uses, so it is the real Dashboard
 *  in an empty state rather than a placeholder screen to be thrown away. Shows no
 *  zeros: there is nothing to count yet, and a wall of 0s would read as a healthy
 *  empty warehouse instead of an absent integration. */
function OnboardingSection({ onConnect }: { onConnect: () => void }) {
  return (
    <Panel>
      <PanelSection padding="lg">
        <div className="flex items-start gap-3">
          <Plug size={18} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <h3 className="text-title">Conecte seu ERP</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">
              Acompanhe saldo negativo, divergências, riscos e sincronização do seu estoque
              diretamente pelo InventoryBlind. Os indicadores desta seção passam a ser calculados a
              partir dos dados reais assim que a primeira sincronização terminar.
            </p>
            <Button className="mt-4" onClick={onConnect}>
              Conectar ERP
            </Button>
          </div>
        </div>
      </PanelSection>
    </Panel>
  );
}
