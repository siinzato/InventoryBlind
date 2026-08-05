import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function Table({ className = '', ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-sm border-collapse ${className}`} {...rest} />;
}

export function Thead({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-surface-3 ${className}`} {...rest} />;
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors ${className}`} {...rest} />;
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`text-left px-4 py-2.5 font-medium text-fg-muted text-xs uppercase tracking-wide ${className}`}
      {...rest}
    />
  );
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-4 py-3 text-fg ${className}`} {...rest} />;
}
