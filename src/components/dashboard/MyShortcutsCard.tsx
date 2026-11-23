import { Settings2 } from 'lucide-react';
import { Panel, PanelSection, Button, type SidebarNavGroup } from '../ui';
import { type UserShortcut } from '../../lib/shortcuts/shortcutService';
import { buildRouteRegistry, findRouteOption, type ShortcutRouteOption } from '../../lib/shortcuts/routeRegistry';

interface MyShortcutsCardProps {
  navGroups: SidebarNavGroup[];
  /**
   * Atalhos vindos do PAI, nao carregados aqui.
   *
   * A sidebar passou a mostrar os mesmos favoritos, e duas listas carregadas em
   * paralelo sairiam de sincronia no instante em que alguem editasse de um lado.
   * Quem carrega agora e o `useShortcuts` do App; este card so desenha.
   */
  shortcuts: UserShortcut[];
  carregando: boolean;
  /** Abre o gerenciador, que vive no App porque a sidebar tambem precisa abri-lo. */
  onGerenciar: () => void;
}

/** Faixa fixa do topo do dashboard — sempre "Acesso rápido", para todo usuário e
 *  plano. O diagnóstico nunca ocupa este espaço; ele é um aviso à parte.
 *
 *  Compacta e horizontal (não é mais um Panel cheio de wrap) — mesmos dados e
 *  mesma lógica de sempre (listShortcuts/ShortcutManagerModal), só reapresentados
 *  como uma única linha discreta em vez de um card grande. */
export function MyShortcutsCard({ navGroups, shortcuts, carregando, onGerenciar }: MyShortcutsCardProps) {
  const registry = buildRouteRegistry(navGroups);
  const loading = carregando;

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

        <Button variant="ghost" size="sm" className="flex-shrink-0" onClick={onGerenciar}>
          <Settings2 size={14} /> Gerenciar
        </Button>
      </PanelSection>
    </Panel>
  );
}
