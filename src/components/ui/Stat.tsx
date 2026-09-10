import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

export interface StatProps {
  /** Quiet, always-present caption. Never the loudest thing in the block. */
  label: string;
  /** The number itself — the only element allowed to dominate. */
  value: ReactNode;
  /** Optional qualifier under the value ("de 1.240 SKUs", "últimos 30 dias"). */
  context?: string;
  /** Signed delta. `direction` drives the glyph (`flat` for "no movement", so a
   *  steady figure isn't drawn with a misleading arrow); `intent` drives whether
   *  it's coloured. */
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; intent?: 'positive' | 'negative' | 'neutral' };
  /** Small leading glyph, 14–16px. Optional by design — most stats need none. */
  icon?: ReactNode;
  /** Colours the value itself. Reserve for figures whose level genuinely needs
   *  attention (accuracy below target, critical counts) — a value that is merely
   *  present stays `default`, so loud colour keeps its meaning. */
  valueTone?: 'default' | 'positive' | 'warning' | 'critical';
}

const VALUE_TONE = {
  default: 'text-fg',
  positive: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
} as const;

const TREND_TONE = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  neutral: 'text-fg-subtle',
} as const;

/** The single KPI treatment for the whole app (design doc §17: Label → Value →
 *  Context → Trend).
 *
 *  Deliberately not a card: it renders as bare content so a row of stats can
 *  live inside ONE Panel/PanelSection with `divide-x`, instead of N bordered
 *  boxes side by side. It also replaces the two contradictory patterns that had
 *  grown across the app — `text-sm font-semibold` (value indistinguishable from
 *  body text) and `text-2xl…4xl font-bold` (number with no label or context).
 *
 *  Value uses font-display + tabular-nums so digits don't shift width as data
 *  refreshes. Trend color is opt-in: an unspecified `intent` stays neutral,
 *  because "changed" is not the same as "good" or "bad". */
export function Stat({ label, value, context, trend, icon, valueTone = 'default' }: StatProps) {
  const TrendIcon =
    trend?.direction === 'down' ? ArrowDownRight : trend?.direction === 'flat' ? Minus : ArrowUpRight;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className="flex-shrink-0 text-fg-subtle [&>svg]:w-[14px] [&>svg]:h-[14px]">{icon}</span>
        )}
        <p className="text-label truncate">{label}</p>
      </div>

      {/* 24px against a 15px section heading and 13px label — a real step, so
          the number is the first thing read in the panel. */}
      <p
        className={`font-display text-2xl font-semibold tabular-nums tracking-tight mt-1 truncate ${VALUE_TONE[valueTone]}`}
      >
        {value}
      </p>

      {(context || trend) && (
        <div className="flex items-center gap-2 mt-0.5 min-w-0">
          {trend && (
            <span
              className={`flex items-center gap-0.5 text-xs font-medium tabular-nums flex-shrink-0 ${
                TREND_TONE[trend.intent ?? 'neutral']
              }`}
            >
              <TrendIcon size={12} />
              {trend.value}
            </span>
          )}
          {context && <p className="text-caption truncate">{context}</p>}
        </div>
      )}
    </div>
  );
}

/** Row of stats as one grouped surface with hairline internal dividers, per the
 *  "group, don't stack" rule — use this instead of mapping Stat into a plain
 *  grid when the stats belong together. Falls back to divider-less stacking on
 *  narrow screens, where vertical dividers would read as clutter. */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid grid-cols-2 gap-x-6 gap-y-5 lg:flex lg:gap-0 lg:divide-x lg:divide-edge ${className}`}
    >
      {children}
    </div>
  );
}

/** Cell wrapper for StatRow — supplies the horizontal breathing room the
 *  dividers need. First cell keeps flush-left alignment with the panel edge. */
export function StatCell({ children }: { children: ReactNode }) {
  return <div className="min-w-0 lg:flex-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">{children}</div>;
}
