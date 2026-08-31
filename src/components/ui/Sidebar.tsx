import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ChevronDown, Lock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { LogoMark } from '../landing/landingUi';

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
  /** Caption rendered above this group only (used above the first group of a
   *  visual cluster — "Em breve", or one of the three top-level sections). Also
   *  doubles as the compact-rail divider signal: a new caption means a new
   *  visual cluster, so a hairline separates it from the previous group. */
  sectionLabel?: string;
  /** No longer drives a "3 quick-access icons" rail — kept only so existing
   *  callers (App.tsx's navGroups) don't need to change. See sectionLabel for
   *  the mechanism that actually groups clusters now. */
  railSection?: boolean;
  /** Optional icon representing the group itself (e.g. the 4 "pasta azul"
   *  operational clusters in the reference design). Falls back to the first
   *  item's icon so existing callers keep their current look unchanged. */
  icon?: ReactNode;
}

interface SidebarProps {
  groups: SidebarNavGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  /** Collapsed = ~76px, icon-only. Ignored when hideRail (mobile always shows expanded). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Footer's "ajuda" shortcut — icon-only, same as before. */
  railHelp?: { icon: ReactNode; label: string; onClick: () => void };
  /** Footer's avatar trigger (a ready-made element, e.g. a dropdown trigger) — sized/positioned by the footer. */
  railAvatar?: ReactNode;
  /** Compact-only: workspace initial shown right under the logo (pure visual
   *  element — Sidebar wraps it in its own "expand" button, since there's no
   *  room for a dropdown at 76px). Expanded mode keeps the full dropdown
   *  inside `header` as before. */
  workspaceAvatar?: ReactNode;
  /** Mobile drawer: always the expanded layout, no compact/collapsed state, no top window-chrome dots. */
  hideRail?: boolean;
  className?: string;
}

const LOCKED_TOOLTIP = 'Disponível em uma atualização futura';

/** Single unified panel (macOS/iPadOS-style): one surface, rounded corners on
 *  its free edge, quiet border+shadow — replacing the old two-piece navy
 *  rail + white panel. Expanded (~280px) and collapsed (~76px, icon-only)
 *  are the SAME markup with the label/caption portions fading and
 *  width-collapsing via CSS, not a different tree per state — so nothing
 *  remounts and nothing reflows abruptly when toggling.
 *
 *  Purely presentational — the caller (App.tsx) owns activeTab state and
 *  role-based gating; this component only renders whatever groups/items
 *  it's given.
 *
 *  Groups are an accordion: only one open at a time, and the group containing
 *  the active item auto-opens (and stays open across navigation within it).
 *  In the collapsed state every group still gets its own icon-only button
 *  (not one shortcut per cluster) — clicking one expands the panel and opens
 *  that exact group, reusing the same `focusGroup` used by the accordion
 *  header itself. */
export function Sidebar({ groups, header, footer, collapsed = false, onToggleCollapsed, railHelp, railAvatar, workspaceAvatar, hideRail = false, className = '' }: SidebarProps) {
  // Mobile drawer never operates compact — "exibir a versão expandida" always.
  const isCompact = collapsed && !hideRail;

  const activeGroupId = groups.find(g => g.items.some(i => i.active))?.id ?? groups[0]?.id;
  const [expandedId, setExpandedId] = useState(activeGroupId);

  useEffect(() => {
    setExpandedId(activeGroupId);
  }, [activeGroupId]);

  /** Shared by the compact icon button and the expanded accordion header:
   *  collapsed → expand the panel AND open exactly this group; expanded →
   *  normal accordion toggle (click open group again to close it). */
  function focusGroup(groupId: string) {
    if (isCompact) {
      onToggleCollapsed?.();
      setExpandedId(groupId);
    } else {
      setExpandedId(curr => (curr === groupId ? '' : groupId));
    }
  }

  return (
    <aside
      aria-hidden={false}
      className={`h-full flex-shrink-0 flex flex-col bg-surface-2 overflow-hidden transition-[width] duration-200 ease-out ${
        isCompact ? 'w-[76px]' : 'w-[280px]'
      } ${
        // Mobile drawer keeps its original flush look ("preserve o drawer atual") —
        // only the desktop unified panel gets the floating-card treatment.
        hideRail ? 'border-r border-edge/70' : 'border border-edge/70 rounded-r-container shadow-panel'
      } ${className}`}
    >
      <div className="w-full h-full flex flex-col min-w-0">
        {!hideRail && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-1">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            {!isCompact && onToggleCollapsed && (
              <button
                onClick={onToggleCollapsed}
                title="Recolher menu"
                aria-label="Recolher menu"
                className="w-7 h-7 flex items-center justify-center rounded-control text-fg-subtle hover:bg-surface-3 hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <PanelLeftClose size={14} />
              </button>
            )}
          </div>
        )}

        {isCompact ? (
          <div className="flex-shrink-0 flex flex-col items-center gap-2 pt-1 pb-2">
            <button
              onClick={onToggleCollapsed}
              title="Expandir menu"
              aria-label="Expandir menu"
              className="w-9 h-9 flex items-center justify-center rounded-control text-accent hover:bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <LogoMark size={18} />
            </button>
            {workspaceAvatar && (
              <button
                onClick={onToggleCollapsed}
                title="Expandir menu"
                aria-label="Expandir menu"
                className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {workspaceAvatar}
              </button>
            )}
            <div className="h-px w-8 bg-edge/70 mt-1" />
          </div>
        ) : (
          header && <div className="flex-shrink-0 px-4 pt-2 pb-4">{header}</div>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5 [scrollbar-gutter:stable]">
          {groups.map((group, index) => {
            const isOpen = !isCompact && expandedId === group.id;
            const isActiveGroup = group.id === activeGroupId;
            const groupIcon = group.locked ? <Lock size={15} /> : (group.icon ?? group.items[0]?.icon);

            return (
              <div key={group.id}>
                {isCompact ? (
                  index > 0 && group.sectionLabel && <div className="h-px bg-edge/70 mx-1 my-2" />
                ) : (
                  group.sectionLabel && (
                    <p className="text-overline px-3 mt-6 mb-2 leading-snug">{group.sectionLabel}</p>
                  )
                )}

                <button
                  onClick={() => focusGroup(group.id)}
                  aria-expanded={isCompact ? undefined : isOpen}
                  aria-current={isCompact && isActiveGroup ? 'page' : undefined}
                  title={group.label}
                  aria-label={isCompact ? group.label : undefined}
                  className={`w-full flex items-center gap-3 rounded-control text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    isCompact ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
                  } ${isActiveGroup ? 'font-semibold' : 'font-medium'} ${
                    group.locked ? 'text-fg-subtle/70' : isCompact && isActiveGroup ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-surface-3'
                  }`}
                >
                  <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px]">
                    {groupIcon}
                  </span>
                  <span
                    className={`flex items-center gap-2 overflow-hidden transition-[opacity] duration-150 ease-out ${
                      isCompact ? 'opacity-0 w-0' : 'opacity-100 flex-1 min-w-0'
                    }`}
                  >
                    <span className="flex-1 min-w-0 truncate text-left">{group.label}</span>
                    <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                <div className={`grid transition-[grid-template-rows] duration-[180ms] ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="space-y-0.5 pt-1 pb-2">
                      {group.items.map((item) => {
                        const locked = group.locked || item.locked;
                        return (
                          <button
                            key={item.id}
                            onClick={locked ? undefined : item.onClick}
                            title={locked ? LOCKED_TOOLTIP : item.label}
                            disabled={locked}
                            aria-current={item.active ? 'page' : undefined}
                            className={`group w-full flex items-center gap-2.5 pl-9 pr-3 py-2 rounded-control text-xs font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                              locked
                                ? 'text-fg-subtle/60 cursor-not-allowed'
                                : item.active
                                ? 'bg-accent/10 text-accent'
                                : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
                            }`}
                          >
                            <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">
                              {item.icon}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
                            {locked && <Lock size={11} className="flex-shrink-0 ml-auto" />}
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

        {(railHelp || railAvatar || (isCompact && onToggleCollapsed)) && (
          <div className={`flex-shrink-0 px-3 py-3 border-t border-edge flex ${isCompact ? 'flex-col items-center gap-1.5' : 'items-center justify-between'}`}>
            {railHelp && (
              <button
                onClick={railHelp.onClick}
                title={railHelp.label}
                aria-label={railHelp.label}
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control text-fg-subtle hover:bg-surface-3 hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&>svg]:w-[17px] [&>svg]:h-[17px]"
              >
                {railHelp.icon}
              </button>
            )}
            {railAvatar}
            {isCompact && onToggleCollapsed && (
              <button
                onClick={onToggleCollapsed}
                title="Expandir menu"
                aria-label="Expandir menu"
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control text-fg-subtle hover:bg-surface-3 hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
          </div>
        )}

        {footer && !isCompact && <div className="flex-shrink-0 px-3 py-3 border-t border-edge">{footer}</div>}
      </div>
    </aside>
  );
}
