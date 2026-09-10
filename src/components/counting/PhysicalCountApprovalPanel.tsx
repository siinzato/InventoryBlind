import { useState } from 'react';
import { Card, Table, Thead, Tr, Th, Td, Button } from '../ui';
import PermissionGuard from '../PermissionGuard';
import { describeLocation } from '../../lib/physicalCount/locationAddressing';
import { computeTotalFound } from '../../lib/physicalCount/physicalCountAlgorithm';
import { approveSession, callErpSync } from '../../lib/physicalCount/physicalCountService';
import { logAuditEvent } from '../../lib/auditLogService';
import { useAuth } from '../../lib/auth';
import type { ErpSyncReport, PhysicalCountItem } from '../../lib/physicalCount/physicalCountTypes';

interface PhysicalCountApprovalPanelProps {
  sessionId: string;
  companyId: string;
  divergentItems: PhysicalCountItem[];
  onApproved: () => void;
}

export function PhysicalCountApprovalPanel({ sessionId, companyId, divergentItems, onApproved }: PhysicalCountApprovalPanelProps) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ErpSyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleApproveAndSync = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveSession(sessionId);
      if (profile) {
        logAuditEvent({
          companyId,
          userId: profile.id,
          userEmail: profile.email ?? '',
          action: 'physical_count.approved',
          resourceType: 'physical_count_session',
          resourceId: sessionId,
        });
      }

      const syncReport = await callErpSync(sessionId);
      setReport(syncReport);

      if (profile) {
        logAuditEvent({
          companyId,
          userId: profile.id,
          userEmail: profile.email ?? '',
          action: 'physical_count.erp_sync_attempted',
          resourceType: 'physical_count_session',
          resourceId: sessionId,
          metadata: {
            attempted: syncReport.attempted,
            succeeded: syncReport.succeeded,
            pending: syncReport.pending,
            failed: syncReport.failed,
          },
        });
      }

      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aprovar/sincronizar agora.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PermissionGuard
      permission="erp.manage"
      fallback={<p className="text-sm text-fg-muted">Apenas administradores podem aprovar e sincronizar com o ERP.</p>}
    >
      <div className="space-y-4">
        <Card padding="none" className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>SKU</Th>
                <Th>Local</Th>
                <Th>Tiny/Snapshot</Th>
                <Th>Contagem Final</Th>
                <Th>Ajuste</Th>
              </Tr>
            </Thead>
            <tbody>
              {divergentItems.map(item => {
                const total = computeTotalFound({
                  erpQuantitySnapshot: item.erpQuantitySnapshot ?? 0,
                  physicalQuantity: item.physicalQuantity,
                  foundElsewhereQuantity: item.foundElsewhereQuantity,
                }) ?? 0;
                const adjustment = total - (item.erpQuantitySnapshot ?? 0);
                return (
                  <Tr key={item.id}>
                    <Td>{item.snapshotSku ?? item.sku}</Td>
                    <Td>{describeLocation(item.location)}</Td>
                    <Td className="tabular-nums">{item.erpQuantitySnapshot ?? '—'}</Td>
                    <Td className="tabular-nums">
                      {total}
                      {item.foundElsewhereQuantity > 0 && (
                        <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">
                          ({item.physicalQuantity ?? 0} local + {item.foundElsewhereQuantity} excedente)
                        </span>
                      )}
                    </Td>
                    <Td className="tabular-nums">{adjustment > 0 ? `+${adjustment}` : adjustment}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {report ? (
          <div className="rounded-lg border border-edge bg-surface-2 px-4 py-3 text-sm">
            <p className="font-medium text-fg">
              {report.succeeded} de {report.attempted} ajustes processados
            </p>
            {report.pending > 0 && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                {report.pending} pendente(s) — credenciais do ERP não configuradas nesta instância.
              </p>
            )}
            {report.failed > 0 && <p className="mt-1 text-red-500">{report.failed} ajuste(s) precisam de atenção.</p>}
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="primary" disabled={busy || divergentItems.length === 0} onClick={handleApproveAndSync}>
              {busy ? 'Processando…' : 'Aprovar e atualizar Tiny'}
            </Button>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
