import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALE_AFTER_MS,
  STALE_INTERVAL_MULTIPLIER,
  assessFreshness,
  buildInventoryMetrics,
  connectionsInScope,
  deriveSyncState,
  hasCapability,
  scopeBlocker,
  staleAfterMsFor,
  toConnectionContext,
} from '../analyticsEngine';
import { HEALTH_WEIGHTS, STALE_PENALTY, computeHealthScore, describeAge, statusForScore } from '../healthEngine';
import { ALERT_THRESHOLDS, buildInventoryAlerts } from '../alertEngine';
import { analyzeSnapshot } from '../intelligenceService';
import { isAvailable, valueOr, type InventoryMetrics, type MetricValue } from '../contracts';
import {
  FULL_CAPABILITIES,
  NOW,
  connection,
  failingSyncSnapshot,
  healthySnapshot,
  neverSyncedSnapshot,
  noConnectionSnapshot,
  noCredentialSnapshot,
  providerWithOrdersSnapshot,
  staleSnapshot,
  stuckAdjustmentsSnapshot,
  totalOnlySnapshot,
  troubledSnapshot,
  twoConnectionsSnapshot,
  veryStaleSnapshot,
} from '../__fixtures__/snapshots';

function metricsFor(snapshot: Parameters<typeof analyzeSnapshot>[0], connectionId: string | null = null) {
  return buildInventoryMetrics({ snapshot, connectionId, nowMs: NOW });
}

/** Assert a metric is unavailable for a specific reason. Written as a helper
 *  because "unavailable for the wrong reason" is the failure this whole design is
 *  about — a test that only checked `state === 'unavailable'` would pass while the
 *  UI showed the customer the wrong instruction. */
function expectUnavailable<T>(metric: MetricValue<T>, reason: string) {
  expect(metric).toEqual({ state: 'unavailable', reason });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: no integration
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário SEM ERP', () => {
  const metrics = metricsFor(noConnectionSnapshot());

  it('marca tudo como no_connection em vez de zero', () => {
    // The core requirement: a Dashboard with no integration must not report zero
    // negatives, because it has never looked.
    expectUnavailable(metrics.stock.negativeProducts, 'no_connection');
    expectUnavailable(metrics.stock.zeroProducts, 'no_connection');
    expectUnavailable(metrics.catalog.linkedProducts, 'no_connection');
    expectUnavailable(metrics.discrepancies.open, 'no_connection');
  });

  it('não produz nenhum número disponível', () => {
    const numeric = [
      metrics.stock.negativeProducts,
      metrics.stock.zeroProducts,
      metrics.stock.totalUnits,
      metrics.catalog.linkedProducts,
      metrics.catalog.withoutEan,
      metrics.discrepancies.open,
      metrics.adjustments.pending,
      metrics.openAlerts,
    ];
    expect(numeric.filter(isAvailable)).toHaveLength(0);
  });

  it('reporta sincronização como offline', () => {
    expect(metrics.sync.state).toBe('offline');
  });

  it('não produz score', () => {
    // Null, not zero. Zero means "everything is broken"; an unmeasured integration
    // is not a broken one, and 0/100 would be the most misleading number possible
    // for someone who just signed up.
    const health = computeHealthScore(metrics);
    expect(health.score).toBeNull();
    expect(health.status).toBe('unknown');
    expect(health.evaluatedFactors).toEqual([]);
  });

  it('não produz alerta nenhum', () => {
    // Silence, not "seu estoque parece precisar de atenção".
    expect(buildInventoryAlerts(metrics)).toEqual([]);
  });
});

describe('cenário conexão sem credencial', () => {
  const metrics = metricsFor(noCredentialSnapshot());

  it('distingue falta de credencial de falta de conexão', () => {
    // Different copy and a different next step: one says "connect an ERP", the
    // other says "paste your token".
    expectUnavailable(metrics.stock.negativeProducts, 'no_credential');
  });

  it('reporta offline', () => {
    expect(metrics.sync.state).toBe('offline');
  });
});

describe('cenário credenciado mas nunca sincronizado', () => {
  const metrics = metricsFor(neverSyncedSnapshot());

  it('usa never_synced, não insufficient_data', () => {
    // "Dados insuficientes" would send the customer looking for a data problem
    // when all they need to do is run the first sync.
    expectUnavailable(metrics.stock.negativeProducts, 'never_synced');
    expectUnavailable(metrics.catalog.linkedProducts, 'never_synced');
  });

  it('reporta estado never', () => {
    expect(metrics.sync.state).toBe('never');
  });

  it('não pontua', () => {
    expect(computeHealthScore(metrics).score).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: connected and healthy
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário ERP conectado e saudável', () => {
  const metrics = metricsFor(healthySnapshot());

  it('expõe os números reais do snapshot', () => {
    expect(metrics.catalog.linkedProducts).toMatchObject({ state: 'available', value: 8724 });
    expect(metrics.stock.zeroProducts).toMatchObject({ state: 'available', value: 342 });
    expect(metrics.stock.totalUnits).toMatchObject({ state: 'available', value: 154_320 });
  });

  it('mostra zero negativos como zero DISPONÍVEL', () => {
    // The other half of the requirement. Zero negatives is a real and good result;
    // reporting it as unavailable would make a clean integration look unmeasured.
    expect(metrics.stock.negativeProducts).toMatchObject({ state: 'available', value: 0 });
  });

  it('reporta synced', () => {
    expect(metrics.sync.state).toBe('synced');
  });

  it('pontua alto e sem redutores', () => {
    const health = computeHealthScore(metrics);
    expect(health.score).toBe(100);
    expect(health.status).toBe('excellent');
    expect(health.deductions).toEqual([]);
  });

  it('anexa observedAt aos números de saldo', () => {
    // Freshness travels with the value so a component cannot present a reading as
    // realtime without having the timestamp available to contradict it.
    const negative = metrics.stock.negativeProducts;
    expect(isAvailable(negative) && negative.observedAt).toBe('2026-08-15T11:55:00.000Z');
  });

  it('não gera alerta', () => {
    expect(buildInventoryAlerts(metrics)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: the brief's numbers
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário ERP com 5 negativos, 23 divergências, 41 sem EAN', () => {
  const metrics = metricsFor(troubledSnapshot());

  it('mostra exatamente 5 negativos', () => {
    expect(metrics.stock.negativeProducts).toMatchObject({ state: 'available', value: 5 });
  });

  it('mantém zerado e negativo separados', () => {
    // Merging them would produce 347, a number that answers neither question.
    expect(valueOr(metrics.stock.negativeProducts, -1)).toBe(5);
    expect(valueOr(metrics.stock.zeroProducts, -1)).toBe(342);
  });

  it('reporta depósito negativo sob total positivo separadamente', () => {
    expect(metrics.stock.negativeWarehouseProducts).toMatchObject({ state: 'available', value: 12 });
  });

  it('reduz o score e explica cada redução', () => {
    const health = computeHealthScore(metrics);

    expect(health.score).toBeLessThan(100);
    expect(health.status).not.toBe('excellent');

    const negative = health.deductions.find(d => d.factor === 'negative_stock');
    expect(negative).toBeDefined();
    // 5 × 4 = 20, under the 30 cap.
    expect(negative!.points).toBe(20);
    expect(negative!.detail).toContain('5');
  });

  it('faz as reduções somarem exatamente o score', () => {
    // The property that makes the score arguable: if the listed impacts do not add
    // up to the number, the explanation is decoration.
    const health = computeHealthScore(metrics);
    const total = health.deductions.reduce((sum, d) => sum + d.points, 0);
    expect(health.score).toBe(Math.max(0, Math.round(100 - total)));
  });

  it('ordena as reduções pela maior primeiro', () => {
    const health = computeHealthScore(metrics);
    const points = health.deductions.map(d => d.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it('gera alertas com contagem no título', () => {
    const alerts = buildInventoryAlerts(metrics);
    const negative = alerts.find(a => a.id === 'negative_stock');

    expect(negative).toBeDefined();
    expect(negative!.title).toContain('5');
    expect(negative!.severity).toBe('critical');
    expect(negative!.drillTo).toBe('negative_stock');
    // Actionable: every alert says what to do, not just what happened.
    expect(negative!.action.length).toBeGreaterThan(0);
  });

  it('coloca o crítico antes do informativo', () => {
    const alerts = buildInventoryAlerts(metrics);
    const order = { critical: 0, warning: 1, info: 2 } as const;
    const severities = alerts.map(a => order[a.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it('nunca emite alerta sem número quando a métrica é contável', () => {
    // The rule: no count, no alert. Stale data is the one state-based exception and
    // it carries 0 by design.
    const alerts = buildInventoryAlerts(metrics).filter(a => a.id !== 'stale_data');
    for (const alert of alerts) {
      expect(alert.count).toBeGreaterThan(0);
      expect(alert.title).toMatch(/\d/);
    }
  });
});

describe('cenário ERP com 0 negativos', () => {
  it('mostra 0 e não gera alerta de negativo', () => {
    const metrics = metricsFor(healthySnapshot());
    expect(metrics.stock.negativeProducts).toMatchObject({ state: 'available', value: 0 });
    expect(buildInventoryAlerts(metrics).some(a => a.id === 'negative_stock')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário provider sem depósitos', () => {
  const metrics = metricsFor(totalOnlySnapshot());

  it('esconde métricas por depósito em vez de reportar zero', () => {
    // Reporting zero would assert that a negative deposit never happens at this
    // provider, which the data cannot support — it simply is not visible.
    expectUnavailable(metrics.stock.negativeWarehouseProducts, 'capability_missing');
    expectUnavailable(metrics.stock.withoutWarehouse, 'capability_missing');
  });

  it('mantém o saldo total disponível', () => {
    expect(metrics.stock.negativeProducts).toMatchObject({ state: 'available', value: 5 });
  });

  it('esconde reservado quando o provider não fornece', () => {
    expectUnavailable(metrics.stock.reservedUnits, 'capability_missing');
  });

  it('não penaliza o score pelo que o provider não fornece', () => {
    // A provider that never claimed to report deposits must not lose points for
    // deposits. The factor is skipped, with the reason recorded.
    const health = computeHealthScore(metrics);

    expect(health.deductions.some(d => d.factor === 'negative_warehouse')).toBe(false);
    expect(health.deductions.some(d => d.factor === 'missing_warehouse')).toBe(false);
    expect(health.skippedFactors.map(s => s.factor)).toContain('negative_warehouse');
    expect(health.skippedFactors.find(s => s.factor === 'negative_warehouse')?.reason).toBe(
      'capability_missing'
    );
  });

  it('reporta quais fatores foram avaliados', () => {
    // An incomplete score must not pose as a complete one.
    const health = computeHealthScore(metrics);
    expect(health.evaluatedFactors.length).toBeGreaterThan(0);
    expect(health.skippedFactors.length).toBeGreaterThan(0);
    expect(health.evaluatedFactors).not.toContain('negative_warehouse');
  });

  it('não gera alerta de depósito', () => {
    const alerts = buildInventoryAlerts(metrics);
    expect(alerts.some(a => a.id === 'negative_warehouse')).toBe(false);
    expect(alerts.some(a => a.id === 'missing_warehouse')).toBe(false);
  });
});

describe('cenário provider sem orders', () => {
  it('não mostra vendas afetadas', () => {
    const metrics = metricsFor(healthySnapshot());
    expectUnavailable(metrics.activity.potentiallyAffectedSales, 'capability_missing');
  });

  it('distingue "provider não fornece" de "não guardamos ainda"', () => {
    // A provider WITH read_orders still cannot populate a table that does not
    // exist. Saying capability_missing there would blame the provider for our gap,
    // and hide work we owe.
    const withOrders = metricsFor(providerWithOrdersSnapshot());
    expectUnavailable(withOrders.activity.potentiallyAffectedSales, 'not_stored');
    expectUnavailable(withOrders.activity.movements, 'not_stored');

    const without = metricsFor(healthySnapshot());
    expectUnavailable(without.activity.movements, 'capability_missing');
  });
});

describe('estoque mínimo não configurado', () => {
  it('não inventa um limite', () => {
    // Inventing a threshold would produce alarm about a rule nobody set.
    const metrics = metricsFor(healthySnapshot());
    expectUnavailable(metrics.stock.belowMinimum, 'not_configured');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: staleness
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário sync atrasado', () => {
  it('marca como stale contra o intervalo da conexão', () => {
    const metrics = metricsFor(staleSnapshot());
    expect(metrics.sync.freshness.state).toBe('stale');
    expect(metrics.sync.state).toBe('warning');
  });

  it('marca como very_stale depois de 6 h', () => {
    const metrics = metricsFor(veryStaleSnapshot());
    expect(metrics.sync.freshness.state).toBe('very_stale');
  });

  it('continua mostrando os números, com o aviso', () => {
    // Stale data is still data. Hiding it would be as wrong as presenting it as
    // current — the fix is the warning, not the blank.
    const metrics = metricsFor(staleSnapshot());
    expect(metrics.stock.negativeProducts.state).toBe('available');
    expect(buildInventoryAlerts(metrics).some(a => a.id === 'stale_data')).toBe(true);
  });

  it('cobra o redutor de stale como valor fixo', () => {
    const stale = computeHealthScore(metricsFor(staleSnapshot()));
    const veryStale = computeHealthScore(metricsFor(veryStaleSnapshot()));

    expect(stale.deductions.find(d => d.factor === 'stale_data')?.points).toBe(STALE_PENALTY.stale);
    expect(veryStale.deductions.find(d => d.factor === 'stale_data')?.points).toBe(
      STALE_PENALTY.very_stale
    );
  });

  it('tolera atraso de um ciclo sem marcar stale', () => {
    // A 15-minute scheduler is routinely 16 minutes late. Warning about that would
    // train the operator to ignore the warning.
    const conn = toConnectionContext(connection({ sync_interval_minutes: 15 }));
    const oneCycleLate = new Date(NOW - 16 * 60 * 1000).toISOString();
    expect(assessFreshness(oneCycleLate, [conn], NOW).state).toBe('fresh');
  });

  it('usa o múltiplo do intervalo como janela', () => {
    const conn = toConnectionContext(connection({ sync_interval_minutes: 10 }));
    expect(staleAfterMsFor([conn])).toBe(10 * 60 * 1000 * STALE_INTERVAL_MULTIPLIER);
  });

  it('usa a janela padrão sem intervalo configurado', () => {
    const conn = toConnectionContext(connection({ sync_interval_minutes: null }));
    expect(staleAfterMsFor([conn])).toBe(DEFAULT_STALE_AFTER_MS);
  });

  it('trata timestamp ilegível como unknown, nunca fresh', () => {
    // Presenting data of unknown age as current is the failure mode.
    const conn = toConnectionContext(connection());
    expect(assessFreshness('não é data', [conn], NOW).state).toBe('unknown');
  });

  it('não trata relógio adiantado do provedor como extra-fresco', () => {
    const conn = toConnectionContext(connection());
    const future = new Date(NOW + 60_000).toISOString();
    const freshness = assessFreshness(future, [conn], NOW);
    expect(freshness.ageMs).toBe(0);
    expect(freshness.state).toBe('fresh');
  });

  it('não pontua stale quando o frescor é desconhecido', () => {
    // Inventing a penalty from ignorance would make the score unexplainable.
    const metrics = metricsFor({
      ...healthySnapshot(),
      stock: { ...healthySnapshot().stock!, newest_observed_at: 'inválido' },
    });
    const health = computeHealthScore(metrics);
    expect(health.deductions.some(d => d.factor === 'stale_data')).toBe(false);
    expect(health.skippedFactors.map(s => s.factor)).toContain('stale_data');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: sync failures
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário sincronização com falha', () => {
  const metrics = metricsFor(failingSyncSnapshot());

  it('reporta erro', () => {
    expect(metrics.sync.state).toBe('error');
  });

  it('gera alerta crítico que avisa que os outros números envelheceram', () => {
    const alert = buildInventoryAlerts(metrics).find(a => a.id === 'sync_failures');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
    expect(alert!.title).toContain('3');
  });

  it('cobra 8 por falha até o teto', () => {
    const health = computeHealthScore(metrics);
    const deduction = health.deductions.find(d => d.factor === 'sync_failures');
    // 3 × 8 = 24, exactly the cap.
    expect(deduction!.points).toBe(HEALTH_WEIGHTS.sync_failures.max);
  });

  it('prioriza credencial revogada sobre sync em andamento', () => {
    // A running sync against a revoked credential is going to fail; showing
    // 'syncing' would have the operator waiting for a result that cannot arrive.
    const revoked = toConnectionContext(connection({ status: 'revoked' }));
    const state = deriveSyncState(
      { ...healthySnapshot().sync!, running: 1 },
      [revoked],
      { state: 'fresh', observedAt: null, ageMs: 0, staleAfterMs: 1000 }
    );
    expect(state).toBe('offline');
  });

  it('reporta syncing quando há execução em andamento', () => {
    const conn = toConnectionContext(connection());
    const state = deriveSyncState(
      { ...healthySnapshot().sync!, running: 1 },
      [conn],
      { state: 'fresh', observedAt: null, ageMs: 0, staleAfterMs: 1000 }
    );
    expect(state).toBe('syncing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: adjustments
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário ajustes travados', () => {
  const metrics = metricsFor(stuckAdjustmentsSnapshot());

  it('separa pendente, falho e aguardando aprovação', () => {
    expect(valueOr(metrics.adjustments.pending, -1)).toBe(7);
    expect(valueOr(metrics.adjustments.failed, -1)).toBe(3);
    expect(valueOr(metrics.adjustments.awaitingApproval, -1)).toBe(4);
  });

  it('trata falha de envio como crítico', () => {
    // Someone approved the correction and the ERP never got it — the ERP is
    // knowingly wrong.
    const alert = buildInventoryAlerts(metrics).find(a => a.id === 'failed_adjustments');
    expect(alert?.severity).toBe('critical');
  });

  it('trata pendente como informativo', () => {
    // A draining queue is the normal state; this exists so an approved correction
    // does not sit unnoticed, not to demand action now.
    const alert = buildInventoryAlerts(metrics).find(a => a.id === 'pending_adjustments');
    expect(alert?.severity).toBe('info');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: multiple connections
// ─────────────────────────────────────────────────────────────────────────────

describe('cenário duas conexões', () => {
  const snapshot = twoConnectionsSnapshot();

  it('a visão consolidada cobre as duas', () => {
    const metrics = metricsFor(snapshot, null);
    expect(metrics.scope.connections).toHaveLength(2);
    expect(connectionsInScope(metrics.scope)).toHaveLength(2);
  });

  it('o filtro restringe a uma', () => {
    const metrics = metricsFor(snapshot, 'conn-2');
    expect(connectionsInScope(metrics.scope)).toHaveLength(1);
    expect(connectionsInScope(metrics.scope)[0].providerKey).toBe('mercado_livre');
  });

  it('capability é OR na consolidada e restrita no filtro', () => {
    // Any rather than all: in a consolidated view over an ERP that reports deposits
    // and a marketplace that does not, deposit metrics still describe the ERP's
    // share. Requiring all would blank a metric because of a connection that was
    // never going to contribute.
    const all = metricsFor(snapshot, null);
    const marketplaceOnly = metricsFor(snapshot, 'conn-2');

    expect(hasCapability(all.scope, 'read_stock_by_warehouse')).toBe(true);
    expect(hasCapability(marketplaceOnly.scope, 'read_stock_by_warehouse')).toBe(false);

    expect(all.stock.negativeWarehouseProducts.state).toBe('available');
    expectUnavailable(marketplaceOnly.stock.negativeWarehouseProducts, 'capability_missing');
  });

  it('usa a janela de stale mais permissiva na consolidada', () => {
    // The strictest window would mark a consolidated view stale because of one
    // fast-cycling connection, which says nothing about the rest.
    const metrics = metricsFor(snapshot, null);
    expect(metrics.sync.freshness.staleAfterMs).toBe(60 * 60 * 1000 * STALE_INTERVAL_MULTIPLIER);
  });

  it('devolve estado de conexão inexistente quando o filtro não resolve', () => {
    const metrics = metricsFor(snapshot, 'conn-inexistente');
    expect(connectionsInScope(metrics.scope)).toHaveLength(0);
    expectUnavailable(metrics.stock.negativeProducts, 'no_connection');
  });
});

describe('isolamento de tenant', () => {
  it('trata connection_found: false como sem conexão', () => {
    // The RPC answers this for a connection id belonging to another company —
    // identical to a nonexistent one, so probing reveals nothing. The client side
    // must not turn that into numbers.
    const metrics = metricsFor({ company_scoped: true, connection_found: false }, 'conn-de-outra-empresa');
    expectUnavailable(metrics.stock.negativeProducts, 'no_connection');
    expect(computeHealthScore(metrics).score).toBeNull();
  });

  it('trata company_scoped: false como sem conexão', () => {
    const metrics = metricsFor({ company_scoped: false });
    expectUnavailable(metrics.catalog.linkedProducts, 'no_connection');
    expect(buildInventoryAlerts(metrics)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Insufficient data
// ─────────────────────────────────────────────────────────────────────────────

describe('dados insuficientes', () => {
  it('não conta "0 sem EAN" quando nada foi vinculado', () => {
    // True and useless: nothing has been linked to check.
    const snapshot = {
      ...healthySnapshot(),
      catalog: { linked_products: 0, without_ean: 0, without_sku: 0, auto_matched: 0, last_linked_at: null },
    };
    expectUnavailable(metricsFor(snapshot).catalog.withoutEan, 'insufficient_data');
  });

  it('não conta "0 negativos" quando não há linha de saldo', () => {
    // Zero stock rows is not "no negative stock", it is "no reading".
    const base = healthySnapshot();
    const snapshot = {
      ...base,
      stock: { ...base.stock!, products_with_stock_rows: 0, negative_products: 0, zero_products: 0 },
    };
    expectUnavailable(metricsFor(snapshot).stock.negativeProducts, 'insufficient_data');
  });

  it('prioriza capability sobre falta de base', () => {
    // For a provider that does not report stock at all, capability_missing is the
    // truthful reason — insufficient_data would send the operator hunting a sync
    // problem instead of telling them the provider does not report it.
    const base = healthySnapshot();
    const snapshot = {
      ...base,
      connections: [connection({ capabilities: { read_products: true } })],
      stock: { ...base.stock!, products_with_stock_rows: 0 },
    };
    expectUnavailable(metricsFor(snapshot).stock.negativeProducts, 'capability_missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Health score mechanics
// ─────────────────────────────────────────────────────────────────────────────

describe('mecânica do Health Score', () => {
  it('aplica o teto por fator', () => {
    // Without caps, 400 missing EANs would zero the score and a cataloguing problem
    // would be indistinguishable from an ERP actively overselling.
    const base = troubledSnapshot();
    const snapshot = { ...base, catalog: { ...base.catalog!, without_ean: 5000 } };
    const health = computeHealthScore(metricsFor(snapshot));

    expect(health.deductions.find(d => d.factor === 'missing_ean')!.points).toBe(
      HEALTH_WEIGHTS.missing_ean.max
    );
  });

  it('nunca desce abaixo de zero', () => {
    const base = troubledSnapshot();
    const catastrophic = {
      ...base,
      catalog: { ...base.catalog!, without_ean: 9999 },
      stock: {
        ...base.stock!,
        negative_products: 9999,
        products_with_negative_warehouse: 9999,
        products_without_warehouse: 9999,
      },
      discrepancies: { ...base.discrepancies!, open: 9999 },
      sync: { ...base.sync!, failed_recent: 99 },
      adjustments: { ...base.adjustments!, failed: 999 },
    };
    const health = computeHealthScore(metricsFor(catastrophic));

    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.status).toBe('critical');
  });

  it('toda redução carrega label, detalhe e destino', () => {
    // An explanation without a destination is a dead end; one without a detail is
    // an assertion.
    const health = computeHealthScore(metricsFor(troubledSnapshot()));
    expect(health.deductions.length).toBeGreaterThan(0);

    for (const deduction of health.deductions) {
      expect(deduction.label.length).toBeGreaterThan(0);
      expect(deduction.detail.length).toBeGreaterThan(0);
      expect(deduction.points).toBeGreaterThan(0);
      expect(deduction.drillTo).not.toBeNull();
    }
  });

  it('mapeia score para faixa', () => {
    expect(statusForScore(100)).toBe('excellent');
    expect(statusForScore(90)).toBe('excellent');
    expect(statusForScore(89)).toBe('healthy');
    expect(statusForScore(75)).toBe('healthy');
    expect(statusForScore(74)).toBe('warning');
    expect(statusForScore(50)).toBe('warning');
    expect(statusForScore(49)).toBe('critical');
    expect(statusForScore(0)).toBe('critical');
    expect(statusForScore(null)).toBe('unknown');
  });

  it('é determinístico', () => {
    // Same input, same score. The property that lets an operator reproduce it.
    const metrics = metricsFor(troubledSnapshot());
    const first = computeHealthScore(metrics);
    const second = computeHealthScore(metrics);
    expect(first).toEqual(second);
  });

  it('conta um fator com zero como avaliado, não como ignorado', () => {
    // A clean integration must not look as unmeasured as a broken one.
    const health = computeHealthScore(metricsFor(healthySnapshot()));
    expect(health.evaluatedFactors).toContain('negative_stock');
    expect(health.skippedFactors.some(s => s.factor === 'negative_stock')).toBe(false);
  });
});

describe('describeAge', () => {
  it.each([
    [null, 'em momento desconhecido'],
    [30_000, 'agora mesmo'],
    [60_000, 'há 1 minuto'],
    [4 * 60_000, 'há 4 minutos'],
    [60 * 60_000, 'há 1 hora'],
    [2 * 60 * 60_000, 'há 2 horas'],
    [24 * 60 * 60_000, 'há 1 dia'],
    [3 * 24 * 60 * 60_000, 'há 3 dias'],
  ])('formata %p como %s', (ageMs, expected) => {
    expect(describeAge(ageMs as number | null)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The integration-readiness proof
// ─────────────────────────────────────────────────────────────────────────────

describe('provider hipotético alimenta a camada de inteligência', () => {
  // The point of the whole phase: when a real API connects, it fills the normalized
  // contract and no engine changes. These tests demonstrate it by feeding the
  // pipeline from a provider that does not exist.

  it('um provider desconhecido produz métricas, score e alertas', () => {
    const snapshot = {
      ...troubledSnapshot(),
      connections: [
        connection({
          id: 'conn-futuro',
          // Not Tiny, not Bling, not anything implemented. Nothing in the engines
          // branches on this string.
          provider_key: 'erp_que_ainda_nao_existe',
          display_name: 'ERP Futuro',
          capabilities: FULL_CAPABILITIES,
        }),
      ],
    };

    const result = analyzeSnapshot(snapshot, { nowMs: NOW });

    expect(result.metrics.stock.negativeProducts).toMatchObject({ state: 'available', value: 5 });
    expect(result.health.score).toBeGreaterThan(0);
    expect(result.health.score).toBeLessThan(100);
    expect(result.alerts.some(a => a.id === 'negative_stock')).toBe(true);
  });

  it('o provider key nunca muda o resultado', () => {
    // Provider-agnostic, proven rather than asserted: identical data under three
    // different provider keys must produce identical intelligence.
    const shape = troubledSnapshot();

    const results = ['tiny', 'bling', 'sap'].map(providerKey =>
      analyzeSnapshot(
        { ...shape, connections: [connection({ provider_key: providerKey })] },
        { nowMs: NOW }
      )
    );

    expect(results[0].health.score).toBe(results[1].health.score);
    expect(results[1].health.score).toBe(results[2].health.score);
    expect(results[0].alerts.map(a => a.id)).toEqual(results[2].alerts.map(a => a.id));
  });

  it('capabilities, não o provider, decidem o que aparece', () => {
    const shape = troubledSnapshot();

    const rich = analyzeSnapshot(
      { ...shape, connections: [connection({ provider_key: 'sap', capabilities: FULL_CAPABILITIES })] },
      { nowMs: NOW }
    );
    const poor = analyzeSnapshot(
      { ...shape, connections: [connection({ provider_key: 'sap', capabilities: { read_stock: true } })] },
      { nowMs: NOW }
    );

    expect(rich.metrics.stock.negativeWarehouseProducts.state).toBe('available');
    expect(poor.metrics.stock.negativeWarehouseProducts.state).toBe('unavailable');
    // Same provider key, different capabilities, different result.
    expect(rich.metrics.catalog.withoutEan.state).not.toBe(poor.metrics.catalog.withoutEan.state);
  });

  it('analyzeSnapshot compõe os três engines', () => {
    const result = analyzeSnapshot(troubledSnapshot(), { nowMs: NOW });
    expect(result.metrics).toBeDefined();
    expect(result.health).toBeDefined();
    expect(result.alerts).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract guarantees
// ─────────────────────────────────────────────────────────────────────────────

describe('garantias do contrato', () => {
  it('scopeBlocker ordena do mais fundamental ao menos', () => {
    // Reporting "insufficient data" to someone who has connected nothing sends them
    // looking for a problem they do not have.
    expect(scopeBlocker({ connectionId: null, connections: [] })).toBe('no_connection');
    expect(
      scopeBlocker({
        connectionId: null,
        connections: [toConnectionContext(connection({ credentials_set_at: null }))],
      })
    ).toBe('no_credential');
    // Credential present, never synced: past the credential gate, stopped by the
    // sync gate. The distinction matters — one says "paste your token", the other
    // says "run the first sync".
    expect(
      scopeBlocker({
        connectionId: null,
        connections: [toConnectionContext(connection({ last_sync_at: null }))],
      })
    ).toBe('never_synced');
  });

  it('scopeBlocker libera uma conexão pronta', () => {
    expect(
      scopeBlocker({ connectionId: null, connections: [toConnectionContext(connection())] })
    ).toBeNull();
  });

  it('toda métrica é união discriminada, nunca número nu', () => {
    // The mechanism behind "never lie": a component has to narrow before it can
    // reach a number, and the unavailable branch has none.
    const metrics: InventoryMetrics = metricsFor(troubledSnapshot());

    const all = [
      metrics.stock.negativeProducts,
      metrics.stock.zeroProducts,
      metrics.stock.belowMinimum,
      metrics.catalog.withoutEan,
      metrics.activity.movements,
      metrics.activity.potentiallyAffectedSales,
    ];

    for (const metric of all) {
      expect(metric.state === 'available' || metric.state === 'unavailable').toBe(true);
      if (metric.state === 'unavailable') {
        expect(metric).not.toHaveProperty('value');
      }
    }
  });

  it('os limiares de alerta são os que a cópia implica', () => {
    expect(ALERT_THRESHOLDS.negativeStock).toBe(1);
    expect(ALERT_THRESHOLDS.failedAdjustments).toBe(1);
    expect(ALERT_THRESHOLDS.discrepancies).toBeGreaterThan(1);
  });
});
