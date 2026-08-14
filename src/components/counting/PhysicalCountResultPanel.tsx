import { useEffect, useState } from 'react';
import { Card, Table, Thead, Tr, Th, Td, Badge, Button } from '../ui';
import { describeLocation } from '../../lib/physicalCount/locationAddressing';
import { computeSessionSummary, computeTotalFound, shouldRecommendRecount } from '../../lib/physicalCount/physicalCountAlgorithm';
import { getSessionItems } from '../../lib/physicalCount/physicalCountService';
import type { PhysicalCountItem } from '../../lib/physicalCount/physicalCountTypes';

interface PhysicalCountResultPanelProps {
  sessionId: string;
  countNumber: 1 | 2 | 3;
  onCreateRecount?: () => void;
  onItemsLoaded?: (items: PhysicalCountItem[]) => void;
}

export function PhysicalCountResultPanel({ sessionId, countNumber, onCreateRecount, onItemsLoaded }: PhysicalCountResultPanelProps) {
  const [items, setItems] = useState<PhysicalCountItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSessionItems(sessionId)
      .then(rows => {
        setItems(rows);
        onItemsLoaded?.(rows);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (loading) return <p className="text-sm text-fg-muted">Carregando resultado…</p>;

  const summary = computeSessionSummary(
    items.map(i => ({
      erpQuantitySnapshot: i.erpQuantitySnapshot ?? 0,
      physicalQuantity: i.physicalQuantity,
      foundElsewhereQuantity: i.foundElsewhereQuantity,
    }))
  );
  const divergentCount = items.filter(i => i.resultStatus && i.resultStatus !== 'ok').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Contados</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.countedItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">OK</p>
          <p className="text-xl font-semibold text-emerald-500 tabular-nums">{summary.okItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Divergentes</p>
          <p className="text-xl font-semibold text-amber-500 tabular-nums">{summary.divergentItems}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Precisão</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.accuracyPct}%</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Unidades faltando</p>
          <p className="text-xl font-semibold text-red-500 tabular-nums">{summary.missingUnits}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs text-fg-muted">Unidades excedentes</p>
          <p className="text-xl font-semibold text-blue-500 tabular-nums">+{summary.surplusUnits}</p>
        </Card>
        <Card padding="sm" className="col-span-2 sm:col-span-2">
          <p className="text-xs text-fg-muted">Ajuste líquido</p>
          <p className="text-xl font-semibold text-fg tabular-nums">{summary.netAdjustment}</p>
        </Card>
      </div>

      <Card padding="none" className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th>Produto</Th>
              <Th>Local</Th>
              <Th>ERP</Th>
              <Th>No local</Th>
              <Th>Excedente</Th>
              <Th>Diferença</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <tbody>
            {items.map(item => {
              const total = computeTotalFound({
                erpQuantitySnapshot: item.erpQuantitySnapshot ?? 0,
                physicalQuantity: item.physicalQuantity,
                foundElsewhereQuantity: item.foundElsewhereQuantity,
              });
              const diff = (total ?? 0) - (item.erpQuantitySnapshot ?? 0);
              return (
                <Tr key={item.id}>
                  <Td>
                    <span className="block text-fg">{item.snapshotProductName ?? '—'}</span>
                    <span className="block text-xs text-fg-subtle">{item.snapshotSku ?? item.sku}</span>
                  </Td>
                  <Td>
                    {describeLocation(item.location)}
                    {item.foundLocation && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                        (excedente em {item.foundLocation})
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{item.erpQuantitySnapshot ?? '—'}</Td>
                  <Td className="tabular-nums">{item.physicalQuantity ?? '—'}</Td>
                  <Td className="tabular-nums">
                    {item.foundElsewhereQuantity > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">{item.foundElsewhereQuantity}</span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="tabular-nums">{item.resultStatus ? (diff > 0 ? `+${diff}` : diff) : '—'}</Td>
                  <Td>
                    {item.resultStatus === 'ok' && <Badge variant="success">OK</Badge>}
                    {item.resultStatus === 'missing' && <Badge variant="danger">Falta</Badge>}
                    {item.resultStatus === 'surplus' && <Badge variant="warning">Excedente</Badge>}
                    {!item.resultStatus && <Badge variant="neutral">Pendente</Badge>}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {shouldRecommendRecount(summary) && countNumber < 3 && onCreateRecount && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-fg">{divergentCount} SKU(s) divergente(s) — recomenda-se reconferência.</p>
          <Button variant="secondary" onClick={onCreateRecount}>
            Criar Recontagem
          </Button>
        </div>
      )}
    </div>
  );
}
