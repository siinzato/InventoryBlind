import { useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, Button, Input } from '../ui';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { logAuditEvent } from '../../lib/auditLogService';

interface BulkEditFieldsModalProps {
  productIds: string[];
  onClose: () => void;
  onSaved: () => void;
}

/** Edição em massa — só os dois campos que fazem sentido aplicar ao mesmo valor
 *  para vários produtos de uma vez (Local, Preço). Nome/SKU/EAN são únicos por
 *  produto e continuam só editáveis um a um no Inspetor. */
export function BulkEditFieldsModal({ productIds, onClose, onSaved }: BulkEditFieldsModalProps) {
  const { profile, companyId } = useAuth();
  const [location, setLocation] = useState('');
  const [applyLocation, setApplyLocation] = useState(false);
  const [price, setPrice] = useState('');
  const [applyPrice, setApplyPrice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = (applyLocation || applyPrice) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    if (!window.confirm(`Aplicar alteração a ${productIds.length} produto(s)?`)) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, string | number | null> = { updated_at: new Date().toISOString() };
      if (applyLocation) patch.location = location.trim() || null;
      if (applyPrice) patch.price = price.trim() ? Number(price.replace(',', '.')) : null;

      const { error: updateError } = await supabase.from('products').update(patch).in('id', productIds);
      if (updateError) throw updateError;

      if (companyId && profile) {
        await logAuditEvent({
          companyId, userId: profile.id, userEmail: profile.email ?? '', action: 'products.updated',
          resourceType: 'product', description: `Edição em massa (${productIds.length} produtos)`,
          metadata: { productIds, fields: Object.keys(patch).filter(k => k !== 'updated_at') },
        });
      }
      onSaved();
    } catch (err) {
      console.error('[BulkEditFieldsModal] save', err);
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Editar em massa (${productIds.length} produto${productIds.length === 1 ? '' : 's'})`} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={applyLocation} onChange={e => setApplyLocation(e.target.checked)} className="mt-2.5" />
          <div className="flex-1">
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Local</label>
            <Input value={location} disabled={!applyLocation} onChange={e => setLocation(e.target.value)} placeholder="Ex.: A-03-02" />
          </div>
        </div>
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={applyPrice} onChange={e => setApplyPrice(e.target.checked)} className="mt-2.5" />
          <div className="flex-1">
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Preço</label>
            <Input type="number" step="0.01" value={price} disabled={!applyPrice} onChange={e => setPrice(e.target.value)} placeholder="0,00" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave}><Save size={16} /> {saving ? 'Salvando...' : 'Aplicar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
