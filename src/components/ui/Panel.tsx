import type { HTMLAttributes, ReactNode } from 'react';

/** Grouping surface for related blocks (KPIs, table + its header, chart + its legend).
 *  Use PanelSection for internal divisions instead of nesting separate Cards — one
 *  bordered surface with quiet internal dividers reads as one block, not a stack of boxes. */
export function Panel({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-edge bg-surface-2 overflow-hidden ${className}`} {...rest}>
      {children}
    </div>
  );
}

interface PanelSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'sm' | 'md' | 'lg';
}

const PADDING = { sm: 'p-4', md: 'p-5', lg: 'p-7' } as const;

export function PanelSection({ children, padding = 'md', className = '', ...rest }: PanelSectionProps) {
  return (
    <div className={`border-t border-edge first:border-t-0 ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
