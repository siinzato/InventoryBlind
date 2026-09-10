import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { buildLibraryEntries, type LibraryEntry } from '../../../lib/automation/nodeMeta';

interface Props {
  /** Posição em coordenadas de tela (clientX/clientY) — null fecha o seletor. */
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
}

/** Seletor pesquisável de blocos, aberto pelo botão "+" contextual de uma
 *  saída (§14) — mesmo catálogo da biblioteca lateral, num popover compacto
 *  perto de onde o usuário clicou, para não obrigar a ir até a lateral para
 *  cada bloco novo. */
export function NodePicker({ anchor, onClose, onPick }: Props) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => buildLibraryEntries(), []);

  useEffect(() => {
    if (anchor != null) {
      setSearch('');
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [anchor]);

  useEffect(() => {
    if (anchor == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anchor, onClose]);

  if (anchor == null) return null;

  const query = search.trim().toLowerCase();
  const filtered = query === '' ? entries : entries.filter(e => e.label.toLowerCase().includes(query) || e.description.toLowerCase().includes(query));

  // Mantém o popover dentro da viewport — um clique perto da borda direita ou
  // do fundo da tela não deve abrir um card cortado para fora.
  const left = Math.min(anchor.x, window.innerWidth - 280);
  const top = Math.min(anchor.y, window.innerHeight - 360);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex max-h-80 w-64 flex-col overflow-hidden rounded-container border border-edge bg-surface shadow-overlay"
        style={{ left, top }}
      >
        <div className="border-b border-edge p-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar bloco…"
              className="w-full rounded-control border border-edge bg-surface-3 py-1.5 pl-8 pr-2 text-xs text-fg placeholder:text-fg-subtle"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-fg-subtle">Nenhum bloco encontrado.</p>}
          {filtered.map(entry => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => onPick(entry)}
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
    </>
  );
}
