import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal, Button, Input, Badge, PanelSection } from '../ui';
import { getCauseTaxonomy, setCauseCategoryActive, setCauseSubcauseActive, type RcaTaxonomyCategory } from '../../lib/rcaService';

/** Remove marcas diacríticas combinantes (U+0300–U+036F) após normalização NFD — evita
 *  depender de um literal de regex com caractere combinante no código-fonte. */
function stripDiacritics(text: string): string {
  return Array.from(text.normalize('NFD'))
    .filter(ch => { const code = ch.codePointAt(0) ?? 0; return code < 0x0300 || code > 0x036f; })
    .join('');
}

function slugify(label: string): string {
  return stripDiacritics(label.toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

interface RcaTaxonomyModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  userId: string;
  userEmail: string;
}

/** Configuração de taxonomia por workspace: os 11 padrões vêm sempre disponíveis
 *  (DEFAULT_CAUSE_CATEGORIES em rcaAlgorithm.ts); aqui só é possível desativar um padrão
 *  ou adicionar uma categoria/subcausa customizada — nunca excluir uma que já tenha
 *  histórico (não há ação de exclusão nesta tela, de propósito). */
export function RcaTaxonomyModal({ open, onClose, companyId, userId, userEmail }: RcaTaxonomyModalProps) {
  const [taxonomy, setTaxonomy] = useState<RcaTaxonomyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [newSubcause, setNewSubcause] = useState<Record<string, string>>({});

  const load = useCallback(() => { setLoading(true); getCauseTaxonomy(companyId).then(t => { setTaxonomy(t); setLoading(false); }); }, [companyId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const toggleCategory = async (cat: RcaTaxonomyCategory) => {
    await setCauseCategoryActive(companyId, cat.code, cat.label, cat.isDefault, !cat.isActive, userId, userEmail);
    load();
  };

  const toggleSubcause = async (cat: RcaTaxonomyCategory, sub: RcaTaxonomyCategory['subcauses'][number]) => {
    await setCauseSubcauseActive(companyId, cat.code, sub.code, sub.label, sub.isDefault, !sub.isActive, userId, userEmail);
    load();
  };

  const addCategory = async () => {
    const label = newCategoryLabel.trim();
    if (!label) return;
    await setCauseCategoryActive(companyId, slugify(label), label, false, true, userId, userEmail);
    setNewCategoryLabel('');
    load();
  };

  const addSubcause = async (cat: RcaTaxonomyCategory) => {
    const label = (newSubcause[cat.code] ?? '').trim();
    if (!label) return;
    await setCauseSubcauseActive(companyId, cat.code, slugify(label), label, false, true, userId, userEmail);
    setNewSubcause(prev => ({ ...prev, [cat.code]: '' }));
    load();
  };

  return (
    <Modal open={open} onClose={onClose} title="Configurar Taxonomia de Causas" maxWidth="max-w-2xl">
      {loading ? (
        <p className="text-sm text-fg-subtle">Carregando...</p>
      ) : (
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <p className="text-xs text-fg-subtle">
            Categorias padrão não podem ser excluídas (preserva histórico) — apenas desativadas. Você pode adicionar categorias e subcausas customizadas.
          </p>

          {taxonomy.map(cat => (
            <div key={cat.code} className="border border-edge rounded-container">
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">{cat.label}</p>
                  {cat.isDefault && <Badge variant="neutral">padrão</Badge>}
                  {!cat.isActive && <Badge variant="warning">desativada</Badge>}
                </div>
                <Button variant="secondary" size="sm" onClick={() => toggleCategory(cat)}>
                  {cat.isActive ? 'Desativar' : 'Ativar'}
                </Button>
              </div>
              <PanelSection padding="sm" className="border-t border-edge space-y-1.5">
                {cat.subcauses.map(sub => (
                  <div key={sub.code} className="flex items-center justify-between gap-2 text-xs">
                    <span className={sub.isActive ? 'text-fg-muted' : 'text-fg-subtle line-through'}>{sub.label}</span>
                    <button type="button" className="text-accent hover:underline" onClick={() => toggleSubcause(cat, sub)}>
                      {sub.isActive ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Input
                    value={newSubcause[cat.code] ?? ''}
                    onChange={e => setNewSubcause(prev => ({ ...prev, [cat.code]: e.target.value }))}
                    placeholder="Nova subcausa..."
                    className="flex-1 text-xs"
                  />
                  <Button variant="secondary" size="sm" onClick={() => addSubcause(cat)}><Plus size={12} /></Button>
                </div>
              </PanelSection>
            </div>
          ))}

          <div className="flex gap-2 pt-2 border-t border-edge">
            <Input value={newCategoryLabel} onChange={e => setNewCategoryLabel(e.target.value)} placeholder="Nova categoria de causa..." className="flex-1" />
            <Button onClick={addCategory}><Plus size={14} /> Adicionar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
