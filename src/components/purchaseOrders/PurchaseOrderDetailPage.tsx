import { useEffect, useState } from 'react';
import { ArrowLeft, Link2, Unlink, History, AlertTriangle } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Textarea, Table, Thead, Tr, Th, Td } from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';
import { canAdministerRecords } from '../../lib/admin/recordAdmin';
import { getInvoice } from '../../lib/nfe/nfeService';
import {
  getPurchaseOrder, getPurchaseOrderItems, listActiveLinksForPurchaseOrder, unlinkPurchaseOrderFromInvoice,
  runReconciliation, closePurchaseOrder, reopenPurchaseOrder, countActiveLinksForPurchaseOrder,
  canHardDeletePurchaseOrder, hardDeletePurchaseOrder, listAuditEventsForPurchaseOrder,
} from '../../lib/purchaseOrders/poService';
import {
  PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrder, type PurchaseOrderItem, type PoNfeLink,
  type PoItemComparison, type PoProgressStatus, type PurchaseOrderStatus,
} from '../../lib/purchaseOrders/poTypes';
import type { NfeInvoice } from '../../lib/nfe/nfeTypes';
import { PoLinkNfeModal } from './PoLinkNfeModal';
import { PoReconciliationPanel } from './PoReconciliationPanel';
import { PoDetoParaResolver } from './PoDetoParaResolver';

interface PurchaseOrderDetailPageProps {
  companyId: string;
  purchaseOrderId: string;
  onBack: () => void;
}

const STATUS_BADGE: Record<PurchaseOrderStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', open: 'accent', closed: 'success', closed_with_differences: 'warning', cancelled: 'danger',
};

export function PurchaseOrderDetailPage({ companyId, purchaseOrderId, onBack }: PurchaseOrderDetailPageProps) {
  const { profile } = useAuth();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [links, setLinks] = useState<(PoNfeLink & { invoice: NfeInvoice | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [comparisons, setComparisons] = useState<PoItemComparison[] | null>(null);
  const [notPredictedCount, setNotPredictedCount] = useState(0);
  const [progress, setProgress] = useState<PoProgressStatus | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [resolvingItem, setResolvingItem] = useState<PurchaseOrderItem | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [showCloseWithDifferences, setShowCloseWithDifferences] = useState(false);
  const [activeLinkCount, setActiveLinkCount] = useState(0);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listAuditEventsForPurchaseOrder>>>([]);

  const canWrite = hasPermission(profile?.role, 'inventory.write');
  const canAdminister = canAdministerRecords(profile?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [poData, itemsData, linksData, linkCount, historyData] = await Promise.all([
        getPurchaseOrder(purchaseOrderId),
        getPurchaseOrderItems(purchaseOrderId),
        listActiveLinksForPurchaseOrder(purchaseOrderId),
        countActiveLinksForPurchaseOrder(purchaseOrderId),
        listAuditEventsForPurchaseOrder(companyId, purchaseOrderId),
      ]);
      setPo(poData);
      setItems(itemsData);
      setActiveLinkCount(linkCount);
      setHistory(historyData);

      const linksWithInvoice = await Promise.all(linksData.map(async l => ({ ...l, invoice: await getInvoice(l.invoiceId) })));
      setLinks(linksWithInvoice);
    } catch (err) {
      console.error('Error loading purchase order:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrderId]);

  const handleRunReconciliation = async () => {
    if (!po || reconciling) return;
    setReconciling(true);
    setReconciliationError(null);
    try {
      const result = await runReconciliation(companyId, po, profile?.id ?? '', profile?.email ?? '');
      setComparisons(result.poItemComparisons);
      setNotPredictedCount(result.nfeItemsNotPredictedCount);
      setProgress(result.progress);
    } catch (err) {
      setReconciliationError(err instanceof Error ? err.message : 'Erro ao conciliar. O vínculo com a(s) NF-e(s) continua preservado — tente novamente.');
    } finally {
      setReconciling(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    const reason = window.prompt('Motivo da desvinculação:');
    if (!reason) return;
    try {
      await unlinkPurchaseOrderFromInvoice(companyId, linkId, reason, profile?.id ?? '', profile?.email ?? '');
      load();
    } catch (err) {
      console.error('Error unlinking invoice:', err);
    }
  };

  const handleClose = async (status: 'closed' | 'closed_with_differences' | 'cancelled') => {
    if (!po) return;
    if (status === 'closed_with_differences' && !closeReason.trim()) { setShowCloseWithDifferences(true); return; }
    try {
      await closePurchaseOrder(companyId, po.id, status, closeReason.trim() || null, profile?.id ?? '', profile?.email ?? '');
      setCloseReason('');
      setShowCloseWithDifferences(false);
      load();
    } catch (err) {
      console.error('Error closing purchase order:', err);
    }
  };

  const handleReopen = async () => {
    if (!po) return;
    await reopenPurchaseOrder(companyId, po.id, profile?.id ?? '', profile?.email ?? '');
    load();
  };

  const handleHardDelete = async () => {
    if (!po) return;
    if (!window.confirm('Excluir definitivamente esta OC em rascunho? Esta ação não pode ser desfeita.')) return;
    try {
      await hardDeletePurchaseOrder(companyId, po.id, profile?.id ?? '', profile?.email ?? '');
      onBack();
    } catch (err) {
      console.error('Error deleting purchase order:', err);
    }
  };

  if (loading || !po) {
    return (
      <Page>
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando...</PanelSection>
      </Page>
    );
  }

  const itemsNeedingResolution = comparisons
    ? items.filter(item => {
        const comparison = comparisons.find(c => c.poItemId === item.id);
        return comparison && (comparison.status === 'po_item_not_found' || comparison.status === 'awaiting_manual_link');
      })
    : [];

  return (
    <Page>
      <PageHeader
        title={`OC ${po.poNumber}`}
        description={po.supplierName}
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>
            {canWrite && po.status !== 'closed' && po.status !== 'cancelled' && (
              <Button variant="secondary" size="sm" onClick={() => setShowLinkModal(true)}><Link2 size={14} /> Vincular NF-e</Button>
            )}
          </>
        )}
      />

      <Panel>
        <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_BADGE[po.status]}>{PURCHASE_ORDER_STATUS_LABEL[po.status]}</Badge>
          <span className="text-sm text-fg-subtle">Origem: {po.origin === 'manual' ? 'Manual' : po.origin}</span>
          {po.issueDate && <span className="text-sm text-fg-subtle">Emissão: {new Date(po.issueDate).toLocaleDateString('pt-BR')}</span>}
          {po.notes && <span className="text-sm text-fg-subtle">Obs.: {po.notes}</span>}
        </PanelSection>

        {canWrite && po.status !== 'cancelled' && (
          <PanelSection padding="md" className="flex flex-wrap gap-2">
            {po.status === 'draft' && (
              <Button size="sm" onClick={() => handleClose('closed')}>Abrir OC</Button>
            )}
            {(po.status === 'open' || po.status === 'draft') && (
              <>
                <Button size="sm" variant="secondary" onClick={() => handleClose('closed')}>Encerrar</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowCloseWithDifferences(true)}>Encerrar com diferenças</Button>
              </>
            )}
            {po.status !== 'draft' && po.status !== 'closed' && po.status !== 'closed_with_differences' && (
              <Button size="sm" variant="danger" onClick={() => handleClose('cancelled')}>Cancelar OC</Button>
            )}
            {(po.status === 'closed' || po.status === 'closed_with_differences') && canAdminister && (
              <Button size="sm" variant="secondary" onClick={handleReopen}>Reabrir</Button>
            )}
            {canAdminister && canHardDeletePurchaseOrder(po, activeLinkCount) && (
              <Button size="sm" variant="danger" onClick={handleHardDelete}>Excluir rascunho</Button>
            )}
          </PanelSection>
        )}

        {showCloseWithDifferences && (
          <PanelSection padding="md" className="space-y-2 border-t border-edge">
            <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide">Observação obrigatória para encerrar com diferenças</p>
            <Textarea rows={2} value={closeReason} onChange={e => setCloseReason(e.target.value)} placeholder="Descreva as diferenças encontradas..." />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleClose('closed_with_differences')} disabled={!closeReason.trim()}>Confirmar encerramento</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCloseWithDifferences(false)}>Cancelar</Button>
            </div>
          </PanelSection>
        )}
      </Panel>

      <Panel>
        <PanelSection padding="md"><p className="text-title">Itens da OC</p></PanelSection>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr><Th>Descrição</Th><Th>Código</Th><Th>EAN</Th><Th>Unid.</Th><Th>Qtd</Th><Th>Preço unit.</Th></Tr>
            </Thead>
            <tbody>
              {items.map(item => (
                <Tr key={item.id}>
                  <Td>{item.description}</Td>
                  <Td>{item.originCode ?? '—'}</Td>
                  <Td>{item.ean ?? '—'}</Td>
                  <Td>{item.unit ?? '—'}</Td>
                  <Td numeric>{item.quantity}</Td>
                  <Td numeric>{item.unitPrice ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Panel>

      <Panel>
        <PanelSection padding="md"><p className="text-title">NF-es vinculadas</p></PanelSection>
        {links.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhuma NF-e vinculada ainda.</PanelSection>}
        {links.map(link => (
          <PanelSection key={link.id} padding="md" className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-fg">{link.invoice ? `NF-e ${link.invoice.invoice_number ?? link.invoice.invoice_key.slice(-6)} — ${link.invoice.supplier_name ?? ''}` : 'NF-e removida do histórico'}</p>
              <p className="text-xs text-fg-subtle">Vinculada em {new Date(link.linkedAt).toLocaleString('pt-BR')}</p>
            </div>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => handleUnlink(link.id)}><Unlink size={14} /> Desvincular</Button>
            )}
          </PanelSection>
        ))}
      </Panel>

      <PoReconciliationPanel
        items={items}
        comparisons={comparisons}
        notPredictedCount={notPredictedCount}
        progress={progress}
        running={reconciling}
        hasActiveLinks={links.length > 0}
        onRun={handleRunReconciliation}
      />

      {reconciliationError && (
        <Panel>
          <PanelSection padding="md" className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {reconciliationError}
          </PanelSection>
        </Panel>
      )}

      {itemsNeedingResolution.length > 0 && (
        <Panel>
          <PanelSection padding="md"><p className="text-title">Itens aguardando De/Para</p></PanelSection>
          {itemsNeedingResolution.map(item => (
            <PanelSection key={item.id} padding="md" className="flex items-center justify-between gap-3">
              <p className="text-sm text-fg">{item.description}</p>
              <Button size="sm" variant="secondary" onClick={() => setResolvingItem(item)}>Vincular manualmente</Button>
            </PanelSection>
          ))}
        </Panel>
      )}

      <Panel>
        <PanelSection padding="md" className="flex items-center gap-2">
          <History size={16} className="text-fg-subtle" /><p className="text-title">Histórico</p>
        </PanelSection>
        {history.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum evento registrado ainda.</PanelSection>}
        {history.map(event => (
          <PanelSection key={event.id} padding="sm" className="flex items-center justify-between text-sm">
            <span className="text-fg">{event.action}</span>
            <span className="text-xs text-fg-subtle">{event.userEmail ?? '—'} · {new Date(event.createdAt).toLocaleString('pt-BR')}</span>
          </PanelSection>
        ))}
      </Panel>

      {showLinkModal && (
        <PoLinkNfeModal companyId={companyId} purchaseOrderId={po.id} onClose={() => setShowLinkModal(false)} onLinked={() => { setShowLinkModal(false); load(); }} />
      )}

      {resolvingItem && (
        <PoDetoParaResolver
          companyId={companyId}
          purchaseOrder={po}
          poItem={resolvingItem}
          onClose={() => setResolvingItem(null)}
          onResolved={() => { setResolvingItem(null); handleRunReconciliation(); }}
        />
      )}
    </Page>
  );
}
