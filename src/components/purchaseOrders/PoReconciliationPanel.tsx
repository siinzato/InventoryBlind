import { RefreshCw, PlayCircle } from 'lucide-react';
import { Panel, PanelSection, Badge, Button, Table, Thead, Tr, Th, Td } from '../ui';
import { PO_ITEM_COMPARISON_LABEL, PO_PROGRESS_LABEL, type PoItemComparison, type PoProgressStatus, type PurchaseOrderItem } from '../../lib/purchaseOrders/poTypes';
import { summarizeReconciliation } from '../../lib/purchaseOrders/poReconciliation';

interface PoReconciliationPanelProps {
  items: PurchaseOrderItem[];
  comparisons: PoItemComparison[] | null;
  notPredictedCount: number;
  progress: PoProgressStatus | null;
  running: boolean;
  hasActiveLinks: boolean;
  onRun: () => void;
}

const STATUS_BADGE: Record<PoItemComparison['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success', quantity_less: 'warning', quantity_greater: 'warning', price_divergent: 'warning',
  unit_divergent: 'warning', po_item_not_found: 'danger', awaiting_manual_link: 'neutral',
};

const PROGRESS_BADGE: Record<PoProgressStatus, 'success' | 'warning' | 'accent' | 'neutral'> = {
  no_invoice: 'neutral', partial: 'accent', apparently_complete: 'success', divergent: 'warning',
};

export function PoReconciliationPanel({ items, comparisons, notPredictedCount, progress, running, hasActiveLinks, onRun }: PoReconciliationPanelProps) {
  const itemsById = new Map(items.map(i => [i.id, i]));
  const summary = comparisons ? summarizeReconciliation(comparisons, notPredictedCount) : null;

  return (
    <Panel>
      <PanelSection padding="md" className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-title">Conciliação</p>
          {progress && <Badge variant={PROGRESS_BADGE[progress]} className="mt-1">{PO_PROGRESS_LABEL[progress]}</Badge>}
        </div>
        <Button variant="secondary" size="sm" onClick={onRun} disabled={running || !hasActiveLinks}>
          {running ? <RefreshCw size={14} className="animate-spin" /> : <PlayCircle size={14} />}
          {running ? 'Conciliando...' : 'Rodar conciliação'}
        </Button>
      </PanelSection>

      {!hasActiveLinks && (
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
          Vincule uma NF-e para rodar a conciliação. As divergências são só informativas — nunca bloqueiam o vínculo, o recebimento ou o encerramento da OC.
        </PanelSection>
      )}

      {hasActiveLinks && summary && (
        <>
          <PanelSection padding="md" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Confere" value={summary.ok} tone="success" />
            <Stat label="Divergentes" value={summary.divergent} tone="warning" />
            <Stat label="Não encontrados" value={summary.notFound} tone="danger" />
            <Stat label="Aguardando vínculo" value={summary.awaitingManualLink} tone="neutral" />
          </PanelSection>

          {notPredictedCount > 0 && (
            <PanelSection padding="sm">
              <p className="text-xs text-fg-subtle">{notPredictedCount} item(ns) da NF-e não estavam previstos em nenhuma OC vinculada.</p>
            </PanelSection>
          )}

          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Item</Th>
                  <Th>Qtd. pedida</Th>
                  <Th>Qtd. alocada</Th>
                  <Th>Preço pedido</Th>
                  <Th>Preço recebido</Th>
                  <Th>Situação</Th>
                </Tr>
              </Thead>
              <tbody>
                {(comparisons ?? []).map(c => {
                  const item = itemsById.get(c.poItemId);
                  return (
                    <Tr key={c.poItemId}>
                      <Td>{item?.description ?? '—'}</Td>
                      <Td numeric>{c.orderedQuantity}</Td>
                      <Td numeric>{c.allocatedQuantity}</Td>
                      <Td numeric>{c.unitPriceOrdered !== null ? c.unitPriceOrdered.toFixed(2) : '—'}</Td>
                      <Td numeric>{c.unitPriceInvoiced !== null ? c.unitPriceInvoiced.toFixed(2) : '—'}</Td>
                      <Td><Badge variant={STATUS_BADGE[c.status]}>{PO_ITEM_COMPARISON_LABEL[c.status]}</Badge></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </Panel>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'neutral' }) {
  const toneClass = {
    success: 'text-emerald-600 dark:text-emerald-400', warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400', neutral: 'text-fg',
  }[tone];
  return (
    <div className="text-center">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={`text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
