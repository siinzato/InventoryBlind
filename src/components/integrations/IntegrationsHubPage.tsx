import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Plug, Plus, RefreshCw, Search } from 'lucide-react';
import { Badge, Button, Input, Modal, Page, PageHeader, Panel, PanelSection } from '../ui';
import { IntegrationLogoTile } from './IntegrationLogoTile';
import { INTEGRATION_CATALOG, type IntegrationCatalogEntry } from '../../lib/integrations/catalog';
import { listConnections, listSyncRuns } from '../../lib/integrations/integrationService';
import type { IntegrationConnection } from '../../lib/integrations/types';

type CatalogFilter = 'all' | 'erp' | 'marketplace' | 'available' | 'coming_soon';

const FILTERS: { value: CatalogFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'erp', label: 'ERPs' },
  { value: 'marketplace', label: 'Marketplaces' },
  { value: 'available', label: 'Disponíveis' },
  { value: 'coming_soon', label: 'Em breve' },
];

type LiveStatus = 'connected' | 'syncing' | 'attention' | 'error';

/** Deriva um estado exibível a partir de dados reais da conexão — nunca um
 *  valor inventado. "Sincronizando" só aparece quando a última execução
 *  registrada (integration_sync_runs, já lida em outro lugar do app) está
 *  mesmo em andamento; o resto vem só de ConnectionStatus/lastError. */
function deriveLiveStatus(connection: IntegrationConnection, isRunning: boolean): LiveStatus {
  if (isRunning) return 'syncing';
  if (connection.status === 'error' || connection.status === 'revoked') return 'error';
  if (connection.status === 'active') return connection.lastError ? 'attention' : 'connected';
  return 'attention'; // pending | inactive — configurada, mas aguardando ação
}

const LIVE_STATUS_LABEL: Record<LiveStatus, string> = {
  connected: 'Conectada',
  syncing: 'Sincronizando',
  attention: 'Atenção',
  error: 'Erro',
};

const LIVE_STATUS_VARIANT: Record<LiveStatus, 'success' | 'accent' | 'warning' | 'danger'> = {
  connected: 'success',
  syncing: 'accent',
  attention: 'warning',
  error: 'danger',
};

function StatusBadge({ status }: { status: LiveStatus }) {
  return <Badge variant={LIVE_STATUS_VARIANT[status]}>{LIVE_STATUS_LABEL[status]}</Badge>;
}

function formatDateTime(iso: string | null): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

interface IntegrationsHubPageProps {
  onBack: () => void;
  /** Leva à tela real de gerenciamento do Tiny (fluxo existente, intocado) —
   *  serve tanto para "Conectar" quanto para "Gerenciar", exatamente como a
   *  própria tela já decide sozinha (mostra o formulário de criação quando não
   *  há conexão, e o painel de gestão quando há). */
  onManageTiny: () => void;
}

export function IntegrationsHubPage({ onBack, onManageTiny }: IntegrationsHubPageProps) {
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [runningConnectionIds, setRunningConnectionIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [modalEntry, setModalEntry] = useState<IntegrationCatalogEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listConnections();
      setConnections(list);

      // Só a última execução de cada conexão importa para decidir "Sincronizando".
      const runningIds = new Set<string>();
      await Promise.all(
        list.map(async connection => {
          try {
            const runs = await listSyncRuns(connection.id, 1);
            if (runs[0]?.status === 'running') runningIds.add(connection.id);
          } catch {
            // Sem permissão para ler execuções não é motivo para quebrar o hub —
            // a conexão continua aparecendo com o status baseado em ConnectionStatus.
          }
        })
      );
      setRunningConnectionIds(runningIds);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Não foi possível carregar as integrações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectionByProviderKey = useMemo(() => {
    const map = new Map<string, IntegrationConnection>();
    for (const connection of connections) {
      // Uma conexão por provedor é o que a tela de gestão do Tiny já assume
      // (ela lista todas, mas hoje só o Tiny cria linhas) — o hub usa a mais
      // recente quando existir mais de uma.
      if (!map.has(connection.providerKey)) map.set(connection.providerKey, connection);
    }
    return map;
  }, [connections]);

  const myIntegrations = useMemo(
    () => INTEGRATION_CATALOG.filter(entry => entry.providerKey && connectionByProviderKey.has(entry.providerKey)),
    [connectionByProviderKey]
  );

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    return INTEGRATION_CATALOG.filter(entry => {
      if (query && !entry.name.toLowerCase().includes(query)) return false;
      switch (filter) {
        case 'erp':
          return entry.category === 'erp';
        case 'marketplace':
          return entry.category === 'marketplace';
        case 'available':
          return entry.providerKey != null;
        case 'coming_soon':
          return entry.providerKey == null;
        default:
          return true;
      }
    });
  }, [search, filter]);

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Integrações"
        title="Integrações"
        description="Conecte o InventoryBlind a ERPs e marketplaces. Cada conexão sincroniza estoque, produtos e pedidos sem sair do sistema."
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={14} />
              Voltar
            </Button>
            <Button onClick={onManageTiny}>
              <Plus size={14} />
              Adicionar integração
            </Button>
          </>
        }
      />

      {error && (
        <Panel>
          <PanelSection className="text-sm text-red-600 dark:text-red-400">{error}</PanelSection>
        </Panel>
      )}

      <div className="max-w-sm">
        <Input
          icon={<Search size={16} />}
          placeholder="Buscar integração..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-section">Minhas integrações</h2>

        {loading ? (
          <Panel>
            <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
              <Loader2 size={16} className="animate-spin" />
              Carregando integrações…
            </PanelSection>
          </Panel>
        ) : myIntegrations.length === 0 ? (
          <Panel>
            <PanelSection className="flex flex-col items-start gap-3">
              <Plug size={20} className="text-fg-subtle" />
              <div>
                <p className="text-sm font-medium text-fg">Nenhuma integração conectada ainda</p>
                <p className="mt-1 text-sm text-fg-muted">
                  Conecte o Tiny ERP para sincronizar estoque, produtos e pedidos automaticamente.
                </p>
              </div>
              <Button size="sm" onClick={onManageTiny}>
                Conectar Tiny ERP
              </Button>
            </PanelSection>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myIntegrations.map(entry => {
              const connection = connectionByProviderKey.get(entry.providerKey!)!;
              const status = deriveLiveStatus(connection, runningConnectionIds.has(connection.id));
              return (
                <Panel key={entry.id}>
                  <PanelSection className="space-y-4">
                    <div className="flex items-start gap-3">
                      <IntegrationLogoTile name={entry.name} logoSrc={entry.logoSrc} logoBg={entry.logoBg} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{connection.displayName}</p>
                        <p className="text-xs text-fg-subtle">{entry.category === 'erp' ? 'ERP' : 'Marketplace'}</p>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    <p className="text-xs text-fg-subtle">
                      Última sincronização: {formatDateTime(connection.lastSyncAt)}
                    </p>

                    <Button size="sm" variant="secondary" className="w-full" onClick={onManageTiny}>
                      <RefreshCw size={14} />
                      Gerenciar
                    </Button>
                  </PanelSection>
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-section">Catálogo de integrações</h2>
          <div className="flex flex-wrap gap-2 overflow-x-auto">
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`min-h-[36px] flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  filter === f.value ? 'bg-accent text-white' : 'bg-surface-3 text-fg-muted hover:text-fg'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredCatalog.length === 0 ? (
          <Panel>
            <PanelSection className="text-sm text-fg-muted">Nenhuma integração encontrada.</PanelSection>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredCatalog.map(entry => {
              const connection = entry.providerKey ? connectionByProviderKey.get(entry.providerKey) : undefined;
              const status = connection ? deriveLiveStatus(connection, runningConnectionIds.has(connection.id)) : null;

              return (
                <Panel key={entry.id}>
                  <PanelSection className="flex h-full flex-col gap-4">
                    <div className="flex items-start gap-3">
                      <IntegrationLogoTile name={entry.name} logoSrc={entry.logoSrc} logoBg={entry.logoBg} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{entry.name}</p>
                        <p className="text-xs text-fg-subtle">{entry.category === 'erp' ? 'ERP' : 'Marketplace'}</p>
                      </div>
                    </div>

                    <p className="flex-1 text-xs leading-relaxed text-fg-muted">{entry.description}</p>

                    <div className="flex items-center justify-between gap-2">
                      {status ? (
                        <StatusBadge status={status} />
                      ) : entry.providerKey ? (
                        <Badge variant="accent">Disponível</Badge>
                      ) : (
                        <Badge variant="neutral">Em breve</Badge>
                      )}

                      {entry.providerKey ? (
                        <Button size="sm" variant={connection ? 'secondary' : 'primary'} onClick={onManageTiny}>
                          {connection ? 'Gerenciar' : 'Conectar'}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setModalEntry(entry)}>
                          Saiba mais
                        </Button>
                      )}
                    </div>
                  </PanelSection>
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      <Modal open={modalEntry != null} onClose={() => setModalEntry(null)} title={modalEntry?.name}>
        {modalEntry && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <IntegrationLogoTile name={modalEntry.name} logoSrc={modalEntry.logoSrc} logoBg={modalEntry.logoBg} />
              <div>
                <p className="text-sm font-semibold text-fg">{modalEntry.name}</p>
                <p className="text-xs text-fg-subtle">{modalEntry.category === 'erp' ? 'ERP' : 'Marketplace'}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-fg-muted">Integração em desenvolvimento.</p>
            <Button variant="secondary" onClick={() => setModalEntry(null)}>
              Fechar
            </Button>
          </div>
        )}
      </Modal>
    </Page>
  );
}
