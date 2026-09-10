import { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, FileText, RefreshCw } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Input, Select, Table, Thead, Tr, Th, Td } from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';
import { listPurchaseOrders, countActiveLinksForPurchaseOrder } from '../../lib/purchaseOrders/poService';
import { PURCHASE_ORDER_STATUS_LABEL, type PurchaseOrder, type PurchaseOrderStatus } from '../../lib/purchaseOrders/poTypes';
import { PurchaseOrderForm } from './PurchaseOrderForm';
import { PoImportWizard } from './PoImportWizard';
import { PurchaseOrderDetailPage } from './PurchaseOrderDetailPage';

interface PurchaseOrdersPageProps {
  companyId: string;
}

const STATUS_BADGE: Record<PurchaseOrderStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', open: 'accent', closed: 'success', closed_with_differences: 'warning', cancelled: 'danger',
};

export function PurchaseOrdersPage({ companyId }: PurchaseOrdersPageProps) {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [linkCounts, setLinkCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canWrite = hasPermission(profile?.role, 'inventory.write');

  const load = async () => {
    setLoading(true);
    try {
      const data = await listPurchaseOrders(companyId);
      setOrders(data);
      const counts = new Map<string, number>();
      await Promise.all(data.map(async po => counts.set(po.id, await countActiveLinksForPurchaseOrder(po.id))));
      setLinkCounts(counts);
    } catch (err) {
      console.error('Error loading purchase orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const origins = useMemo(() => Array.from(new Set(orders.map(o => o.origin))).sort(), [orders]);

  const filtered = orders.filter(o => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (supplierFilter && !o.supplierName.toLowerCase().includes(supplierFilter.toLowerCase())) return false;
    if (originFilter && o.origin !== originFilter) return false;
    return true;
  });

  if (selectedId) {
    return (
      <PurchaseOrderDetailPage
        companyId={companyId}
        purchaseOrderId={selectedId}
        onBack={() => { setSelectedId(null); load(); }}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="Ordens de Compra"
        description="Cadastre ou importe OCs e compare, sem bloquear nada, contra as NF-es já recebidas."
        actions={canWrite ? (
          <>
            <Button variant="secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Importar</Button>
            <Button onClick={() => setShowForm(true)}><Plus size={16} /> Nova OC</Button>
          </>
        ) : undefined}
      />

      <Panel>
        <PanelSection padding="md" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as PurchaseOrderStatus | 'all')}>
            <option value="all">Todos os status</option>
            {(Object.keys(PURCHASE_ORDER_STATUS_LABEL) as PurchaseOrderStatus[]).map(s => (
              <option key={s} value={s}>{PURCHASE_ORDER_STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Input placeholder="Filtrar por fornecedor..." value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} />
          <Select value={originFilter} onChange={e => setOriginFilter(e.target.value)}>
            <option value="">Todas as origens</option>
            {origins.map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
        </PanelSection>

        {loading && (
          <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Carregando...
          </PanelSection>
        )}

        {!loading && filtered.length === 0 && (
          <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
            Nenhuma OC encontrada.
          </PanelSection>
        )}

        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Número</Th>
                  <Th>Fornecedor</Th>
                  <Th>Origem</Th>
                  <Th>Data</Th>
                  <Th>Status</Th>
                  <Th>NF-es vinculadas</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {filtered.map(po => (
                  <Tr key={po.id} className="cursor-pointer" onClick={() => setSelectedId(po.id)}>
                    <Td className="font-medium">{po.poNumber}</Td>
                    <Td>{po.supplierName}</Td>
                    <Td>{po.origin === 'manual' ? 'Manual' : po.origin}</Td>
                    <Td>{po.issueDate ? new Date(po.issueDate).toLocaleDateString('pt-BR') : '—'}</Td>
                    <Td><Badge variant={STATUS_BADGE[po.status]}>{PURCHASE_ORDER_STATUS_LABEL[po.status]}</Badge></Td>
                    <Td numeric>{linkCounts.get(po.id) ?? 0}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setSelectedId(po.id); }}>
                        <FileText size={14} /> Ver
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {showForm && (
        <PurchaseOrderForm
          companyId={companyId}
          existingOrders={orders}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {showImport && (
        <PoImportWizard
          companyId={companyId}
          existingOrders={orders}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}
    </Page>
  );
}
