import { useCallback, useEffect, useState } from 'react';
import { Download, Search, RefreshCw } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input, Select } from '../ui';
import type { AuditLog } from '../../lib/auditLogService';
import {
  listAuditLogs, logsToCsv, redactMetadata, classifyLogOutcome,
  LOGS_PAGE_SIZE, type LogFilters, type LogOutcome,
} from '../../lib/settings/logsService';

interface LogsPageProps {
  companyId: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(value: string | null, max = 60): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const CSV_BOM = String.fromCharCode(0xfeff);

function downloadCsv(csv: string) {
  // BOM: sem ele o Excel no Windows abre acentos como caracteres errados ao
  // interpretar o CSV como Latin-1 em vez de UTF-8.
  const blob = new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `logs-inventoryblind-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function LogsPage({ companyId }: LogsPageProps) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState<LogFilters>({ outcome: 'all' });
  const [searchInput, setSearchInput] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAuditLogs(companyId, filters, page);
      setRows(result.rows);
      setHasMore(result.hasMore);
    } finally {
      setLoading(false);
    }
  }, [companyId, filters, page]);

  useEffect(() => { load(); }, [load]);

  function applySearch() {
    setPage(0);
    setFilters(f => ({ ...f, searchText: searchInput.trim() || undefined }));
  }

  function updateFilter<K extends keyof LogFilters>(key: K, value: LogFilters[K]) {
    setPage(0);
    setFilters(f => ({ ...f, [key]: value }));
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="Logs"
        description="Histórico de ações realizadas nesta empresa — quem fez o quê, quando e com qual resultado."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Atualizar</Button>
            <Button size="sm" disabled={rows.length === 0} onClick={() => downloadCsv(logsToCsv(rows))}><Download size={14} /> Exportar CSV</Button>
          </>
        }
      />

      <Panel className="mb-6">
        <PanelSection padding="md" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">De</label>
            <Input type="date" value={filters.dateFrom ?? ''} onChange={e => updateFilter('dateFrom', e.target.value || undefined)} />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Até</label>
            <Input type="date" value={filters.dateTo ?? ''} onChange={e => updateFilter('dateTo', e.target.value || undefined)} />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Usuário</label>
            <Input value={filters.userEmail ?? ''} onChange={e => updateFilter('userEmail', e.target.value || undefined)} placeholder="email@empresa.com" className="w-48" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Ação</label>
            <Input value={filters.action ?? ''} onChange={e => updateFilter('action', e.target.value || undefined)} placeholder="Ex.: physical_count" className="w-48" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Resultado</label>
            <Select value={filters.outcome ?? 'all'} onChange={e => updateFilter('outcome', e.target.value as LogOutcome | 'all')}>
              <option value="all">Todos</option>
              <option value="success">Sucesso</option>
              <option value="denied">Negado</option>
            </Select>
          </div>
          <div className="flex-1 min-w-[12rem]">
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Buscar</label>
            <div className="flex gap-2">
              <Input
                icon={<Search size={16} />}
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applySearch()}
                placeholder="Descrição, recurso..."
              />
              <Button size="sm" variant="secondary" onClick={applySearch}>Buscar</Button>
            </div>
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr><Th>Data/Hora</Th><Th>Usuário</Th><Th>Ação</Th><Th>Recurso</Th><Th>Descrição</Th><Th>Resultado</Th><Th></Th></Tr>
            </Thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Tr key={i}>{Array.from({ length: 7 }).map((__, j) => <Td key={j}><div className="h-3 bg-surface-3 rounded animate-pulse" /></Td>)}</Tr>
                ))
              ) : rows.length === 0 ? (
                <Tr><Td colSpan={7} className="text-center py-8 text-fg-subtle text-sm">Nenhum log encontrado para os filtros aplicados.</Td></Tr>
              ) : rows.map(row => {
                const outcome = classifyLogOutcome(row.action);
                return (
                  <Tr key={row.id} className="cursor-pointer hover:bg-surface-3/40" onClick={() => setDetail(row)}>
                    <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(row.created_at)}</Td>
                    <Td className="text-fg-muted text-xs">{truncate(row.user_email, 28)}</Td>
                    <Td><span className="font-mono text-xs bg-surface-3 px-2 py-0.5 rounded text-fg-muted">{row.action}</span></Td>
                    <Td className="text-fg-subtle text-xs">{row.resource_type ?? '—'}</Td>
                    <Td className="text-fg-subtle text-xs">{truncate(row.description)}</Td>
                    <Td>{outcome === 'denied' ? <Badge variant="danger">Negado</Badge> : <Badge variant="success">Sucesso</Badge>}</Td>
                    <Td className="text-fg-subtle text-xs">Ver detalhes</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <PanelSection padding="sm" className="flex items-center justify-between">
          <span className="text-fg-subtle text-xs">Página {page + 1} · {LOGS_PAGE_SIZE} por página</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button variant="secondary" size="sm" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </PanelSection>
      </Panel>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes do log">
        {detail && (
          <div className="space-y-3 text-sm">
            <div><span className="text-fg-subtle text-xs">Data/Hora</span><p className="text-fg">{formatDate(detail.created_at)}</p></div>
            <div><span className="text-fg-subtle text-xs">Usuário</span><p className="text-fg">{detail.user_email}</p></div>
            <div><span className="text-fg-subtle text-xs">Ação</span><p className="font-mono text-fg">{detail.action}</p></div>
            <div><span className="text-fg-subtle text-xs">Recurso</span><p className="text-fg">{detail.resource_type ?? '—'} {detail.resource_id ? `(${detail.resource_id})` : ''}</p></div>
            <div><span className="text-fg-subtle text-xs">Descrição</span><p className="text-fg">{detail.description ?? '—'}</p></div>
            {detail.metadata && Object.keys(detail.metadata).length > 0 && (
              <div>
                <span className="text-fg-subtle text-xs">Dados adicionais</span>
                <pre className="bg-surface-3 border border-edge rounded-control p-3 text-xs font-mono text-fg-muted overflow-x-auto mt-1">
                  {JSON.stringify(redactMetadata(detail.metadata), null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default LogsPage;
