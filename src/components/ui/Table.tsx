import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function Table({ className = '', ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-sm border-collapse ${className}`} {...rest} />;
}

/** The table is the protagonist, so the header carries no fill — a single rule
 *  under it is enough to separate it from the rows. The previous
 *  `bg-surface-3` band was the one piece of chrome that made every data screen
 *  read as an admin template. */
export function Thead({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`border-b border-edge ${className}`} {...rest} />;
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors ${className}`} {...rest} />;
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      // Not uppercase: shouting caps on every column is admin-panel shorthand.
      // Small, medium-weight and muted separates the header from the data
      // without competing with it.
      className={`text-left px-4 py-2.5 text-xs font-medium text-fg-subtle ${className}`}
      {...rest}
    />
  );
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligned tabular figures — quantities, counts, percentages, money.
   *  Without this, digits shift column position as values change. */
  numeric?: boolean;
}

export function Td({ numeric = false, className = '', ...rest }: TdProps) {
  return (
    <td
      className={`px-4 py-3 text-fg ${numeric ? 'text-right font-mono tabular-nums' : ''} ${className}`}
      {...rest}
    />
  );
}
