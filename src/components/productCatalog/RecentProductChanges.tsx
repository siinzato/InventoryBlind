import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Panel, PanelSection, Table, Thead, Tr, Th, Td, Button } from '../ui';
import { formatDateTime } from '../../lib/productImportUtils';
import { listRecentProductChanges, type RecentCatalogEvent } from '../../lib/productCatalog/catalogHistoryService';

interface RecentProductChangesProps {
  companyId: string;
  onOpenProduct: (productId: string) => void;
}

/** Feed real de auditoria (audit_logs + import_products_audit) — sem
 *  paginação de servidor porque a consulta já é limitada a um número fixo de
 *  eventos recentes (ver RECENT_CHANGES_LIMIT em catalogHistoryService). */
export function RecentProductChanges({ companyId, onOpenProduct }: RecentProductChangesProps) {
  const [events, setEvents] = useState<RecentCatalogEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      setEvents(await listRecentProductChanges(companyId));
    } catch (err) {
      console.error('[RecentProductChanges] load', err);
      setLoadError('Não foi possível carregar as alterações recentes.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <Panel>
      <PanelSection padding="md" className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-fg">Alterações recentes</p>
          <p className="text-xs text-fg-subtle">Edições de cadastro, associações de marca/linha e importações</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Atualizar</Button>
      </PanelSection>

      {events === null && !loadError && (
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando…</PanelSection>
      )}
      {loadError && <PanelSection padding="lg" className="text-center text-sm text-red-600 dark:text-red-400">{loadError}</PanelSection>}
      {events !== null && events.length === 0 && (
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhuma alteração registrada ainda.</PanelSection>
      )}
      {events !== null && events.length > 0 && (
        <div className="overflow-x-auto border-t border-edge">
          <Table>
            <Thead>
              <Tr>
                <Th>Produto</Th>
                <Th>Alteração</Th>
                <Th>Detalhe</Th>
                <Th>Usuário</Th>
                <Th>Quando</Th>
              </Tr>
            </Thead>
            <tbody>
              {events.map(ev => (
                <Tr key={ev.id} className="cursor-pointer" onClick={() => onOpenProduct(ev.productId)}>
                  <Td>
                    <p className="text-fg line-clamp-2">{ev.productName}</p>
                    <p className="text-xs text-fg-subtle font-mono">{ev.productSku}</p>
                  </Td>
                  <Td className="text-fg-muted">{ev.label}</Td>
                  <Td className="text-fg-subtle">{ev.detail ?? '—'}</Td>
                  <Td className="text-fg-subtle">{ev.userEmail ?? '—'}</Td>
                  <Td className="text-xs text-fg-subtle">{formatDateTime(ev.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
