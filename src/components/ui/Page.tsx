import type { ReactNode } from 'react';

interface PageProps {
  children: ReactNode;
  /** `wide` for map/grid screens that need the horizontal room (Digital Twin,
   *  Slotting); default `default` keeps a comfortable reading measure. */
  width?: 'default' | 'wide';
  className?: string;
}

/** The measure and rhythm every authenticated screen sits in.
 *
 *  Replaces the `max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6` string that had
 *  been retyped on thirteen screens (two of which had already drifted to
 *  space-y-8). Gutters step up more decisively at the large breakpoint and the
 *  vertical gap between panels grows with the viewport, so a desktop screen
 *  breathes instead of using tablet spacing scaled up.
 *
 *  Vertical rhythm lives here via `space-y-*` rather than on each panel, so
 *  panels stay position-independent and nothing double-margins. */
export function Page({ children, width = 'default', className = '' }: PageProps) {
  return (
    <div
      className={`mx-auto w-full ${width === 'wide' ? 'max-w-7xl' : 'max-w-6xl'} px-4 py-6 sm:px-6 lg:px-10 lg:py-10 space-y-6 lg:space-y-8 ${className}`}
    >
      {children}
    </div>
  );
}
