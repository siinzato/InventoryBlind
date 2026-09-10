import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { buildLibraryEntries, type LibraryCategory, type LibraryEntry } from '../../../lib/automation/nodeMeta';
import { readRecentBlockKeys } from '../../../lib/automation/flowPrefs';

const CATEGORY_ORDER: LibraryCategory[] = ['Lógica', 'Tempo', 'Ações', 'Notificações', 'Integrações'];

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAdd: (entry: LibraryEntry) => void;
  onDragStartEntry: (entry: LibraryEntry, event: React.DragEvent) => void;
}

/** Biblioteca de blocos — pesquisa, categorias, clique ou arrastar (§8).
 *
 *  Só lista o que o motor de fato executa: blocos de controle (condição,
 *  ramificação, escolha, repetição), tempo (espera, aguardar retorno) e as
 *  ações reais do registry, categorizadas pelo próprio `group` que a ação já
 *  declara. Gatilho não aparece — só existe um por workflow, e trocá-lo é uma
 *  ação dentro do próprio node de gatilho, não um item de biblioteca. */
export function NodeLibraryPanel({ collapsed, onToggleCollapsed, onAdd, onDragStartEntry }: Props) {
  const [search, setSearch] = useState('');
  const entries = useMemo(() => buildLibraryEntries(), []);
  const recentKeys = useMemo(() => readRecentBlockKeys(), []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return entries;
    return entries.filter(e => e.label.toLowerCase().includes(query) || e.description.toLowerCase().includes(query));
  }, [entries, search]);

  const recents = useMemo(
    () => recentKeys.map(key => entries.find(e => e.key === key)).filter((e): e is LibraryEntry => e != null),
    [entries, recentKeys]
  );

  const grouped = useMemo(() => {
    const map = new Map<LibraryCategory, LibraryEntry[]>();
    for (const entry of filtered) map.set(entry.category, [...(map.get(entry.category) ?? []), entry]);
    return map;
  }, [filtered]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex h-full w-9 flex-shrink-0 items-center justify-center border-r border-edge bg-surface-2 text-fg-subtle transition-colors hover:text-fg"
        title="Mostrar biblioteca de blocos"
        aria-label="Mostrar biblioteca de blocos"
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col border-r border-edge bg-surface-2 md:relative md:inset-auto md:z-auto md:h-full md:w-64 md:flex-shrink-0">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
        <p className="flex-1 text-overline">Blocos</p>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded p-1 text-fg-subtle transition-colors hover:text-fg"
          title="Recolher biblioteca"
          aria-label="Recolher biblioteca"
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="border-b border-edge px-3 py-2.5">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar bloco…"
            className="w-full rounded-control border border-edge bg-surface py-1.5 pl-8 pr-2 text-xs text-fg placeholder:text-fg-subtle"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {recents.length > 0 && search.trim() === '' && (
          <LibraryGroup title="Recentes" entries={recents} onAdd={onAdd} onDragStartEntry={onDragStartEntry} />
        )}

        {CATEGORY_ORDER.map(category => {
          const items = grouped.get(category);
          if (!items || items.length === 0) return null;
          return <LibraryGroup key={category} title={category} entries={items} onAdd={onAdd} onDragStartEntry={onDragStartEntry} />;
        })}

        {filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-fg-subtle">Nenhum bloco encontrado.</p>}
      </div>
    </div>
  );
}

function LibraryGroup({
  title,
  entries,
  onAdd,
  onDragStartEntry,
}: {
  title: string;
  entries: LibraryEntry[];
  onAdd: (entry: LibraryEntry) => void;
  onDragStartEntry: (entry: LibraryEntry, event: React.DragEvent) => void;
}) {
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{title}</p>
      <div className="space-y-1">
        {entries.map(entry => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              draggable
              onDragStart={e => onDragStartEntry(entry, e)}
              onClick={() => onAdd(entry)}
              title={entry.description}
              className="flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-3"
            >
              <Icon size={14} className={`mt-0.5 flex-shrink-0 ${entry.colorClass}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-fg">{entry.label}</span>
                <span className="block truncate text-[11px] text-fg-subtle">{entry.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
