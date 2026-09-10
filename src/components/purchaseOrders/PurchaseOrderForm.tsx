import { useState } from 'react';
import { Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import { Modal, Button, Input, Textarea, Table, Thead, Tr, Th, Td } from '../ui';
import { useAuth } from '../../lib/auth';
import { createPurchaseOrder } from '../../lib/purchaseOrders/poService';
import { validatePoItemFields } from '../../lib/purchaseOrders/poDecimalUtils';
import { findPossibleDuplicatePos } from '../../lib/purchaseOrders/poNumberUtils';
import type { PurchaseOrder } from '../../lib/purchaseOrders/poTypes';

interface PurchaseOrderFormProps {
  companyId: string;
  existingOrders: PurchaseOrder[];
  onClose: () => void;
  onSaved: () => void;
}

interface DraftItem {
  description: string;
  originCode: string;
  ean: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_ITEM: DraftItem = { description: '', originCode: '', ean: '', unit: '', quantity: '', unitPrice: '' };

export function PurchaseOrderForm({ companyId, existingOrders, onClose, onSaved }: PurchaseOrderFormProps) {
  const { profile } = useAuth();
  const [poNumber, setPoNumber] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierCnpj, setSupplierCnpj] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [errors, setErrors] = useState<Record<number, ReturnType<typeof validatePoItemFields>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const duplicateWarning = poNumber.trim() && supplierName.trim()
    ? findPossibleDuplicatePos(existingOrders, poNumber, supplierName)
    : [];

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it));
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (index: number) => setItems(prev => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (saving) return;
    setSaveError(null);

    if (!poNumber.trim()) { setSaveError('Informe o número da OC.'); return; }
    if (!supplierName.trim()) { setSaveError('Informe o fornecedor.'); return; }

    const nextErrors: Record<number, ReturnType<typeof validatePoItemFields>> = {};
    let hasError = false;
    items.forEach((item, idx) => {
      const itemErrors = validatePoItemFields({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice });
      if (Object.keys(itemErrors).length > 0) { nextErrors[idx] = itemErrors; hasError = true; }
    });
    setErrors(nextErrors);
    if (hasError) return;
    if (items.length === 0) { setSaveError('Adicione pelo menos um item.'); return; }

    setSaving(true);
    try {
      await createPurchaseOrder(
        companyId,
        { poNumber: poNumber.trim(), origin: 'manual', supplierName: supplierName.trim(), supplierCnpj: supplierCnpj.trim() || null, issueDate: issueDate || null, notes: notes.trim() || null },
        items.map((item, idx) => ({
          lineNumber: idx + 1, originCode: item.originCode.trim() || null, ean: item.ean.trim() || null,
          description: item.description.trim(), unit: item.unit.trim() || null,
          quantity: Number(item.quantity.replace(',', '.')),
          unitPrice: item.unitPrice.trim() ? Number(item.unitPrice.replace(',', '.')) : null,
          totalValue: item.unitPrice.trim() && item.quantity.trim() ? Number(item.unitPrice.replace(',', '.')) * Number(item.quantity.replace(',', '.')) : null,
        })),
        profile?.id ?? '', profile?.email ?? ''
      );
      onSaved();
    } catch (err) {
      console.error('Error creating purchase order:', err);
      setSaveError('Não foi possível salvar a OC. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Nova Ordem de Compra" maxWidth="max-w-3xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Número da OC *</label>
            <Input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="OC-1001" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Fornecedor *</label>
            <Input value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Nome do fornecedor" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">CNPJ do fornecedor</label>
            <Input value={supplierCnpj} onChange={e => setSupplierCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Data de emissão</label>
            <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
          </div>
        </div>

        {duplicateWarning.length > 0 && (
          <div className="p-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>Já existe {duplicateWarning.length === 1 ? 'uma OC' : `${duplicateWarning.length} OCs`} com este número para este fornecedor. Confira antes de salvar — a OC existente não será sobrescrita.</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Observação</label>
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="border-t border-edge pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-fg">Itens</p>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Adicionar item</Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Descrição *</Th>
                  <Th>Código</Th>
                  <Th>EAN</Th>
                  <Th>Unid.</Th>
                  <Th>Qtd *</Th>
                  <Th>Preço unit.</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {items.map((item, idx) => (
                  <Tr key={idx}>
                    <Td>
                      <Input value={item.description} onChange={e => updateItem(idx, { description: e.target.value })} className="min-w-[160px]" />
                      {errors[idx]?.description && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors[idx].description}</p>}
                    </Td>
                    <Td><Input value={item.originCode} onChange={e => updateItem(idx, { originCode: e.target.value })} className="w-24" /></Td>
                    <Td><Input value={item.ean} onChange={e => updateItem(idx, { ean: e.target.value })} className="w-28" /></Td>
                    <Td><Input value={item.unit} onChange={e => updateItem(idx, { unit: e.target.value })} className="w-16" /></Td>
                    <Td>
                      <Input value={item.quantity} onChange={e => updateItem(idx, { quantity: e.target.value })} className="w-20 font-mono" />
                      {errors[idx]?.quantity && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors[idx].quantity}</p>}
                    </Td>
                    <Td><Input value={item.unitPrice} onChange={e => updateItem(idx, { unitPrice: e.target.value })} className="w-24 font-mono" /></Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                        <Trash2 size={14} />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>

        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Salvando...' : 'Salvar OC'}</Button>
        </div>
      </div>
    </Modal>
  );
}
