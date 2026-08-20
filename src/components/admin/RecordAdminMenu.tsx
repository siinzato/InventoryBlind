import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';

export interface RecordAdminAction {
  key: string;
  label: string;
  icon?: ReactNode;
  /** `danger` para o que remove ou destrói. */
  tone?: 'default' | 'danger';
  onSelect: () => void;
}

interface RecordAdminMenuProps {
  actions: RecordAdminAction[];
  /** Rótulo acessível — cada módulo diz de que registro se trata. */
  label: string;
}

/** Altura aproximada por item, só para decidir se o menu abre para baixo ou para
 *  cima. Errar por alguns pixels não quebra nada. */
const ITEM_HEIGHT = 44;
const MENU_PADDING = 8;
const MENU_WIDTH = 224;

/**
 * Menu de três pontos das ações administrativas — um só para todos os módulos.
 *
 * `position: fixed` com coordenadas medidas do botão, em vez de `absolute`: as
 * listas do projeto vivem dentro de `overflow-x-auto`/`overflow-hidden`, que
 * recortariam um menu absoluto e o prenderiam à rolagem horizontal.
 *
 * Esconder o menu é conveniência de UX, nunca autorização: quem decide é a RPC
 * SECURITY DEFINER de cada módulo, que revalida papel, empresa e estado.
 */
export function RecordAdminMenu({ actions, label }: RecordAdminMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const menuHeight = actions.length * ITEM_HEIGHT + MENU_PADDING;

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    const openUpward = rect.bottom + 4 + menuHeight > window.innerHeight;
    setCoords({ top: openUpward ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4, left });
    setOpen(true);
  };

  // Fecha em clique fora, Escape, rolagem e redimensionamento — as coordenadas
  // são um retrato do momento da abertura, então qualquer uma dessas coisas
  // deixaria o menu solto no meio da tela.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 [@media(pointer:fine)]:min-h-[32px] [@media(pointer:fine)]:min-w-[32px]"
      >
        <MoreVertical size={16} />
      </button>

      {open && coords && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{ top: coords.top, left: coords.left, width: MENU_WIDTH, zIndex: 'var(--z-dropdown)' }}
          className="fixed rounded-sheet border border-edge bg-surface-2 p-1 shadow-overlay"
        >
          {actions.map((action, index) => (
            <button
              key={action.key}
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                action.onSelect();
              }}
              className={`flex w-full min-h-[44px] items-center gap-2 rounded-control px-3 text-left text-sm transition-colors hover:bg-surface-3 focus:outline-none focus:bg-surface-3 ${
                action.tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-fg'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
