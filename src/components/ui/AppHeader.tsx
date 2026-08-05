import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';

interface AppHeaderProps {
  onOpenMobileNav?: () => void;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** Slim top bar — page context on the left, theme/user controls on the right.
 *  Recreated from zero: no brand mark, no primary nav here (that lives in Sidebar),
 *  just the minimum needed so the interface has one focal row instead of two. */
export function AppHeader({ onOpenMobileNav, left, right, className = '' }: AppHeaderProps) {
  return (
    <header
      className={`h-14 flex items-center gap-3 px-4 md:px-6 border-b border-edge bg-surface flex-shrink-0 ${className}`}
    >
      {onOpenMobileNav && (
        <button
          onClick={onOpenMobileNav}
          className="md:hidden -ml-1 p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors flex-shrink-0"
        >
          <Menu size={18} />
        </button>
      )}
      <div className="flex-1 min-w-0 flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-1.5 flex-shrink-0">{right}</div>
    </header>
  );
}
