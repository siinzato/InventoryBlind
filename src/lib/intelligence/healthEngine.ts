// Health Engine — metrics into a score somebody can argue with.
//
// Pure. Takes what the Analytics Engine measured and says how bad it is.
//
// ── Why the explanation is generated, not written ───────────────────────────
// Every deduction carries the points it cost and the observation that caused it,
// produced by the same pass that computes the score. So the "principais impactos"
// list cannot drift from the number it explains. A hand-maintained list of reasons
// beside a separately-computed score is the standard way a health score becomes
// folklore: the number moves, the explanation does not, and nobody trusts either.
//
// ── Why there is no model in here ───────────────────────────────────────────
// The score is a weighted sum of counted observations, capped per factor. Nothing
// is learned, inferred or predicted. An operator asking "why is it 82?" gets an
// arithmetic answer. A score nobody can reproduce is a score nobody acts on, and
// dressing this up as intelligence would trade the one property that makes it
// useful for the appearance of sophistication.
//
// ── Only what was measured counts ───────────────────────────────────────────
// A factor whose metric is unavailable is SKIPPED, never scored as zero and never
// scored as bad. A provider that does not report deposits must not lose points for
// deposits — it would be punished for data it never claimed to have. Skipped
// factors are reported so an incomplete score cannot pose as a complete one.

import {
  isAvailable,
  type HealthDeduction,
  type HealthFactorKey,
  type HealthScore,
  type HealthStatus,
  type InventoryMetrics,
  type MetricValue,
  type UnavailableReason,
} from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Weights
//
// Documented per factor, exported so tests pin the same numbers the UI explains.
//
// `perUnit` is the cost of one occurrence; `max` caps the factor's total damage.
// The caps are what keep the score readable: without them, 400 products missing an
// EAN would zero the score, and a catalogue-quality problem would be
// indistinguishable from an ERP that is actively selling stock it does not have.
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthWeight {
  label: string;
  perUnit: number;
  max: number;
}

export const HEALTH_WEIGHTS: Record<HealthFactorKey, HealthWeight> = {
  /** The most expensive factor per unit. A negative balance is a balance the ERP
   *  is publishing to marketplaces, so each one is a live overselling risk — the
   *  exact failure that gets orders cancelled. */
  negative_stock: { label: 'Estoque negativo', perUnit: 4, max: 30 },

  /** A negative deposit under a healthy total. Real, but not yet costing sales:
   *  the company does own the units, they are recorded in the wrong place. */
  negative_warehouse: { label: 'Depósito com saldo negativo', perUnit: 1.5, max: 12 },

  /** ERP and InventoryBlind disagree. Each one is a balance nobody has decided
   *  the truth about yet. */
  discrepancies: { label: 'Divergências não resolvidas', perUnit: 0.8, max: 20 },

  /** A failing integration means every other number here is suspect, which is why
   *  a single failure already costs 8 and three max it out. */
  sync_failures: { label: 'Falhas de sincronização', perUnit: 8, max: 24 },

  /** Not per-unit — staleness is a state, not a count. Applied as a flat charge by
   *  severity below. */
  stale_data: { label: 'Dados desatualizados', perUnit: 0, max: 15 },

  /** Cataloguing quality. Cheap per unit and capped low: a missing EAN slows
   *  conferência, it does not put stock at risk. */
  missing_ean: { label: 'Produtos sem EAN', perUnit: 0.15, max: 8 },

  missing_warehouse: { label: 'Produtos sem depósito', perUnit: 0.2, max: 8 },

  /** An adjustment that failed to reach the ERP means a correction someone already
   *  approved is not in effect — the ERP is knowingly wrong. */
  failed_adjustments: { label: 'Ajustes com falha no envio', perUnit: 3, max: 15 },
};

/** Flat charges for staleness. A state, not a count: data three hours old is not
 *  "three times" anything. */
export const STALE_PENALTY = { stale: 6, very_stale: 15 } as const;

/** Score bands. `critical` starts at 50 because below that the integration is not
 *  merely unhealthy — the numbers should not be acted on without checking. */
export const HEALTH_BANDS = { excellent: 90, healthy: 75, warning: 50 } as const;

export function statusForScore(score: number | null): HealthStatus {
  if (score == null) return 'unknown';
  if (score >= HEALTH_BANDS.excellent) return 'excellent';
  if (score >= HEALTH_BANDS.healthy) return 'healthy';
  if (score >= HEALTH_BANDS.warning) return 'warning';
  return 'critical';
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

interface FactorOutcome {
  deduction: HealthDeduction | null;
  skipped: { factor: HealthFactorKey; reason: UnavailableReason } | null;
}

/** Score one counted factor.
 *
 *  Unavailable metric → skipped. Zero count → evaluated, no deduction: that is a
 *  genuinely good result and it has to count as one, otherwise a clean integration
 *  would look as unmeasured as a broken one. */
function countedFactor(
  factor: HealthFactorKey,
  metric: MetricValue<number>,
  describe: (count: number) => string,
  drillTo: HealthDeduction['drillTo']
): FactorOutcome {
  if (!isAvailable(metric)) {
    return { deduction: null, skipped: { factor, reason: metric.reason } };
  }

  const count = metric.value;
  if (count <= 0) return { deduction: null, skipped: null };

  const weight = HEALTH_WEIGHTS[factor];
  // Rounded to one decimal so the displayed deductions sum to the displayed score.
  // Unrounded floats make a 82 explained by -5.03 and -4.97 look like it should
  // be 82.1, and the arithmetic stops checking out.
  const points = round1(Math.min(weight.max, count * weight.perUnit));

  return {
    deduction: {
      factor,
      label: weight.label,
      points,
      detail: describe(count),
      drillTo,
    },
    skipped: null,
  };
}

export function computeHealthScore(metrics: InventoryMetrics): HealthScore {
  const outcomes: FactorOutcome[] = [
    countedFactor(
      'negative_stock',
      metrics.stock.negativeProducts,
      count => `${count} ${plural(count, 'SKU', 'SKUs')} com saldo total negativo`,
      'negative_stock'
    ),
    countedFactor(
      'negative_warehouse',
      metrics.stock.negativeWarehouseProducts,
      count => `${count} ${plural(count, 'produto', 'produtos')} com depósito negativo apesar do total positivo`,
      'negative_stock'
    ),
    countedFactor(
      'discrepancies',
      metrics.discrepancies.open,
      count => `${count} ${plural(count, 'divergência', 'divergências')} entre ERP e InventoryBlind`,
      'discrepancies'
    ),
    countedFactor(
      'sync_failures',
      metrics.sync.failedRecent,
      count => `${count} ${plural(count, 'falha', 'falhas')} de sincronização nas últimas 24 h`,
      'sync_log'
    ),
    countedFactor(
      'missing_ean',
      metrics.catalog.withoutEan,
      count => `${count} ${plural(count, 'produto', 'produtos')} sem EAN`,
      'missing_ean'
    ),
    countedFactor(
      'missing_warehouse',
      metrics.stock.withoutWarehouse,
      count => `${count} ${plural(count, 'produto', 'produtos')} sem depósito identificado`,
      'missing_warehouse'
    ),
    countedFactor(
      'failed_adjustments',
      metrics.adjustments.failed,
      count => `${count} ${plural(count, 'ajuste', 'ajustes')} não ${plural(count, 'enviado', 'enviados')} ao ERP`,
      'adjustment_queue'
    ),
    staleFactor(metrics),
  ];

  const deductions = outcomes
    .map(o => o.deduction)
    .filter((d): d is HealthDeduction => d != null)
    // Heaviest first: the explanation should open with what actually moved the
    // number, not with whatever happened to be evaluated first.
    .sort((a, b) => b.points - a.points);

  const skippedFactors = outcomes.map(o => o.skipped).filter((s): s is NonNullable<typeof s> => s != null);

  const evaluatedFactors = ALL_FACTORS.filter(f => !skippedFactors.some(s => s.factor === f));

  // Nothing measurable → no score. Null, not zero: zero means "everything is
  // broken" and an unmeasured integration is not a broken one. Presenting 0/100 to
  // a customer who just connected would be the most misleading number on the page.
  if (evaluatedFactors.length === 0) {
    return { status: 'unknown', score: null, deductions: [], evaluatedFactors: [], skippedFactors };
  }

  const totalDeduction = deductions.reduce((sum, d) => sum + d.points, 0);
  // Floored at zero and rounded to an integer — a score is a whole number to the
  // reader, while the deductions keep their decimal so they still sum correctly.
  const score = Math.max(0, Math.round(100 - totalDeduction));

  return {
    status: statusForScore(score),
    score,
    deductions,
    evaluatedFactors,
    skippedFactors,
  };
}

const ALL_FACTORS = Object.keys(HEALTH_WEIGHTS) as HealthFactorKey[];

/** Staleness, charged flat by severity.
 *
 *  `unknown` freshness is skipped rather than charged: we do not know the data is
 *  old, only that we cannot tell, and inventing a penalty from ignorance would make
 *  the score unexplainable. `never_synced` is also skipped — the analytics layer
 *  already blocks every metric in that case, so there is nothing for staleness to
 *  qualify. */
function staleFactor(metrics: InventoryMetrics): FactorOutcome {
  const { state, ageMs } = metrics.sync.freshness;

  if (state === 'fresh') return { deduction: null, skipped: null };

  if (state === 'unknown' || state === 'never_synced') {
    return { deduction: null, skipped: { factor: 'stale_data', reason: 'insufficient_data' } };
  }

  const points = state === 'very_stale' ? STALE_PENALTY.very_stale : STALE_PENALTY.stale;

  return {
    deduction: {
      factor: 'stale_data',
      label: HEALTH_WEIGHTS.stale_data.label,
      points,
      detail: `Última leitura do provedor ${describeAge(ageMs)}`,
      drillTo: 'sync_log',
    },
    skipped: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Relative age in Portuguese. Exported because the same phrasing has to appear on
 *  the sync card and inside a deduction — two spellings of the same age read as
 *  two different facts. */
export function describeAge(ageMs: number | null): string {
  if (ageMs == null) return 'em momento desconhecido';

  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} ${plural(minutes, 'minuto', 'minutos')}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${plural(hours, 'hora', 'horas')}`;

  const days = Math.floor(hours / 24);
  return `há ${days} ${plural(days, 'dia', 'dias')}`;
}
