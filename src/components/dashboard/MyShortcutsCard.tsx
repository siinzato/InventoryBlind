import { useEffect, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { Panel, PanelSection, Button, type SidebarNavGroup } from '../ui';
import { listShortcuts, type UserShortcut } from '../../lib/shortcuts/shortcutService';
import { buildRouteRegistry, findRouteOption, type ShortcutRouteOption } from '../../lib/shortcuts/routeRegistry';
import { ShortcutManagerModal } from './ShortcutManagerModal';

interface MyShortcutsCardProps {
  companyId: string;
  userId: string;
  navGroups: SidebarNavGroup[];
}

/** Card fixo do topo do dashboard — sempre "Meus Atalhos", para todo usuário e
 *  plano. O diagnóstico nunca ocupa este espaço; ele é um aviso à parte. */
export function MyShortcutsCard({ companyId, userId, navGroups }: MyShortcutsCardProps) {
  const [shortcuts, setShortcuts] = useState<UserShortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showManager, setShowManager] = useState(false);

  const registry = buildRouteRegistry(navGroups);

  const load = async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    try {
      setShortcuts(await listShortcuts(companyId, userId));
    } catch (err) {
      console.error('Error loading shortcuts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, userId]);

  // Rota que perdeu permissão/plano some da exibição sem apagar a preferência —
  // a linha continua salva, só deixa de casar com o registro atual.
  const visible = shortcuts
    .map(s => ({ shortcut: s, option: findRouteOption(registry, s.routeKey) }))
    .filter((entry): entry is { shortcut: UserShortcut; option: ShortcutRouteOption } => entry.option != null);

  if (loading) return null;

  return (
    <Panel>
      <PanelSection padding="md" className="flex items-center justify-between">
        <p className="text-title">Meus Atalhos</p>
        <Button variant="ghost" size="sm" onClick={() => setShowManager(true)}>
          <Settings2 size={14} /> Gerenciar
        </Button>
      </PanelSection>

      <PanelSection padding="md">
        {visible.length === 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-subtle">Nenhum atalho configurado ainda.</p>
            <Button size="sm" onClick={() => setShowManager(true)}><Plus size={14} /> Adicionar atalhos</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visible.map(({ shortcut, option }) => (
              <button
                key={shortcut.id}
                type="button"
                onClick={() => navGroups.flatMap(g => g.items).find(i => i.id === option.id)?.onClick()}
                className="flex items-center gap-2 rounded-control border border-edge px-3 py-2 text-sm text-fg hover:bg-surface-3/60 transition-colors"
              >
                <span className="[&>svg]:w-4 [&>svg]:h-4 text-fg-muted">{option.icon}</span>
                {option.label}
              </button>
            ))}
          </div>
        )}
      </PanelSection>

      {showManager && userId && (
        <ShortcutManagerModal
          companyId={companyId}
          userId={userId}
          navGroups={navGroups}
          shortcuts={shortcuts}
          onClose={() => setShowManager(false)}
          onChanged={load}
        />
      )}
    </Panel>
  );
}
