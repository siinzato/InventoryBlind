import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Modal, Button, Input } from '../ui';
import { useAuth } from '../../lib/auth';
import { getInvoiceItems } from '../../lib/nfe/nfeService';
import { addManualAllocation, confirmDetoParaMapping, supplierKeyFor, listActiveLinksForPurchaseOrder } from '../../lib/purchaseOrders/poService';
import type { PurchaseOrder, PurchaseOrderItem } from '../../lib/purchaseOrders/poTypes';
import type { NfeInvoiceItem } from '../../lib/nfe/nfeTypes';

interface PoDetoParaResolverProps {
  companyId: string;
  purchaseOrder: PurchaseOrder;
  poItem: PurchaseOrderItem;
  onClose: () => void;
  onResolved: () => void;
}

/** Resolve manualmente um item de OC sem correspondência automática — o operador
 *  escolhe entre os itens das NF-es vinculadas e opcionalmente ensina o De/Para
 *  para as próximas conferências deste fornecedor+origem. */
export function PoDetoParaResolver({ companyId, purchaseOrder, poItem, onClose, onResolved }: PoDetoParaResolverProps) {
  const { profile } = useAuth();
  const [nfeItems, setNfeItems] = useState<NfeInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNfeItemId, setSelectedNfeItemId] = useState<string>('');
  const [quantity, setQuantity] = useState(String(poItem.quantity));
  const [saveMapping, setSaveMapping] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const links = await listActiveLinksForPurchaseOrder(purchaseOrder.id);
      const items = (await Promise.all(links.map(l => getInvoiceItems(l.invoiceId)))).flat();
      setNfeItems(items);
      setLoading(false);
    })();
  }, [purchaseOrder.id]);

  const handleConfirm = async () => {
    if (saving || !selectedNfeItemId) return;
    const qty = Number(quantity.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) { setError('Informe uma quantidade válida.'); return; }

    setSaving(true);
    setError(null);
    try {
      const activeLinks = await listActiveLinksForPurchaseOrder(purchaseOrder.id);
      const nfeItem = nfeItems.find(i => i.id === selectedNfeItemId);
      const link = activeLinks.find(l => l.invoiceId === nfeItem?.invoice_id);
      if (!link) throw new Error('Vínculo não encontrado.');

      await addManualAllocation(companyId, { poLinkId: link.id, poItemId: poItem.id, nfeItemId: selectedNfeItemId, quantity: qty }, profile?.id ?? '', profile?.email ?? '');

      if (saveMapping && nfeItem?.product_id && poItem.originCode) {
        await confirmDetoParaMapping(
          companyId,
          { supplierKey: supplierKeyFor(purchaseOrder.supplierName), origin: purchaseOrder.origin, matchType: 'code', matchValue: poItem.originCode.trim(), productId: nfeItem.product_id },
          profile?.id ?? '', profile?.email ?? ''
        );
      }

      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar o vínculo manual.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Vincular manualmente — ${poItem.description}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">Escolha o item da NF-e que corresponde a este item da OC.</p>

        {loading && <p className="text-sm text-fg-subtle">Carregando...</p>}

        {!loading && nfeItems.length === 0 && <p className="text-sm text-fg-subtle">Nenhum item de NF-e disponível nas notas vinculadas.</p>}

        <div className="max-h-64 overflow-auto space-y-1.5">
          {nfeItems.map(item => (
            <label key={item.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${selectedNfeItemId === item.id ? 'border-accent bg-accent/5' : 'border-edge hover:bg-surface-3/40'}`}>
              <input type="radio" name="nfeItem" checked={selectedNfeItemId === item.id} onChange={() => setSelectedNfeItemId(item.id)} />
              <div className="min-w-0">
                <p className="text-fg truncate">{item.description ?? item.nfe_code ?? '—'}</p>
                <p className="text-xs text-fg-subtle">Código: {item.nfe_code ?? '—'} · Qtd: {item.expected_quantity} · Unit: {item.unit_value ?? '—'}</p>
              </div>
            </label>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Quantidade a alocar</label>
          <Input value={quantity} onChange={e => setQuantity(e.target.value)} className="w-32 font-mono" />
        </div>

        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={saveMapping} onChange={e => setSaveMapping(e.target.checked)} />
          Salvar este De/Para para as próximas conferências
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={saving || !selectedNfeItemId}>
            <Link2 size={16} /> {saving ? 'Salvando...' : 'Confirmar vínculo'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
