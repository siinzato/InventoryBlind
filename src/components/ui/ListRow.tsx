import type { ReactNode } from 'react';

interface ListRowProps {
  /** Primary content, left-aligned. Truncates before the value does. */
  children: ReactNode;
  /** Trailing value — right-aligned, tabular when numeric. */
  value?: ReactNode;
  /** Renders as a button and makes the whole row activatable. */
  onClick?: () => void;
  /** Accessible name when the row is clickable and `children` is not plain text. */
  title?: string;
  className?: string;
}

/** The app's one list-row rhythm — replaces the
 *  `flex items-center justify-between py-1.5 border-b border-edge` block that
 *  had been repeated across the slotting/CBC/RCA/audit panels.
 *
 *  Two deliberate differences from what it replaces: rows are `py-3` instead of
 *  `py-1.5` (28px rows fought the "tables and lists are protagonists" rule —
 *  legibility beats density here), and the separator is `border-edge/60` so the
 *  eye reads a list rather than a grid of cells.
 *
 *  When `onClick` is given it renders a real <button>, so the row is focusable
 *  and keyboard-activatable — several call sites had been using a bare <div>
 *  with onClick, which is invisible to keyboard and screen-reader users. */
export function ListRow({ children, value, onClick, title, className = '' }: ListRowProps) {
  const shared = `flex w-full items-center justify-between gap-3 border-b border-edge/60 py-3 text-left last:border-0 ${className}`;

  const content = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {value != null && (
        <div className="flex-shrink-0 text-sm font-medium tabular-nums text-fg">{value}</div>
      )}
    </>
  );

  if (!onClick) {
    return <div className={shared}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${shared} -mx-2 px-2 rounded-control transition-colors hover:bg-surface-3/60 min-h-[44px]`}
    >
      {content}
    </button>
  );
}
