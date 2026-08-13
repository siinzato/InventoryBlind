import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ChevronDown, Lock } from 'lucide-react';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active: boolean;
  /** Disabled "coming soon" item — no navigation, grayed out, lock icon + tooltip. */
  locked?: boolean;
}

export interface SidebarNavGroup {
  id: string;
  label: string;
  items: SidebarNavItem[];
  /** Whole group is a "coming soon" section — items are non-interactive. */
  locked?: boolean;
  /** Caption rendered above this group only (used once, above the first locked group, to head the "Em breve" section). */
  sectionLabel?: string;
}

interface SidebarProps {
  groups: SidebarNavGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  collapsed?: boolean;
  className?: string;
}

const LOCKED_TOOLTIP = 'Disponível em uma atualização futura';

/** Redesigned-from-zero primary navigation rail. Purely presentational — the caller
 *  (App.tsx) owns activeTab state and role-based gating; this component only renders
 *  whatever groups/items it's given. Quiet hover, tinted (not bordered) active state,
 *  single-weight icons — no color per item, no badges.
 *
 *  Groups are an accordion: only one open at a time, and the group containing the
 *  active item auto-opens (and stays open across navigation within that group). */
export function Sidebar({ groups, header, footer, collapsed = false, className = '' }: SidebarProps) {
  const activeGroupId = groups.find(g => g.items.some(i => i.active))?.id ?? groups[0]?.id;
  const [expandedId, setExpandedId] = useState(activeGroupId);

  useEffect(() => {
    setExpandedId(activeGroupId);
  }, [activeGroupId]);

  return (
    <aside
      // Hairline divider instead of a full border: the rail already reads as
      // chrome because the canvas beside it is recessed.
      className={`flex flex-col h-full bg-surface-2 border-r border-edge/70 ${collapsed ? 'w-[76px]' : 'w-60'} flex-shrink-0 transition-[width] duration-200 ${className}`}
    >
      {header && <div className="flex-shrink-0 px-4 pt-5 pb-4">{header}</div>}

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {groups.map((group) => {
          const isOpen = collapsed || expandedId === group.id;

          return (
            <div key={group.id}>
              {group.sectionLabel && !collapsed && (
                <p className="text-overline px-3 mt-6 mb-2">{group.sectionLabel}</p>
              )}

              {!collapsed && (
                <button
                  onClick={() => setExpandedId(curr => (curr === group.id ? '' : group.id))}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-control text-xs font-medium transition-colors ${
                    group.locked ? 'text-fg-subtle/70' : 'text-fg-subtle hover:text-fg hover:bg-surface-3'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {group.locked && <Lock size={11} className="flex-shrink-0" />}
                    {group.label}
                  </span>
                  <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              )}

              <div className={collapsed ? '' : `grid transition-[grid-template-rows] duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className={`space-y-1 ${collapsed ? '' : 'pt-1 pb-2'}`}>
                    {group.items.map((item) => {
                      const locked = group.locked || item.locked;
                      return (
                        <button
                          key={item.id}
                          onClick={locked ? undefined : item.onClick}
                          title={locked ? LOCKED_TOOLTIP : collapsed ? item.label : undefined}
                          disabled={locked}
                          className={`group w-full flex items-center gap-3 rounded-control text-sm font-medium transition-colors ${
                            collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
                          } ${
                            locked
                              ? 'text-fg-subtle/60 cursor-not-allowed'
                              : item.active
                              ? 'bg-accent/10 text-accent'
                              : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
                          }`}
                        >
                          <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-[17px] [&>svg]:h-[17px]">
                            {item.icon}
                          </span>
                          {!collapsed && <span className="truncate">{item.label}</span>}
                          {!collapsed && locked && <Lock size={12} className="flex-shrink-0 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {footer && <div className="flex-shrink-0 px-3 py-3 border-t border-edge">{footer}</div>}
    </aside>
  );
}
