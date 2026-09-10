import { useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import { Modal, Button, Select, type SidebarNavGroup } from '../ui';
import { addShortcut, removeShortcut, reorderShortcuts, MAX_SHORTCUTS, type UserShortcut } from '../../lib/shortcuts/shortcutService';
import { buildRouteRegistry, findRouteOption } from '../../lib/shortcuts/routeRegistry';

interface ShortcutManagerModalProps {
  companyId: string;
  userId: string;
  navGroups: SidebarNavGroup[];
  shortcuts: UserShortcut[];
  onClose: () => void;
  onChanged: () => void;
}

/** Gerenciador simples: adicionar (só a partir do registro de rotas — nunca URL
 *  digitada), remover e reordenar. Até 5 por usuário+workspace. */
export function ShortcutManagerModal({ companyId, userId, navGroups, shortcuts, onClose, onChanged }: ShortcutManagerModalProps) {
  const [selectedRoute, setSelectedRoute] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registry = buildRouteRegistry(navGroups);
  const ordered = [...shortcuts].sort((a, b) => a.orderIndex - b.orderIndex);
  const availableRoutes = registry.filter(r => !shortcuts.some(s => s.routeKey === r.id));

  const handleAdd = async () => {
    if (!selectedRoute || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addShortcut(companyId, userId, selectedRoute);
      setSelectedRoute('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível adicionar o atalho.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    await removeShortcut(id);
    onChanged();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    await reorderShortcuts(next.map(s => s.id));
    onChanged();
  };

  return (
    <Modal open onClose={onClose} title="Gerenciar Meus Atalhos" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="space-y-1.5">
          {ordered.map((shortcut, index) => {
            const option = findRouteOption(registry, shortcut.routeKey);
            return (
              <div key={shortcut.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="[&>svg]:w-4 [&>svg]:h-4 text-fg-muted">{option?.icon}</span>
                  <span className="text-sm text-fg truncate">{option?.label ?? `${shortcut.routeKey} (indisponível)`}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => handleMove(index, -1)} disabled={index === 0} className="p-1 text-fg-subtle hover:text-fg disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" onClick={() => handleMove(index, 1)} disabled={index === ordered.length - 1} className="p-1 text-fg-subtle hover:text-fg disabled:opacity-30">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" onClick={() => handleRemove(shortcut.id)} className="p-1 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {ordered.length === 0 && <p className="text-sm text-fg-subtle">Nenhum atalho ainda.</p>}
        </div>

        {shortcuts.length < MAX_SHORTCUTS && availableRoutes.length > 0 && (
          <div className="flex items-center gap-2 border-t border-edge pt-4">
            <Select value={selectedRoute} onChange={e => setSelectedRoute(e.target.value)} className="flex-1">
              <option value="">Selecione uma função...</option>
              {availableRoutes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
            <Button size="sm" onClick={handleAdd} disabled={!selectedRoute || saving}><Plus size={14} /> Adicionar</Button>
          </div>
        )}
        {shortcuts.length >= MAX_SHORTCUTS && (
          <p className="text-xs text-fg-subtle border-t border-edge pt-4">Limite de {MAX_SHORTCUTS} atalhos atingido — remova um para adicionar outro.</p>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
