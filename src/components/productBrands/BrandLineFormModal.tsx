import { useState } from 'react';
import { Modal, Button, Input, Textarea, Select } from '../ui';
import { useAuth } from '../../lib/auth';
import { createBrand, updateBrand, createLine, updateLine, type ProductBrand, type ProductLine } from '../../lib/productBrands/productBrandService';
import type { TeamMember } from '../../lib/tasks/types';

interface BrandLineFormModalProps {
  companyId: string;
  mode: 'brand' | 'line';
  brands: ProductBrand[];
  members: TeamMember[];
  editingBrand?: ProductBrand;
  editingLine?: ProductLine;
  defaultBrandId?: string;
  onClose: () => void;
  onSaved: () => void;
}

function parseKeywords(text: string): string[] {
  return text.split(',').map(k => k.trim()).filter(Boolean);
}

export function BrandLineFormModal({ companyId, mode, brands, members, editingBrand, editingLine, defaultBrandId, onClose, onSaved }: BrandLineFormModalProps) {
  const { profile } = useAuth();
  const [name, setName] = useState(editingBrand?.name ?? editingLine?.name ?? '');
  const [code, setCode] = useState(editingBrand?.code ?? '');
  const [keywordsText, setKeywordsText] = useState((editingBrand?.keywords ?? editingLine?.keywords ?? []).join(', '));
  const [brandId, setBrandId] = useState(editingLine?.brandId ?? defaultBrandId ?? brands[0]?.id ?? '');
  const [primaryResponsibleId, setPrimaryResponsibleId] = useState(editingBrand?.primaryResponsibleId ?? editingLine?.primaryResponsibleId ?? '');
  const [additionalIds, setAdditionalIds] = useState<string[]>(editingBrand?.additionalResponsibleIds ?? editingLine?.additionalResponsibleIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAdditional = (id: string) => {
    setAdditionalIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) { setError('Informe o nome.'); return; }
    if (mode === 'line' && !brandId) { setError('Selecione a marca.'); return; }

    setSaving(true);
    setError(null);
    const userId = profile?.id ?? '';
    const userEmail = profile?.email ?? '';
    try {
      if (mode === 'brand') {
        const input = { name: name.trim(), code: code.trim() || null, keywords: parseKeywords(keywordsText), primaryResponsibleId: primaryResponsibleId || null, additionalResponsibleIds: additionalIds };
        if (editingBrand) await updateBrand(companyId, editingBrand.id, input, userId, userEmail);
        else await createBrand(companyId, input, userId, userEmail);
      } else {
        const input = { brandId, name: name.trim(), keywords: parseKeywords(keywordsText), primaryResponsibleId: primaryResponsibleId || null, additionalResponsibleIds: additionalIds };
        if (editingLine) await updateLine(companyId, editingLine.id, input, userId, userEmail);
        else await createLine(companyId, input, userId, userEmail);
      }
      onSaved();
    } catch (err) {
      console.error('Error saving brand/line:', err);
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'brand' ? (editingBrand ? 'Editar marca' : 'Nova marca') : (editingLine ? 'Editar linha' : 'Nova linha')} maxWidth="max-w-lg">
      <div className="space-y-4">
        {mode === 'line' && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Marca *</label>
            <Select value={brandId} onChange={e => setBrandId(e.target.value)} disabled={!!editingLine}>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Nome *</label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>

        {mode === 'brand' && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Código (opcional)</label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Ex: GC" />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Aliases/palavras-chave adicionais (separados por vírgula)</label>
          <Textarea rows={2} value={keywordsText} onChange={e => setKeywordsText(e.target.value)} placeholder="O nome já funciona como palavra-chave automaticamente" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Responsável principal</label>
          <Select value={primaryResponsibleId} onChange={e => setPrimaryResponsibleId(e.target.value)}>
            <option value="">Nenhum</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email ?? m.id}</option>)}
          </Select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Responsáveis adicionais</label>
          <div className="max-h-32 overflow-auto space-y-1 border border-edge rounded-lg p-2">
            {members.map(m => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={additionalIds.includes(m.id)} onChange={() => toggleAdditional(m.id)} />
                {m.name ?? m.email ?? m.id}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
