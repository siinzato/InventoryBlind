import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Loader2, Plug, RefreshCw, Send, X } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Notice,
  Page,
  PageHeader,
  Panel,
  PanelSection,
  SegmentedControl,
  Select,
  Stat,
  StatRow,
} from '../ui';
import {
  clearConnectionCredential,
  createConnection,
  listConnections,
  listProviders,
  setConnectionCredential,
  updateConnection,
} from '../../lib/integrations/integrationService';
import {
  listAdjustments,
  listAlerts,
  resolveAlert,
  runInboundSync,
  runStockWrite,
  testConnection,
  type IntegrationAlert,
  type QueuedAdjustment,
  type StockWriteOutcome,
} from '../../lib/integrations/integrationOperations';
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_VARIANT } from '../../lib/integrations/types';
import type { IntegrationConnection, IntegrationProvider } from '../../lib/integrations/types';
import { useAuth } from '../../lib/auth';
import { logAuditEvent } from '../../lib/auditLogService';
import { FiscalEntitySelector } from '../fiscalEntities/FiscalEntitySelector';

type Tab = 'connection' | 'queue' | 'alerts';

/** Integrations control surface.
 *
 *  One page, three views of the same connection: how it is configured, what is
 *  waiting to reach the ERP, and what has gone wrong. They are tabs rather than
 *  three panels down a long page because an operator is in exactly one of those
 *  three situations at a time.
 *
 *  Deliberately plain. This screen decides whether a customer's stock balance gets
 *  changed, and every affordance that is not a real decision is noise in front of
 *  one that is. */
export function IntegrationsPage({ onBack }: { onBack?: () => void } = {}) {
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('connection');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingConnection, setCreatingConnection] = useState(false);

  const selected = useMemo(
    () => connections.find(c => c.id === selectedId) ?? null,
    [connections, selectedId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providerList, connectionList] = await Promise.all([listProviders(), listConnections()]);
      setProviders(providerList);
      setConnections(connectionList);
      // Selection survives a refetch; only a first load or a deleted connection
      // moves it, so saving a field does not bounce the operator elsewhere.
      setSelectedId(current =>
        current != null && connectionList.some(c => c.id === current)
          ? current
          : connectionList[0]?.id ?? null
      );
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Não foi possível carregar as integrações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Page>
      <PageHeader
        eyebrow="Integrações"
        title="ERP e Marketplaces"
        description="Conexões com sistemas externos, fila de lançamentos aguardando envio e alertas de sincronização."
        actions={
          onBack && (
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={14} />
              Voltar
            </Button>
          )
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {loading ? (
        <Panel>
          <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin" />
            Carregando integrações…
          </PanelSection>
        </Panel>
      ) : connections.length === 0 ? (
        <EmptyState providers={providers} onCreated={load} />
      ) : (
        <>
          {creatingConnection ? (
            <Panel>
              <PanelSection>
                <h2 className="text-section">Nova conexão</h2>
              </PanelSection>
              <CreateConnectionForm
                providers={providers}
                onCreated={() => {
                  setCreatingConnection(false);
                  void load();
                }}
                onCancel={() => setCreatingConnection(false)}
              />
            </Panel>
          ) : (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setCreatingConnection(true)}>
                <Plug size={14} />
                Nova conexão
              </Button>
            </div>
          )}

          <ConnectionPicker
            connections={connections}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {selected && (
            <>
              <SegmentedControl
                label="Visão da integração"
                width="full"
                value={tab}
                onChange={value => setTab(value as Tab)}
                options={[
                  { value: 'connection', label: 'Conexão' },
                  { value: 'queue', label: 'Fila de lançamentos' },
                  { value: 'alerts', label: 'Alertas' },
                ]}
              />

              {tab === 'connection' && <ConnectionPanel connection={selected} onChanged={load} />}
              {tab === 'queue' && <QueuePanel connection={selected} />}
              {tab === 'alerts' && <AlertsPanel connection={selected} />}
            </>
          )}
        </>
      )}
    </Page>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

const STATUS_VARIANT = CONNECTION_STATUS_VARIANT;
const STATUS_LABEL = CONNECTION_STATUS_LABEL;

function formatDateTime(iso: string | null): string {
  if (iso == null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Criação de conexão ──────────────────────────────────────────────────────

// Providers com conector real no servidor sincronizam de verdade. Providers de
// marketplace sem conector ainda (ex.: Mercado Livre, status 'planned' no
// catálogo) também podem ser criados — servem como identidade da conta de
// canal (nome + empresa fiscal + external_account_id) para o resolvedor de
// canal de origem das devoluções, mesmo sem sincronização automática ainda.
function eligibleProviders(providers: IntegrationProvider[]): IntegrationProvider[] {
  return providers.filter(p => p.key === 'tiny' || p.kind === 'marketplace');
}

function CreateConnectionForm({
  providers,
  onCreated,
  onCancel,
}: {
  providers: IntegrationProvider[];
  onCreated: () => void;
  onCancel?: () => void;
}) {
  const available = eligibleProviders(providers);
  const [providerKey, setProviderKey] = useState(available[0]?.key ?? 'tiny');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const selectedProvider = available.find(p => p.key === providerKey);
  const isPendingConnector = selectedProvider?.status === 'planned';

  async function create() {
    setBusy(true);
    setFailure(null);
    try {
      await createConnection({
        providerKey,
        displayName: displayName.trim() || selectedProvider?.name || providerKey,
      });
      setDisplayName('');
      onCreated();
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível criar a conexão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelSection className="space-y-4">
      {failure && <Notice tone="danger">{failure}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provedor">
          <Select value={providerKey} onChange={e => setProviderKey(e.target.value)}>
            {available.map(provider => (
              <option key={provider.key} value={provider.key}>
                {provider.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome" hint="Como esta conexão aparece nas listas.">
          <Input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={selectedProvider?.kind === 'marketplace' ? 'Mercado Livre — GoCase' : 'Tiny ERP — matriz'}
          />
        </Field>
      </div>

      {isPendingConnector && (
        <Notice tone="neutral">
          Integração pendente: {selectedProvider?.name} ainda não tem sincronização automática
          neste ambiente. A conexão serve como identidade da conta (empresa fiscal e
          identificador externo) — útil, por exemplo, para o InventoryBlind reconhecer o canal de
          origem de uma devolução.
        </Notice>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={create} disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          Criar conexão
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
      </div>
    </PanelSection>
  );
}

function EmptyState({ providers, onCreated }: { providers: IntegrationProvider[]; onCreated: () => void }) {
  return (
    <Panel>
      <PanelSection>
        <div className="flex items-start gap-3">
          <Plug size={18} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
          <div>
            <h2 className="text-section">Nenhuma conexão configurada</h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-fg-muted">
              Uma conexão representa uma conta no sistema externo. Crie a conexão primeiro; a
              credencial é colada em seguida e nunca fica visível depois de salva.
            </p>
          </div>
        </div>
      </PanelSection>
      <CreateConnectionForm providers={providers} onCreated={onCreated} />
    </Panel>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-overline">{label}</span>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">{hint}</p>}
    </label>
  );
}

// ── Connection picker ───────────────────────────────────────────────────────

function ConnectionPicker({
  connections,
  selectedId,
  onSelect,
}: {
  connections: IntegrationConnection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // A single connection needs no picker — the tabs below already say which one is
  // in view.
  if (connections.length <= 1) return null;

  return (
    <Panel>
      <div className="divide-y divide-edge/60">
        {connections.map(connection => (
          <button
            key={connection.id}
            type="button"
            onClick={() => onSelect(connection.id)}
            className={`flex w-full min-h-[44px] items-center justify-between gap-3 px-6 py-4 text-left transition-colors ${
              connection.id === selectedId ? 'bg-accent/5' : 'hover:bg-surface-3/60'
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{connection.displayName}</p>
              <p className="mt-0.5 text-xs text-fg-subtle">{connection.providerKey}</p>
            </div>
            <Badge variant={STATUS_VARIANT[connection.status] ?? 'neutral'}>
              {STATUS_LABEL[connection.status] ?? connection.status}
            </Badge>
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ── Connection configuration ────────────────────────────────────────────────

function ConnectionPanel({
  connection,
  onChanged,
}: {
  connection: IntegrationConnection;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string } | null>(null);

  async function run(key: string, action: () => Promise<{ tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string }>) {
    setBusy(key);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (thrown) {
      setMessage({ tone: 'danger', text: thrown instanceof Error ? thrown.message : 'Falhou.' });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const readOnly = connection.syncDirection === 'inbound';

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Panel>
        <PanelSection>
          <StatRow>
            <Stat label="Situação" value={STATUS_LABEL[connection.status] ?? connection.status} />
            <Stat
              label="Última sincronização"
              value={formatDateTime(connection.lastSyncAt)}
              context={
                connection.lastSuccessfulSyncAt
                  ? `Último sucesso: ${formatDateTime(connection.lastSuccessfulSyncAt)}`
                  : 'Nenhuma sincronização bem-sucedida ainda'
              }
            />
            <Stat
              label="Credencial"
              value={connection.credentialsSetAt ? connection.credentialHint ?? 'Salva' : 'Não configurada'}
              context={connection.credentialsSetAt ? `Salva em ${formatDateTime(connection.credentialsSetAt)}` : undefined}
            />
          </StatRow>
        </PanelSection>

        {connection.lastError && (
          <PanelSection>
            <Notice tone="danger">{connection.lastError}</Notice>
          </PanelSection>
        )}
      </Panel>

      {/* ── Credential ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection>
          <h2 className="text-section">Credencial</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-muted">
            O token é gravado por uma função que só escreve — nem esta tela nem
            qualquer consulta do navegador consegue lê-lo depois. Fica salvo apenas
            um trecho final para você reconhecer qual token está em uso.
          </p>
        </PanelSection>

        <PanelSection className="space-y-4">
          <Field
            label="Token"
            hint="Cole o token gerado no painel do provedor. Ele não aparece novamente depois de salvo."
          >
            <Input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder={connection.credentialsSetAt ? 'Colar um novo token substitui o atual' : 'Colar o token'}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy != null || secret.trim().length === 0}
              onClick={() =>
                run('save', async () => {
                  await setConnectionCredential(connection.id, secret.trim());
                  setSecret('');
                  return { tone: 'success', text: 'Credencial salva. Teste a conexão para validar.' };
                })
              }
            >
              {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
              Salvar credencial
            </Button>

            <Button
              variant="secondary"
              disabled={busy != null || connection.credentialsSetAt == null}
              onClick={() =>
                run('test', async () => {
                  const result = await testConnection(connection.id);
                  return { tone: result.ok ? 'success' : 'danger', text: result.message };
                })
              }
            >
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Testar conexão
            </Button>

            {connection.credentialsSetAt && (
              <Button
                variant="ghost"
                disabled={busy != null}
                onClick={() =>
                  run('clear', async () => {
                    await clearConnectionCredential(connection.id);
                    return { tone: 'neutral', text: 'Credencial removida. Nenhuma sincronização vai rodar até salvar outra.' };
                  })
                }
              >
                Remover credencial
              </Button>
            )}
          </div>
        </PanelSection>
      </Panel>

      {/* ── Behaviour ──────────────────────────────────────────────────── */}
      <Panel>
        <PanelSection>
          <h2 className="text-section">Comportamento da sincronização</h2>
        </PanelSection>

        <PanelSection className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Direção"
              hint="Somente leitura nunca altera saldo no provedor. Comece por aqui e libere a escrita depois de conferir os dados."
            >
              <Select
                value={connection.syncDirection}
                disabled={busy != null}
                onChange={e =>
                  run('direction', async () => {
                    await updateConnection(connection.id, {
                      syncDirection: e.target.value as IntegrationConnection['syncDirection'],
                    });
                    return { tone: 'success', text: 'Direção atualizada.' };
                  })
                }
              >
                <option value="inbound">Somente leitura (provedor → InventoryBlind)</option>
                <option value="outbound">Somente escrita (InventoryBlind → provedor)</option>
                <option value="bidirectional">Bidirecional</option>
              </Select>
            </Field>

            <Field
              label="Intervalo automático"
              hint="Em branco desliga a sincronização automática. O agendador roda no servidor, sem depender do navegador aberto."
            >
              <Input
                type="number"
                min={5}
                step={5}
                defaultValue={connection.syncIntervalMinutes ?? ''}
                disabled={busy != null}
                placeholder="minutos"
                onBlur={e => {
                  const raw = e.target.value.trim();
                  const minutes = raw === '' ? null : Number(raw);
                  if (minutes !== null && (!Number.isFinite(minutes) || minutes < 5)) return;
                  if (minutes === connection.syncIntervalMinutes) return;
                  void run('interval', async () => {
                    await updateConnection(connection.id, {
                      syncIntervalMinutes: minutes,
                      autoSyncEnabled: minutes != null,
                    });
                    return {
                      tone: 'success',
                      text: minutes == null
                        ? 'Sincronização automática desligada.'
                        : `Sincronização automática a cada ${minutes} minutos.`,
                    };
                  });
                }}
              />
            </Field>
          </div>

          <Field
            label="Empresa fiscal"
            hint="A empresa (CNPJ) deste workspace que esta conexão representa. Usada para localizar corretamente o produto e o depósito no provedor."
          >
            <div className="space-y-1.5">
              {connection.fiscalEntityId == null && <Badge variant="warning">Configuração pendente</Badge>}
              <FiscalEntitySelector
                companyId={connection.companyId}
                value={connection.fiscalEntityId}
                disabled={busy != null}
                onChange={fiscalEntityId =>
                  run('fiscalEntity', async () => {
                    await updateConnection(connection.id, { fiscalEntityId });
                    if (profile) {
                      await logAuditEvent({
                        companyId: connection.companyId,
                        userId: profile.id,
                        userEmail: profile.email ?? '',
                        action: fiscalEntityId ? 'fiscal_entity.integration_linked' : 'fiscal_entity.integration_unlinked',
                        resourceType: 'integration_connections',
                        resourceId: connection.id,
                        metadata: { fiscalEntityId },
                      });
                    }
                    return { tone: 'success', text: fiscalEntityId ? 'Empresa fiscal vinculada.' : 'Vínculo removido.' };
                  })
                }
              />
            </div>
          </Field>

          {readOnly && (
            <Notice tone="neutral">
              Esta conexão está em somente leitura. Lançamentos aprovados ficam na fila e não são
              enviados até a escrita ser liberada.
            </Notice>
          )}
        </PanelSection>

        <PanelSection className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy != null || connection.credentialsSetAt == null}
            onClick={() =>
              run('dry', async () => {
                const result = await runInboundSync(connection.id, { dryRun: true });
                return {
                  tone: result.ok ? 'neutral' : 'danger',
                  text: result.ok
                    ? `Simulação: ${result.updates ?? 0} saldo(s) mudariam, ${result.conflicts ?? 0} conflito(s). Nada foi gravado.`
                    : result.message,
                };
              })
            }
          >
            {busy === 'dry' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Simular leitura
          </Button>

          <Button
            disabled={busy != null || connection.credentialsSetAt == null}
            onClick={() =>
              run('sync', async () => {
                const result = await runInboundSync(connection.id);
                return { tone: result.ok ? 'success' : 'danger', text: result.message };
              })
            }
          >
            {busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar agora
          </Button>
        </PanelSection>
      </Panel>
    </div>
  );
}

// ── The queue ───────────────────────────────────────────────────────────────

const WRITE_KIND_LABEL: Record<string, string> = {
  absolute: 'Definir saldo',
  delta: 'Ajustar saldo',
  transfer: 'Transferir',
  movement: 'Movimento',
};

const REASON_LABEL: Record<string, string> = {
  count_adjustment: 'Ajuste de contagem',
  return: 'Devolução',
  full_withdrawal: 'Retirada de Full',
  withdrawal: 'Retirada',
  loss: 'Perda',
  found: 'Sobra',
  reconciliation: 'Reconciliação',
};

function QueuePanel({ connection }: { connection: IntegrationConnection }) {
  const [rows, setRows] = useState<QueuedAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<StockWriteOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listAdjustments(connection.id, { statuses: ['pending', 'failed', 'sent'] }));
      setFailure(null);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível carregar a fila.');
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(dryRun: boolean) {
    setBusy(dryRun ? 'dry' : 'send');
    setOutcome(null);
    setFailure(null);
    try {
      const result = await runStockWrite(connection.id, { dryRun });
      setOutcome(result);
      if (!result.ok && result.message) setFailure(result.message);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Falhou.');
    } finally {
      setBusy(null);
      await load();
    }
  }

  const pending = rows.filter(r => r.syncStatus === 'pending');
  const failed = rows.filter(r => r.syncStatus === 'failed');

  return (
    <div className="space-y-6">
      {failure && <Notice tone="danger">{failure}</Notice>}

      {outcome && (
        <Notice tone={outcome.failed > 0 || outcome.refused > 0 ? 'warning' : 'success'}>
          {outcome.dryRun ? 'Simulação: ' : ''}
          {outcome.sent} enviado(s), {outcome.refused} recusado(s), {outcome.failed} com falha
          {outcome.deferred > 0 && `, ${outcome.deferred} adiado(s) por serem do mesmo produto`}
          {outcome.notStarted > 0 && `, ${outcome.notStarted} não iniciado(s) nesta rodada`}.
          {outcome.dryRun && ' Nada foi enviado ao provedor.'}
        </Notice>
      )}

      <Panel>
        <PanelSection>
          <StatRow>
            <Stat label="Aguardando envio" value={pending.length} />
            <Stat
              label="Com falha"
              value={failed.length}
              valueTone={failed.length > 0 ? 'critical' : undefined}
              context={failed.length > 0 ? 'Precisam de correção antes de reenviar' : undefined}
            />
            <Stat label="Enviados" value={rows.filter(r => r.syncStatus === 'sent').length} />
          </StatRow>
        </PanelSection>

        <PanelSection className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy != null || pending.length === 0}
            onClick={() => send(true)}
          >
            {busy === 'dry' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Simular envio
          </Button>
          <Button disabled={busy != null || pending.length === 0} onClick={() => send(false)}>
            {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar ao provedor
          </Button>
          <p className="text-xs leading-relaxed text-fg-subtle">
            A simulação relê o saldo real e aplica todas as travas, sem enviar nada.
          </p>
        </PanelSection>
      </Panel>

      <Panel>
        {loading ? (
          <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin" />
            Carregando fila…
          </PanelSection>
        ) : rows.length === 0 ? (
          <PanelSection className="text-sm text-fg-muted">
            Nenhum lançamento na fila. Lançamentos aparecem aqui depois de uma contagem física
            aprovada, de uma devolução ou de uma retirada de Full.
          </PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left">
                  <th className="px-6 py-3 text-overline font-medium">Produto</th>
                  <th className="px-6 py-3 text-overline font-medium">Tipo</th>
                  <th className="px-6 py-3 text-overline font-medium text-right">De</th>
                  <th className="px-6 py-3 text-overline font-medium text-right">Para</th>
                  <th className="px-6 py-3 text-overline font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-edge/60 last:border-0">
                    <td className="px-6 py-4">
                      <p className="font-medium text-fg">{row.sku ?? '—'}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {row.warehouse ?? 'sem depósito'}
                        {row.targetWarehouse && ` → ${row.targetWarehouse}`}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-fg-muted">{WRITE_KIND_LABEL[row.writeKind] ?? row.writeKind}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        {REASON_LABEL[row.movementReason ?? 'count_adjustment'] ?? row.movementReason}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-fg-muted">
                      {row.previousQuantity}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums font-medium text-fg">
                      {row.writeKind === 'transfer'
                        ? Math.abs(row.deltaQuantity)
                        : row.writeKind === 'absolute'
                          ? row.countedQuantity
                          : `${row.deltaQuantity > 0 ? '+' : ''}${row.deltaQuantity}`}
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={
                          row.syncStatus === 'failed'
                            ? 'danger'
                            : row.syncStatus === 'sent' || row.syncStatus === 'confirmed'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {row.syncStatus === 'pending'
                          ? 'Aguardando'
                          : row.syncStatus === 'sent'
                            ? 'Enviado'
                            : row.syncStatus === 'confirmed'
                              ? 'Confirmado'
                              : row.syncStatus === 'failed'
                                ? 'Falhou'
                                : 'Ignorado'}
                      </Badge>
                      {row.errorMessage && (
                        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-fg-subtle">
                          {row.errorMessage}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

function AlertsPanel({ connection }: { connection: IntegrationConnection }) {
  const [alerts, setAlerts] = useState<IntegrationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await listAlerts({ connectionId: connection.id }));
      setFailure(null);
    } catch (thrown) {
      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível carregar os alertas.');
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {failure && <Notice tone="danger">{failure}</Notice>}

      <Panel>
        {loading ? (
          <PanelSection className="flex items-center gap-3 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin" />
            Carregando alertas…
          </PanelSection>
        ) : alerts.length === 0 ? (
          <PanelSection className="text-sm text-fg-muted">
            Nenhum alerta aberto para esta conexão.
          </PanelSection>
        ) : (
          <div className="divide-y divide-edge/60">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-start gap-4 px-6 py-4">
                <AlertTriangle
                  size={16}
                  className={`mt-0.5 flex-shrink-0 ${
                    alert.severity === 'critical'
                      ? 'text-red-500'
                      : alert.severity === 'warning'
                        ? 'text-amber-500'
                        : 'text-fg-subtle'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{alert.message}</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {alert.kind} · {alert.occurrences}×  · último em {formatDateTime(alert.lastSeenAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy != null}
                  onClick={async () => {
                    setBusy(alert.id);
                    try {
                      await resolveAlert(alert);
                    } catch (thrown) {
                      setFailure(thrown instanceof Error ? thrown.message : 'Não foi possível resolver.');
                    } finally {
                      setBusy(null);
                      await load();
                    }
                  }}
                >
                  {busy === alert.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Resolver
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
