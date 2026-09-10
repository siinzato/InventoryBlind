import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { Modal, Button, Badge, Input, Textarea } from '../../ui';
import { useAuth } from '../../../lib/auth';
import { getCategories, upsertCategory, setCategoryActive } from '../../../lib/closingReports/closingReportService';
import type { ClosingCategory } from '../../../lib/closingReports/closingReportTypes';

interface ClosingCategoriesModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onChanged: () => void;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Cadastro/edição das categorias e palavras-chave do resumo de fechamento. Nunca exclui fisicamente — só ativa/desativa. */
export function ClosingCategoriesModal({ open, onClose, companyId, onChanged }: ClosingCategoriesModalProps) {
  const { profile } = useAuth();
  const [categories, setCategories] = useState<ClosingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newKeywords, setNewKeywords] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getCategories(companyId).then(cats => { if (!cancelled) { setCategories(cats); setLoading(false); } });
    return () => { cancelled = true; };
  }, [open, companyId]);

  const userId = profile?.id ?? '';
  const userEmail = profile?.email ?? '';

  const handleKeywordsBlur = async (category: ClosingCategory, keywordsText: string) => {
    const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean);
    setSavingId(category.id);
    const saved = await upsertCategory(companyId, { id: category.id, key: category.key, name: category.name, keywords }, userId, userEmail);
    if (saved) setCategories(prev => prev.map(c => c.id === saved.id ? saved : c));
    setSavingId(null);
    onChanged();
  };

  const handleToggleActive = async (category: ClosingCategory) => {
    setSavingId(category.id);
    const ok = await setCategoryActive(companyId, category.id, !category.active, userId, userEmail);
    if (ok) setCategories(prev => prev.map(c => c.id === category.id ? { ...c, active: !c.active } : c));
    setSavingId(null);
    onChanged();
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    const keywords = newKeywords.split(',').map(k => k.trim()).filter(Boolean);
    const key = slugify(name) || `categoria_${Date.now()}`;
    const saved = await upsertCategory(companyId, { key, name, keywords }, userId, userEmail);
    if (saved) {
      setCategories(prev => [...prev, saved]);
      setNewName('');
      setNewKeywords('');
      onChanged();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Categorias do resumo de fechamento" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {loading && <p className="text-sm text-fg-subtle">Carregando...</p>}

        {!loading && categories.map(category => (
          <div key={category.id} className="rounded-lg border border-edge p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">{category.name}</p>
              <button type="button" onClick={() => handleToggleActive(category)} disabled={savingId === category.id}>
                <Badge variant={category.active ? 'success' : 'neutral'}>{category.active ? 'Ativa' : 'Inativa'}</Badge>
              </button>
            </div>
            <Textarea
              rows={2}
              defaultValue={category.keywords.join(', ')}
              placeholder="Palavras-chave separadas por vírgula"
              onBlur={e => handleKeywordsBlur(category, e.target.value)}
            />
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-edge p-3 space-y-2">
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Nova categoria</p>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome da categoria" />
          <Textarea rows={2} value={newKeywords} onChange={e => setNewKeywords(e.target.value)} placeholder="Palavras-chave separadas por vírgula" />
          <Button size="sm" onClick={handleAdd} disabled={!newName.trim()}>
            <Plus size={14} /> Adicionar categoria
          </Button>
        </div>

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={onClose}>
            <Save size={14} /> Concluído
          </Button>
        </div>
      </div>
    </Modal>
  );
}
