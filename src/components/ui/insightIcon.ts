import {
  AlertTriangle, Flame, Footprints, Info, Package, Target, TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type InsightSeverity = 'info' | 'warning' | 'critical';

/** Emoji → lucide, resolved at the render layer.
 *
 *  `blindAIInsightsEngine` and `warehouseInsightsEngine` both emit an `icon`
 *  string holding an emoji. Rewriting those values would mean editing insight
 *  algorithm files for a purely visual reason, which the Stability Principle
 *  rules out — so the mapping lives here, on the way to the screen, and both
 *  engines stay byte-for-byte untouched.
 *
 *  Anything unrecognised falls back to a severity-appropriate glyph, so a new
 *  emoji added to an engine later can never leak an emoji into the UI. */
const ICON_BY_EMOJI: Record<string, LucideIcon> = {
  '🔥': Flame,
  '🚶': Footprints,
  '📦': Package,
  '⚠️': AlertTriangle,
  '⚠': AlertTriangle,
  '🎯': Target,
  '📊': TrendingUp,
  '📈': TrendingUp,
};

const FALLBACK_ICON: Record<InsightSeverity, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

export function resolveInsightIcon(icon: string | undefined, severity: InsightSeverity): LucideIcon {
  return ICON_BY_EMOJI[icon?.trim() ?? ''] ?? FALLBACK_ICON[severity];
}

/** Icon tint by severity. The title itself stays `text-fg` at every call site:
 *  the icon plus the Badge already carry the severity, and colouring all three
 *  repeated the same signal three times. */
export const INSIGHT_ICON_TONE: Record<InsightSeverity, string> = {
  info: 'text-fg-subtle',
  warning: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
};
