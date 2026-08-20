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
   *  visual cluster — "Em breve", or one of the three top-level sections). */
  sectionLabel?: string;
  /** This group also starts a new rail quick-access icon (one of the 3 top-level
   *  clusters). Independent from sectionLabel — "Em breve" gets its own caption
   *  in the panel but stays part of its parent cluster's rail icon. */
  railSection?: boolean;
}

interface SidebarProps {
  groups: SidebarNavGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  /** Collapsed = only the navy rail shows; the panel (brand, workspace, nav groups) unmounts. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Rail's bottom-of-stack "ajuda" shortcut. */
  railHelp?: { icon: ReactNode; label: string; onClick: () => void };
  /** Rail's bottom-of-stack avatar trigger (a ready-made element, e.g. a dropdown trigger) — sized/positioned by the rail. */
  railAvatar?: ReactNode;
  /** Mobile drawer: panel only, no navy rail (it isn't meant to sit permanently on a phone screen). */
  hideRail?: boolean;
  className?: string;
}

const LOCKED_TOOLTIP = 'Disponível em uma atualização futura';

/** Two-tone primary navigation: a fixed-width navy rail (brand, quick access
 *  per section, avatar, help, collapse toggle) + a panel (brand header,
 *  workspace, "Nova Contagem", the accordion group list). Purely
 *  presentational — the caller (App.tsx) owns activeTab state and role-based
 *  gating; this component only renders whatever groups/items it's given.
 *
 *  Groups are an accordion: only one open at a time, and the group containing
 *  the active item auto-opens (and stays open across navigation within it).
 *  The rail's per-section icons drive the SAME accordion state as the panel's
 *  own group headers — one shared expand/collapse mechanism, not two. */
export function Sidebar({ groups, header, footer, collapsed = false, onToggleCollapsed, railHelp, railAvatar, hideRail = false, className = '' }: SidebarProps) {
  const activeGroupId = groups.find(g => g.items.some(i => i.active))?.id ?? groups[0]?.id;
  const [expandedId, setExpandedId] = useState(activeGroupId);

  useEffect(() => {
    setExpandedId(activeGroupId);
  }, [activeGroupId]);

  function focusGroup(groupId: string) {
    setExpandedId(curr => (curr === groupId ? '' : groupId));
    if (collapsed) onToggleCollapsed?.();
  }

  // Rail shows one icon per top-level cluster (Visão Geral / Operação Inteligente /
  // Aprendizado e Gestão), not one per accordion group — a group's own sectionLabel
  // ("Em breve") stays folded into its parent cluster's icon.
  const railSections = groups.reduce<{ label: string; icon: ReactNode; groupIds: string[] }[]>((acc, group) => {
    if (group.railSection || acc.length === 0) {
      acc.push({ label: group.sectionLabel ?? group.label, icon: group.items[0]?.icon, groupIds: [group.id] });
    } else {
      acc[acc.length - 1].groupIds.push(group.id);
    }
    return acc;
  }, []);

  return (
    <div className={`flex h-full min-h-0 flex-shrink-0 ${className}`}>
      {!hideRail && (
        <aside className="w-14 h-full flex flex-col items-center bg-rail flex-shrink-0 py-4 gap-1">
          <button
            onClick={() => { const first = groups[0]?.items[0]; if (first) { first.onClick(); if (collapsed) onToggleCollapsed?.(); } }}
            title="InventoryBlind"
            aria-label="Ir para o Dashboard"
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control text-rail-fg hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <LogoMark size={18} />
          </button>

          <div className="w-6 h-px bg-white/15 my-2 flex-shrink-0" />

          <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-1 w-full">
            {railSections.map(section => {
              if (!section.icon) return null;
              const isActive = section.groupIds.includes(activeGroupId);
              return (
                <button
                  key={section.label}
                  onClick={() => focusGroup(section.groupIds[0])}
                  title={section.label}
                  aria-label={section.label}
                  aria-current={isActive ? 'true' : undefined}
                  className={`relative w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 [&>svg]:w-[18px] [&>svg]:h-[18px] ${
                    isActive ? 'bg-rail-active text-rail-fg' : 'text-rail-fg-muted hover:bg-white/10 hover:text-rail-fg'
                  }`}
                >
                  {section.icon}
                </button>
              );
            })}
          </nav>

          <div className="w-6 h-px bg-white/15 my-2 flex-shrink-0" />

          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            {railHelp && (
              <button
                onClick={railHelp.onClick}
                title={railHelp.label}
                aria-label={railHelp.label}
                className="w-9 h-9 flex items-center justify-center rounded-control text-rail-fg-muted hover:bg-white/10 hover:text-rail-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 [&>svg]:w-[18px] [&>svg]:h-[18px]"
              >
                {railHelp.icon}
              </button>
            )}
            {railAvatar}
            {onToggleCollapsed && (
              <button
                onClick={onToggleCollapsed}
                title={collapsed ? 'Expandir menu' : 'Recolher menu'}
                aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
                className="w-9 h-9 flex items-center justify-center rounded-control text-rail-fg-muted hover:bg-white/10 hover:text-rail-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              </button>
            )}
          </div>
        </aside>
      )}

      {/* Always mounted (never `display:none`/unmounted) so width/opacity can actually
          transition — the OUTER box animates width+clips via overflow-hidden, while the
          INNER box stays a fixed 224px so its text never reflows mid-transition, only
          gets progressively revealed/clipped. */}
      <aside
        aria-hidden={collapsed}
        className={`h-full min-h-0 flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${collapsed ? 'w-0' : 'w-56'}`}
      >
        <div
          // Hairline divider instead of a full border: the rail already reads as
          // chrome because the canvas beside it is recessed.
          className={`w-56 h-full flex flex-col bg-surface-2 border-r border-edge/70 transition-[opacity,transform] duration-150 ease-out ${
            collapsed ? 'opacity-0 -translate-x-1 pointer-events-none' : 'opacity-100 translate-x-0'
          }`}
        >
          {header && <div className="flex-shrink-0 px-4 pt-5 pb-4">{header}</div>}

          <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5 [scrollbar-gutter:stable]">
            {groups.map((group) => {
              const isOpen = expandedId === group.id;
              const isActiveGroup = group.id === activeGroupId;

              return (
                <div key={group.id}>
                  {group.sectionLabel && (
                    // Wraps instead of truncating: a caption has vertical room to spare, and
                    // wrapping guarantees the full text is always readable — no single-line
                    // width math that a long label ("Operação Inteligente", "Aprendizado e
                    // Gestão") can end up right at the edge of.
                    <p className="text-overline px-3 mt-6 mb-2 leading-snug">{group.sectionLabel}</p>
                  )}

                  <button
                    onClick={() => setExpandedId(curr => (curr === group.id ? '' : group.id))}
                    aria-expanded={isOpen}
                    title={group.label}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      isActiveGroup ? 'font-semibold' : 'font-medium'
                    } ${group.locked ? 'text-fg-subtle/70' : 'text-fg hover:bg-surface-3'}`}
                  >
                    <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px]">
                      {group.locked ? <Lock size={15} /> : group.items[0]?.icon}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-left">{group.label}</span>
                    <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
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

          {footer && <div className="flex-shrink-0 px-3 py-3 border-t border-edge">{footer}</div>}
        </div>
      </aside>
    </div>
  );
}
