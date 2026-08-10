import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-7' } as const;

/** Standard surface container — replaces the ad-hoc "rounded card" div repeated across every page.
 *  Flat by default (border only, no shadow) — Design System 2.0 favors quiet borders over drop
 *  shadows so surfaces don't compete for attention. */
export function Card({ children, padding = 'md', className = '', ...rest }: CardProps) {
  return (
    <div className={`rounded-xl border border-edge bg-surface-2 ${PADDING[padding]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
