import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Panel, PanelSection, Button, type SidebarNavGroup } from '../ui';
import { listShortcuts, type UserShortcut } from '../../lib/shortcuts/shortcutService';
import { buildRouteRegistry, findRouteOption, type ShortcutRouteOption } from '../../lib/shortcuts/routeRegistry';
import { ShortcutManagerModal } from './ShortcutManagerModal';

interface MyShortcutsCardProps {
  companyId: string;
  userId: string;
  navGroups: SidebarNavGroup[];
}

/** Faixa fixa do topo do dashboard — sempre "Acesso rápido", para todo usuário e
 *  plano. O diagnóstico nunca ocupa este espaço; ele é um aviso à parte.
 *
 *  Compacta e horizontal (não é mais um Panel cheio de wrap) — mesmos dados e
 *  mesma lógica de sempre (listShortcuts/ShortcutManagerModal), só reapresentados
 *  como uma única linha discreta em vez de um card grande. */
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
      <PanelSection padding="sm" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-label flex-shrink-0">Acesso rápido</p>

        <div className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2 min-w-0">
          {visible.length === 0 ? (
            <p className="text-sm text-fg-subtle">Nenhum atalho configurado ainda.</p>
          ) : (
            visible.map(({ shortcut, option }) => (
              <button
                key={shortcut.id}
                type="button"
                onClick={() => navGroups.flatMap(g => g.items).find(i => i.id === option.id)?.onClick()}
                className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-accent transition-colors"
              >
                <span className="[&>svg]:w-4 [&>svg]:h-4">{option.icon}</span>
                {option.label}
              </button>
            ))
          )}
        </div>

        <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={() => setShowManager(true)}>
          <Settings2 size={14} /> Gerenciar
        </Button>
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
