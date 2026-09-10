import { useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, Button, Select } from '../ui';
import { useAuth } from '../../lib/auth';
import { bulkAssignProductAssociation, type ProductBrand, type ProductLine } from '../../lib/productBrands/productBrandService';

interface AssignBrandLineModalProps {
  companyId: string;
  productIds: string[];
  brands: ProductBrand[];
  lines: ProductLine[];
  onClose: () => void;
  onSaved: () => void;
}

/** Altera marca/linha de um ou vários produtos — só a associação, nunca o produto. */
export function AssignBrandLineModal({ companyId, productIds, brands, lines, onClose, onSaved }: AssignBrandLineModalProps) {
  const { profile } = useAuth();
  const [brandId, setBrandId] = useState('');
  const [lineId, setLineId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linesForBrand = lines.filter(l => l.brandId === brandId);

  const handleSave = async () => {
    if (saving || !window.confirm(`Confirmar marca/linha para ${productIds.length} produto(s)?`)) return;
    setSaving(true);
    setError(null);
    try {
      await bulkAssignProductAssociation(companyId, productIds, brandId || null, lineId || null, profile?.id ?? '', profile?.email ?? '');
      onSaved();
    } catch (err) {
      console.error('Error assigning brand/line:', err);
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Alterar marca/linha (${productIds.length} produto${productIds.length === 1 ? '' : 's'})`} maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Marca</label>
          <Select value={brandId} onChange={e => { setBrandId(e.target.value); setLineId(''); }}>
            <option value="">Sem marca</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Linha</label>
          <Select value={lineId} onChange={e => setLineId(e.target.value)} disabled={!brandId}>
            <option value="">Sem linha</option>
            {linesForBrand.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Salvando...' : 'Confirmar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
