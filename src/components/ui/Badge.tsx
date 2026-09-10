import type { ReactNode } from 'react';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const VARIANT: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

/** Status/role pill. `success`/`warning`/`danger` are semantic (real meaning), never used decoratively. */
export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${VARIANT[variant]} ${className}`}>
      {children}
    </span>
  );
}
