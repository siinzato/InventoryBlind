// Shared, non-animation helpers for the landing/ section components.
// Mirrors the role src/components/nfe/nfeUi.tsx plays for the nfe/ feature folder.

import type { LucideIcon } from 'lucide-react';

export const WHATSAPP_PLANS_URL = 'https://wa.me/5511999999999?text=Quero+conhecer+os+planos+do+InventoryBlind';

export interface ModuleCard {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface StoryStep {
  n: string;
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface KpiStat {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
}

interface LogoProps {
  size?: number;
  className?: string;
}

/** The new navy "Blind Grid" app-icon mark + wordmark, replacing the old BarChart3 badge. */
export function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src="/apple-touch-icon.png"
      alt="InventoryBlind"
      width={size}
      height={size}
      className={`rounded-lg flex-shrink-0 ${className}`}
    />
  );
}

/**
 * Monochrome (currentColor) "Blind Grid" mark for use inside an existing
 * colored badge — e.g. AuthPage's emerald square, which previously held a
 * white BarChart3 icon. Same 4-bar + scan-line geometry as public/icon-mark.svg,
 * traced to currentColor so it tints like any lucide icon would.
 */
export function LogoMark({ size = 20, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="InventoryBlind"
    >
      <rect x="10" y="20" width="14" height="60" rx="3" />
      <rect x="34" y="20" width="14" height="60" rx="3" />
      <rect x="58" y="20" width="14" height="60" rx="3" />
      <rect x="82" y="20" width="14" height="60" rx="3" />
      <rect x="4" y="46" width="92" height="6" rx="3" />
    </svg>
  );
}
