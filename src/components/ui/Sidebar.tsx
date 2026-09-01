import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Lock } from 'lucide-react';
import { SafeDropdown, type DropdownItem } from '../SafeDropdown';
import './inventoryblind-sidebar.css';

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

/** Workspace selector data for the kit's desktop rendering — o menu de troca
 *  de empresa reaproveita o SafeDropdown já usado em outros pontos do app
 *  (nenhuma lógica de abrir/fechar dropdown nova). A drawer mobile
 *  (`hideRail`) continua usando os props `header`/`workspaceAvatar` de
 *  antes, sem mudança. */
export interface SidebarWorkspaceInfo {
  name: string;
  label: string;
  logoUrl?: string;
  menuItems: DropdownItem[];
}

interface SidebarProps {
  groups: SidebarNavGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  /** Collapsed = 72px, icon-only. Ignored when hideRail (mobile always shows expanded). */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Footer's "ajuda" shortcut — icon-only, same as before. */
  railHelp?: { icon: ReactNode; label: string; onClick: () => void };
  /** Footer's avatar trigger (a ready-made element, e.g. a dropdown trigger) — sized/positioned by the footer. */
  railAvatar?: ReactNode;
  /** Compact-only: workspace initial shown right under the logo (mobile/hideRail path only). */
  workspaceAvatar?: ReactNode;
  /** Desktop workspace selector (kit's black-stamp button) — real company data. */
  workspace?: SidebarWorkspaceInfo;
  /** Mobile drawer: always the expanded layout, no compact/collapsed state, no top window-chrome dots. */
  hideRail?: boolean;
  className?: string;
}

const LOCKED_TOOLTIP = 'Disponível em uma atualização futura';
const ICON_BASE = '/icons/ib-sidebar';

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <img className={className} src={`${ICON_BASE}/${name}.svg`} alt="" aria-hidden="true" />;
}

/** `inert` bloqueia foco por teclado em conteúdo escondido (DESIGN-SPEC §8)
 *  — o `@types/react` desta versão do projeto ainda não tipa o atributo,
 *  então passamos via spread tipado em vez de recorrer a `any` solto. */
function inertProps(isInert: boolean): Record<string, string> {
  return isInert ? { inert: '' } : {};
}

export const SIDEBAR_LAYOUT = Object.freeze({ expanded: 300, collapsed: 72, rail: 52 });

/** Fallback já usado pelo app antes da troca visual: só aparece quando o
 *  workspace realmente não possui logo enviado. */
export function workspaceFallback(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}

/** Um grupo por seção maior (01/02/03) — o coordinate prefix vem do índice
 *  de seção, incrementado toda vez que `sectionLabel` aparece (mesmo sinal
 *  de fronteira de cluster já usado antes desta reformulação visual). */
export function computeSectionNumbers(groups: SidebarNavGroup[]): number[] {
  let section = 0;
  return groups.map(g => { if (g.sectionLabel) section += 1; return Math.max(section, 1); });
}

/** DESIGN-SPEC proíbe ícones fora de `icons/` (nada de Lucide/Heroicons/etc.)
 *  para a navegação do sidebar — os ícones que App.tsx já passa em
 *  `group.icon`/`item.icon` (lucide-react) não são usados aqui no branch
 *  desktop; só no drawer mobile (`hideRail`), que fica fora desta troca.
 *  O kit só define ícone para os 11 grupos de topo + o único filho
 *  ("Agentes e Automações") que ele demonstrou — os demais filhos reais
 *  (que o kit não tinha como prever) reaproveitam o ícone do próprio grupo
 *  em vez de inventar um novo, por id. */
const GROUP_ICON: Record<string, string> = {
  'dashboard-group': 'dashboard',
  'analytics-group': 'analytics',
  'counting-group': 'operations',
  'automacoes-group': 'automations',
  'products-group': 'products',
  'tools-group': 'tools',
  'academy-group': 'academy',
  'account-group': 'account',
  'admin-group': 'admin',
  'integracoes-group': 'integrations',
  'config-avancada-group': 'settings',
};
const ITEM_ICON_OVERRIDE: Record<string, string> = {
  automacoes: 'agents',
};

export function groupIconName(groupId: string): string {
  return GROUP_ICON[groupId] ?? 'dashboard';
}
export function itemIconName(groupId: string, itemId: string): string {
  return ITEM_ICON_OVERRIDE[itemId] ?? groupIconName(groupId);
}

/** A coluna principal nunca recebe a árvore completa. Só o destino ativo
 *  permanece visível como a tarjeta escura da referência; os demais ficam no
 *  painel contextual, preservando todas as rotas sem engordar o menu. */
export function visibleInlineItems(group: SidebarNavGroup): SidebarNavItem[] {
  const active = group.items.find(item => item.active);
  return active ? [active] : [];
}

function WorkspaceMark({ workspace, compact = false }: { workspace: SidebarWorkspaceInfo; compact?: boolean }) {
  if (workspace.logoUrl) {
    return (
      <span className={`ib-workspace-mark${compact ? ' is-compact' : ''}`}>
        <img src={workspace.logoUrl} alt="" />
      </span>
    );
  }
  return (
    <span className={`ib-workspace-mark is-fallback${compact ? ' is-compact' : ''}`} aria-hidden="true">
      {workspaceFallback(workspace.name)}
    </span>
  );
}

/** Sidebar InventoryBlind: trilho navy de 52px + coluna temática expandida
 *  (300px total) / retraída (72px, só o trilho). App.tsx é dono do estado
 *  real (activeTab, permissões, workspace); este componente só decide como
 *  desenhar o que recebe.
 *
 *  O destino ativo fica inline; a árvore completa abre num painel contextual
 *  que não empurra as outras seções. Assim grupos grandes preservam todas as
 *  funções reais sem transformar o menu numa página desproporcional.
 *
 *  Trilho compacto: a referência mostra só 1 ícone por grupo de topo, mais o
 *  ícone do filho ativo quando existir (ex.: Automações + Agentes e
 *  Automações) — NUNCA todos os filhos reais achatados. Reproduzido
 *  literalmente assim, mesmo quando um grupo real tem 10 filhos: no modo
 *  compacto só o ícone do grupo aparece; abrir aquele grupo específico
 *  (e ver a lista completa) exige expandir o painel.
 *
 *  `hideRail` (drawer mobile) mantém a apresentação anterior a esta
 *  reformulação — o kit não define nada para mobile. */
export function Sidebar({ groups, header, footer, collapsed: controlledCollapsed, onToggleCollapsed, railHelp, railAvatar, workspaceAvatar, workspace, hideRail = false, className = '' }: SidebarProps) {
  // Estado controlado (App.tsx é dono, como hoje) ou não-controlado (self-managed) —
  // mesmo contrato do react/InventoryBlindSidebar.jsx do kit.
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const handleToggleCollapsed = () => {
    if (controlledCollapsed === undefined) setInternalCollapsed(c => !c);
    onToggleCollapsed?.();
  };

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (collapsed) {
      setOpenMenuId(null);
      setMenuAnchor(null);
    }
  }, [collapsed]);

  function focusGroup(groupId: string, anchor?: HTMLElement) {
    if (collapsed) {
      handleToggleCollapsed();
      setOpenMenuId(null);
      setMenuAnchor(null);
    } else {
      setOpenMenuId(curr => {
        const next = curr === groupId ? null : groupId;
        setMenuAnchor(next ? (anchor ?? null) : null);
        return next;
      });
    }
  }

  const sectionNumbers = computeSectionNumbers(groups);
  const distinctSections = Array.from(new Set(sectionNumbers));
  const railRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [coordinateTops, setCoordinateTops] = useState<Record<number, number>>({});

  /** As marcas "01/02/03" do trilho são posicionadas dinamicamente no topo do
   *  primeiro grupo de cada seção — o kit fixa essas posições em pixel porque
   *  a demo tem pouquíssimo conteúdo; com os itens reais do projeto (bem mais
   *  numerosos) uma posição fixa desalinharia rapidamente. Recalculado ao
   *  redimensionar. */
  useLayoutEffect(() => {
    if (collapsed || !railRef.current || !navRef.current) return;
    const measure = () => {
      const railTop = railRef.current!.getBoundingClientRect().top;
      const next: Record<number, number> = {};
      for (const n of distinctSections) {
        const rect = navRef.current!.querySelector<HTMLElement>(`[data-group-section="${n}"]`)?.getBoundingClientRect();
        if (rect) next[n] = rect.top - railTop + rect.height / 2;
      }
      setCoordinateTops(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(navRef.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, groups.length]);

  if (hideRail) {
    return (
      <LegacyMobileSidebar
        groups={groups} header={header} footer={footer} railHelp={railHelp} railAvatar={railAvatar}
        workspaceAvatar={workspaceAvatar} className={className}
      />
    );
  }

  const openMenuIndex = openMenuId ? groups.findIndex(group => group.id === openMenuId) : -1;
  const openMenuGroup = openMenuIndex >= 0 ? groups[openMenuIndex] : null;

  return (
    <aside
      className={`ib-sidebar${collapsed ? ' is-collapsed' : ''} ${className}`}
      data-state={collapsed ? 'collapsed' : 'expanded'}
      aria-label="Navegação principal"
    >
      <div className="ib-content" {...inertProps(collapsed)} aria-hidden={collapsed}>
        {header ?? (
          <header className="ib-header">
            <span className="ib-wordmark">
              <span className="ib-wordmark-strong">Inventory</span><span className="ib-wordmark-accent">Blind</span>
            </span>
          </header>
        )}

        {workspace && (
          <SafeDropdown
            items={workspace.menuItems}
            trigger={
              <button className="ib-workspace" type="button" aria-label={`Selecionar workspace ${workspace.name}`}>
                <WorkspaceMark workspace={workspace} />
                <span className="ib-workspace-copy"><strong>{workspace.name}</strong><small>{workspace.label}</small></span>
                <span className="ib-workspace-registration" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <Icon name="chevron" />
              </button>
            }
          />
        )}

        <nav className="ib-nav" aria-label="Seções InventoryBlind" ref={navRef}>
          {groups.map((group, index) => {
            const isOpen = openMenuId === group.id;
            const sectionNumber = sectionNumbers[index];
            const isFirstOfSection = sectionNumbers[index - 1] !== sectionNumber;

            return (
              <section
                key={group.id}
                className={`ib-group${group.sectionLabel ? ' is-section-start' : ''}`}
                aria-labelledby={`ib-group-${group.id}`}
                data-group-section={isFirstOfSection ? sectionNumber : undefined}
              >
                {group.sectionLabel && (
                  <h2 id={`ib-group-${group.id}`}><span />{group.sectionLabel.toUpperCase()}</h2>
                )}

                <button
                  className="ib-nav-row"
                  type="button"
                  aria-expanded={isOpen}
                  title={group.label}
                  disabled={group.locked}
                  onClick={event => focusGroup(group.id, event.currentTarget)}
                  style={group.locked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                >
                  <Icon name={groupIconName(group.id)} />
                  <span className="ib-row-label">{group.label}</span>
                  <b aria-hidden="true">{isOpen ? '−' : '+'}</b>
                </button>

                {visibleInlineItems(group).map(item => {
                  const locked = group.locked || item.locked;
                  const itemIndex = group.items.indexOf(item);
                  const coordinate = `${String(sectionNumber).padStart(2, '0')}.${itemIndex + 1}`;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="ib-active-item"
                      aria-current="page"
                      onClick={locked ? undefined : item.onClick}
                      disabled={locked}
                    >
                      <Icon name={itemIconName(group.id, item.id)} />
                      <span>{item.label}</span>
                      <small>{coordinate}</small>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </nav>

        {footer ?? (railHelp && (
          <footer className="ib-content-footer">
            <a href="#help" onClick={e => { e.preventDefault(); railHelp.onClick(); }}>
              <Icon name="help" /><span>{railHelp.label}</span>
            </a>
          </footer>
        ))}
      </div>

      {openMenuGroup && menuAnchor && (
        <GroupMenuPopover
          group={openMenuGroup}
          sectionNumber={sectionNumbers[openMenuIndex]}
          anchor={menuAnchor}
          onClose={() => { setOpenMenuId(null); setMenuAnchor(null); }}
        />
      )}

      <div className="ib-rail" ref={railRef}>
        <Icon name="brand-mark" className="ib-brand-mark" />
        <button
          className="ib-collapse-control"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expandir menu' : 'Retrair menu'}
          onClick={handleToggleCollapsed}
        >
          <Icon name="collapse" />
        </button>

        <div className="ib-expanded-coordinates" aria-hidden="true">
          {distinctSections.map(n => (
            <span
              key={n}
              className="ib-coordinate"
              style={{ top: coordinateTops[n] ?? 220 + (n - 1) * 200 }}
            >
              {String(n).padStart(2, '0')}
            </span>
          ))}
        </div>

        <div {...inertProps(!collapsed)} aria-hidden={!collapsed}>
          <CompactNavigation groups={groups} sectionNumbers={sectionNumbers} onFocusGroup={focusGroup} workspace={workspace} />
        </div>

        <div className="ib-rail-footer">
          {railHelp && (
            <a className="ib-mini-help" href="#help" aria-label={railHelp.label} onClick={e => { e.preventDefault(); railHelp.onClick(); }}>
              <Icon name="help" /><span className="ib-tooltip">{railHelp.label}</span>
            </a>
          )}
          {railAvatar}
        </div>
      </div>
    </aside>
  );
}

function GroupMenuPopover({ group, sectionNumber, anchor, onClose }: {
  group: SidebarNavGroup;
  sectionNumber: number;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 12, left: 312 });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const width = 246;
      const estimatedHeight = Math.min(430, 52 + group.items.length * 38);
      const top = Math.max(12, Math.min(rect.top - 8, window.innerHeight - estimatedHeight - 12));
      const rightSide = rect.right + 10;
      const left = rightSide + width <= window.innerWidth - 12
        ? rightSide
        : Math.max(12, rect.left - width - 10);
      setPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor, group.items.length]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !panelRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="ib-submenu-popover"
      style={position}
      role="menu"
      aria-label={group.label}
    >
      <div className="ib-submenu-heading">
        <Icon name={groupIconName(group.id)} />
        <strong>{group.label}</strong>
        <small>{String(sectionNumber).padStart(2, '0')}</small>
      </div>
      <div className="ib-submenu-list">
        {group.items.map((item, index) => {
          const locked = group.locked || item.locked;
          const coordinate = `${String(sectionNumber).padStart(2, '0')}.${index + 1}`;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.active ? 'is-active' : ''}
              title={locked ? LOCKED_TOOLTIP : item.label}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                item.onClick();
                onClose();
              }}
            >
              <span>{item.label}</span>
              <small>{coordinate}</small>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/** Trilho compacto (72px): a referência mostra exatamente 1 ícone por grupo
 *  de topo — nunca os filhos reais achatados. A única exceção reproduzida é
 *  a mesma que o kit demonstra: quando o item ativo é um filho (não o
 *  próprio grupo), esse filho ganha um segundo ícone distinto, destacado,
 *  do lado do ícone do grupo — exatamente como "Automações" + "Agentes e
 *  Automações" na imagem de referência. Nenhum outro irmão aparece. */
function CompactNavigation({ groups, sectionNumbers, onFocusGroup, workspace }: {
  groups: SidebarNavGroup[];
  sectionNumbers: number[];
  onFocusGroup: (id: string) => void;
  workspace?: SidebarWorkspaceInfo;
}) {
  const bySection = new Map<number, SidebarNavGroup[]>();
  groups.forEach((g, i) => {
    const n = sectionNumbers[i];
    const list = bySection.get(n) ?? [];
    list.push(g);
    bySection.set(n, list);
  });

  return (
    <nav className="ib-mini-nav" aria-label="Navegação compacta">
      {workspace && (
        <SafeDropdown
          items={workspace.menuItems}
          className="ib-mini-workspace-menu"
          trigger={
            <button className="ib-mini-workspace" type="button" aria-label={`Selecionar workspace ${workspace.name}`}>
              <WorkspaceMark workspace={workspace} compact />
              <span className="ib-tooltip">{workspace.name}<small>{workspace.label}</small></span>
            </button>
          }
        />
      )}
      {Array.from(bySection.entries()).map(([sectionNumber, sectionGroups]) => (
        <div className="ib-mini-group" key={sectionNumber}>
          <span className="ib-mini-coordinate">{String(sectionNumber).padStart(2, '0')}</span>
          {sectionGroups.map(group => {
            const activeItem = group.items.find(i => i.active);
            const activeIndex = activeItem ? group.items.indexOf(activeItem) : -1;
            const coordinate = activeItem ? `${String(sectionNumber).padStart(2, '0')}.${activeIndex + 1}` : null;

            return (
              <div key={group.id} style={{ display: 'contents' }}>
                <button
                  type="button"
                  aria-label={group.label}
                  onClick={() => { if (!group.locked) onFocusGroup(group.id); }}
                  style={group.locked ? { opacity: 0.5 } : undefined}
                >
                  <Icon name={groupIconName(group.id)} />
                  <span className="ib-tooltip">{group.label}</span>
                </button>
                {activeItem && (
                  <button
                    type="button"
                    className="is-active"
                    aria-label={activeItem.label}
                    aria-current="page"
                    onClick={() => { if (!group.locked && !activeItem.locked) activeItem.onClick(); }}
                  >
                    <Icon name={itemIconName(group.id, activeItem.id)} />
                    <span className="ib-tooltip">{activeItem.label} <small>{coordinate}</small></span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ── Drawer mobile (hideRail) ─────────────────────────────────────────────────
// Reprodução exata da apresentação anterior à reformulação do kit — o kit
// não define nada para telas pequenas (larguras fixas de desktop), então o
// drawer mobile permanece fora do escopo desta troca.

function LegacyMobileSidebar({ groups, header, footer, railHelp, railAvatar, workspaceAvatar, className = '' }: Pick<SidebarProps, 'groups' | 'header' | 'footer' | 'railHelp' | 'railAvatar' | 'workspaceAvatar' | 'className'>) {
  const activeGroupId = groups.find(g => g.items.some(i => i.active))?.id ?? groups[0]?.id;
  const [expandedId, setExpandedId] = useState(activeGroupId);
  useEffect(() => { setExpandedId(activeGroupId); }, [activeGroupId]);

  return (
    <aside className={`h-full flex-shrink-0 flex flex-col bg-surface-2 overflow-hidden w-[280px] border-r border-edge/70 ${className}`}>
      <div className="w-full h-full flex flex-col min-w-0">
        {header && <div className="flex-shrink-0 px-4 pt-2 pb-4">{header}</div>}

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5 [scrollbar-gutter:stable]">
          {groups.map(group => {
            const isOpen = expandedId === group.id;
            const groupIcon = group.locked ? <Lock size={15} /> : (group.icon ?? group.items[0]?.icon);

            return (
              <div key={group.id}>
                <button
                  onClick={() => setExpandedId(curr => (curr === group.id ? '' : group.id))}
                  aria-expanded={isOpen}
                  title={group.label}
                  className={`w-full flex items-center gap-3 rounded-control text-sm px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    group.locked ? 'text-fg-subtle/70' : 'text-fg hover:bg-surface-3'
                  }`}
                >
                  <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-[18px] [&>svg]:h-[18px]">{groupIcon}</span>
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="flex-1 min-w-0 truncate text-left">{group.label}</span>
                    <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-0.5 pt-1 pb-2">
                    {group.items.map(item => {
                      const locked = group.locked || item.locked;
                      return (
                        <button
                          key={item.id}
                          onClick={locked ? undefined : item.onClick}
                          title={locked ? LOCKED_TOOLTIP : item.label}
                          disabled={locked}
                          aria-current={item.active ? 'page' : undefined}
                          className={`group w-full flex items-center gap-2.5 pl-9 pr-3 py-2 rounded-control text-xs font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                            locked ? 'text-fg-subtle/60 cursor-not-allowed' : item.active ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
                          }`}
                        >
                          <span className="flex-shrink-0 flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{item.icon}</span>
                          <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
                          {locked && <Lock size={11} className="flex-shrink-0 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {(railHelp || railAvatar || workspaceAvatar) && (
          <div className="flex-shrink-0 px-3 py-3 border-t border-edge flex items-center justify-between">
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
          </div>
        )}

        {footer && <div className="flex-shrink-0 px-3 py-3 border-t border-edge">{footer}</div>}
      </div>
    </aside>
  );
}
