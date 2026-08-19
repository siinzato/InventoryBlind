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
    // bg-surface-2, not bg-surface: the header is chrome and belongs with the
    // sidebar rail, while `surface` is now the recessed canvas the content
    // panels sit on. Chrome frame light, canvas recessed, panels light again.
    // A altura cresce com o inset em vez de só ganhar padding: com
    // `apple-mobile-web-app-status-bar-style: black-translucent` + `viewport-fit=cover`
    // a webview começa em y=0, embaixo da barra de status. Só padding empurraria o
    // conteúdo para fora das 4rem e cortaria os controles. No desktop o inset é 0, então
    // isto resolve exatamente para `h-16` e nada muda.
    <header
      className={`h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] flex items-center gap-3 px-4 md:px-7 border-b border-edge/70 bg-surface-2 flex-shrink-0 ${className}`}
    >
      {onOpenMobileNav && (
        <button
          onClick={onOpenMobileNav}
          className="md:hidden -ml-1 p-2 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors flex-shrink-0"
        >
          <Menu size={18} />
        </button>
      )}
      <div className="flex-1 min-w-0 flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-1.5 flex-shrink-0">{right}</div>
    </header>
  );
}
