import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Modal, Button, Badge } from '../ui';
import { useAuth } from '../../lib/auth';
import { listInvoices } from '../../lib/nfe/nfeService';
import { linkPurchaseOrdersToInvoices, listActiveLinksForPurchaseOrder } from '../../lib/purchaseOrders/poService';
import type { NfeInvoice } from '../../lib/nfe/nfeTypes';

interface PoLinkNfeModalProps {
  companyId: string;
  purchaseOrderId: string;
  onClose: () => void;
  onLinked: () => void;
}

export function PoLinkNfeModal({ companyId, purchaseOrderId, onClose, onLinked }: PoLinkNfeModalProps) {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<NfeInvoice[]>([]);
  const [alreadyLinkedIds, setAlreadyLinkedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [allInvoices, links] = await Promise.all([listInvoices(), listActiveLinksForPurchaseOrder(purchaseOrderId)]);
      setInvoices(allInvoices);
      setAlreadyLinkedIds(new Set(links.map(l => l.invoiceId)));
      setLoading(false);
    })();
  }, [purchaseOrderId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (saving || selected.size === 0) return;
    setSaving(true);
    try {
      await linkPurchaseOrdersToInvoices(companyId, [purchaseOrderId], Array.from(selected), profile?.id ?? '', profile?.email ?? '');
      onLinked();
    } catch (err) {
      console.error('Error linking purchase order to invoices:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Vincular NF-es" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">Selecione uma ou várias notas fiscais desta empresa para vincular a esta OC.</p>

        {loading && <p className="text-sm text-fg-subtle">Carregando...</p>}

        {!loading && invoices.length === 0 && <p className="text-sm text-fg-subtle">Nenhuma NF-e encontrada.</p>}

        <div className="max-h-80 overflow-auto space-y-1.5">
          {invoices.map(invoice => {
            const linked = alreadyLinkedIds.has(invoice.id);
            const checked = selected.has(invoice.id);
            return (
              <label
                key={invoice.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ${linked ? 'opacity-50 cursor-not-allowed' : 'border-edge hover:bg-surface-3/40'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input type="checkbox" checked={checked || linked} disabled={linked} onChange={() => toggle(invoice.id)} />
                  <div className="min-w-0">
                    <p className="text-fg truncate">NF-e {invoice.invoice_number ?? invoice.invoice_key.slice(-6)} — {invoice.supplier_name ?? 'Fornecedor não identificado'}</p>
                    <p className="text-xs text-fg-subtle">{invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('pt-BR') : '—'}</p>
                  </div>
                </div>
                {linked && <Badge variant="neutral">Já vinculada</Badge>}
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || selected.size === 0}>
            <Link2 size={16} /> {saving ? 'Vinculando...' : `Vincular (${selected.size})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
