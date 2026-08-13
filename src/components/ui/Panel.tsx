import type { HTMLAttributes, ReactNode } from 'react';

/** Grouping surface for related blocks (KPIs, table + its header, chart + its legend).
 *  Use PanelSection for internal divisions instead of nesting separate Cards — one
 *  bordered surface with quiet internal dividers reads as one block, not a stack of boxes. */
/** Raised content group. Now that `surface-2` sits above the recessed page
 *  tone, the tonal step does most of the separating — so the stroke drops to a
 *  hairline (`edge/60`) plus the barely-there `shadow-panel`, instead of a full
 *  border doing all the work. Same shape, much less chrome. */
export function Panel({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-container border border-edge/60 bg-surface-2 shadow-panel overflow-hidden ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

interface PanelSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'sm' | 'md' | 'lg';
}

// Stepped up one notch across the board: with the type scale lifted, p-5 left
// content pressed against the panel edge. Separation should come from spacing
// before it comes from strokes, so the padding is doing more work now.
const PADDING = { sm: 'p-5', md: 'p-6', lg: 'p-8' } as const;

export function PanelSection({ children, padding = 'md', className = '', ...rest }: PanelSectionProps) {
  return (
    <div className={`border-t border-edge first:border-t-0 ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
