import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, Check, Trash2, Send, RotateCw, History, Power, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input } from '../ui';
import {
  listWebhooks, listWebhookDeliveries, createWebhook, updateWebhook, deleteWebhook,
  setWebhookActive, rotateWebhookSecret, sendWebhookTest, WEBHOOK_MAX_ATTEMPTS,
  type CompanyWebhook, type CompanyWebhookDelivery, type WebhookTestResult,
} from '../../lib/settings/webhooksService';
import {
  WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENTS, webhookEventLabel,
  type WebhookEvent, type WebhookEventCategory,
} from '../../lib/settings/webhookEvents';

interface WebhooksPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

const DELIVERY_BADGE: Record<CompanyWebhookDelivery['status'], { variant: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  delivered: { variant: 'success', label: 'Entregue' },
  pending: { variant: 'warning', label: 'Pendente' },
  failed: { variant: 'warning', label: 'Falhou (retentando)' },
  exhausted: { variant: 'danger', label: 'Falhou' },
};

interface FormState {
  id: string | null;
  name: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
}

const EMPTY_FORM: FormState = { id: null, name: '', url: '', events: [], isActive: true };

const ALL_EVENT_IDS = WEBHOOK_EVENTS.map(e => e.id);

type ConfirmAction = { webhook: CompanyWebhook; kind: 'delete' | 'rotate' };

export function WebhooksPage({ companyId, userId, userEmail }: WebhooksPageProps) {
  const [webhooks, setWebhooks] = useState<CompanyWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<WebhookEventCategory[]>([]);

  const [revealedSecret, setRevealedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [deliveriesFor, setDeliveriesFor] = useState<CompanyWebhook | null>(null);
  const [deliveries, setDeliveries] = useState<CompanyWebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; result: WebhookTestResult } | null>(null);
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setWebhooks(await listWebhooks());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os webhooks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setCollapsed([]);
    setFormOpen(true);
  }

  function openEdit(w: CompanyWebhook) {
    // Um evento que saiu do catálogo não pode ser reenviado: o servidor
    // recusaria o update inteiro. Mantém só o que ainda é suportado.
    const known = w.events.filter((e): e is WebhookEvent => (ALL_EVENT_IDS as string[]).includes(e));
    setForm({ id: w.id, name: w.name, url: w.url, events: known, isActive: w.is_active });
    setError(null);
    setCollapsed([]);
    setFormOpen(true);
  }

  function toggleEvent(ev: WebhookEvent) {
    setForm(f => ({ ...f, events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev] }));
  }

  function toggleAllEvents() {
    setForm(f => ({ ...f, events: f.events.length === ALL_EVENT_IDS.length ? [] : [...ALL_EVENT_IDS] }));
  }

  function toggleCategory(category: WebhookEventCategory) {
    setCollapsed(c => c.includes(category) ? c.filter(x => x !== category) : [...c, category]);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.url.trim() || form.events.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        await updateWebhook(form.id, { name: form.name.trim(), url: form.url.trim(), events: form.events, isActive: form.isActive }, companyId, userId, userEmail);
        setFormOpen(false);
      } else {
        const created = await createWebhook({ name: form.name.trim(), url: form.url.trim(), events: form.events }, companyId, userId, userEmail);
        setFormOpen(false);
        setRevealedSecret({ name: form.name.trim(), secret: created.secret });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o webhook.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!confirming || busyId) return;
    const { webhook, kind } = confirming;
    setBusyId(webhook.id);
    setActionError(null);
    try {
      if (kind === 'delete') {
        await deleteWebhook(webhook.id, webhook.name, companyId, userId, userEmail);
        setConfirming(null);
        await load();
      } else {
        const secret = await rotateWebhookSecret(webhook.id, webhook.name, companyId, userId, userEmail);
        setConfirming(null);
        setRevealedSecret({ name: webhook.name, secret });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(w: CompanyWebhook) {
    setBusyId(w.id);
    try {
      await setWebhookActive(w.id, w.name, !w.is_active, companyId, userId, userEmail);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível alterar o status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(w: CompanyWebhook) {
    setBusyId(w.id);
    try {
      const result = await sendWebhookTest(w.id, w.name, companyId, userId, userEmail);
      setTestResult({ name: w.name, result });
      await load();
    } catch (err) {
      setTestResult({
        name: w.name,
        result: { ok: false, httpStatus: null, durationMs: null, error: err instanceof Error ? err.message : 'Não foi possível enviar o teste.' },
      });
    } finally {
      setBusyId(null);
    }
  }

  async function openDeliveries(w: CompanyWebhook) {
    setDeliveriesFor(w);
    setDeliveries([]);
    setDeliveriesLoading(true);
    try {
      setDeliveries(await listWebhookDeliveries(w.id));
    } finally {
      setDeliveriesLoading(false);
    }
  }

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponível */ }
  }

  const allSelected = form.events.length === ALL_EVENT_IDS.length;

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="Webhooks"
        description="Receba uma notificação HTTP assinada quando eventos reais acontecerem no InventoryBlind."
        actions={<Button onClick={openCreate}><Plus size={16} /> Novo webhook</Button>}
      />

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Webhooks ({webhooks.length})</p></PanelSection>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Carregando...</PanelSection>
        ) : loadError ? (
          <PanelSection padding="lg" className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button>
          </PanelSection>
        ) : webhooks.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhum webhook configurado ainda.</PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr><Th>Nome</Th><Th>URL</Th><Th>Eventos</Th><Th>Status</Th><Th>Criado em</Th><Th>Última entrega</Th><Th></Th></Tr>
              </Thead>
              <tbody>
                {webhooks.map(w => (
                  <Tr key={w.id}>
                    <Td className="font-medium text-fg">{w.name}</Td>
                    <Td className="text-fg-muted text-xs font-mono truncate max-w-[16rem]">{w.url}</Td>
                    <Td className="text-xs text-fg-subtle whitespace-nowrap">{w.events.length} evento(s)</Td>
                    <Td>{w.is_active ? <Badge variant="success">Ativo</Badge> : <Badge variant="neutral">Inativo</Badge>}</Td>
                    <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(w.created_at)}</Td>
                    <Td className="text-xs whitespace-nowrap">
                      {w.last_delivery_at ? (
                        <div className="flex items-center gap-2">
                          <Badge variant={w.last_delivery_status === 'delivered' ? 'success' : 'danger'}>
                            {w.last_delivery_status === 'delivered' ? 'Entregue' : 'Falhou'}
                            {w.last_delivery_http_status != null ? ` · ${w.last_delivery_http_status}` : ''}
                          </Badge>
                          <span className="text-fg-subtle">{formatDate(w.last_delivery_at)}</span>
                        </div>
                      ) : <span className="text-fg-subtle">Nenhuma ainda</span>}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Button size="sm" variant="ghost" disabled={busyId === w.id} onClick={() => handleTest(w)}><Send size={13} /> Testar</Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>Editar</Button>
                        <Button size="sm" variant="ghost" disabled={busyId === w.id} onClick={() => handleToggleActive(w)}>
                          <Power size={13} /> {w.is_active ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDeliveries(w)}><History size={13} /> Entregas</Button>
                        <Button size="sm" variant="ghost" title="Rotacionar segredo" disabled={busyId === w.id} onClick={() => { setActionError(null); setConfirming({ webhook: w, kind: 'rotate' }); }}><RotateCw size={13} /></Button>
                        <Button size="sm" variant="ghost" title="Excluir" disabled={busyId === w.id} onClick={() => { setActionError(null); setConfirming({ webhook: w, kind: 'delete' }); }}><Trash2 size={13} /></Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelSection padding="lg">
          <p className="text-sm font-semibold text-fg mb-2">Como validar as entregas</p>
          <p className="text-sm text-fg-muted mb-3">
            Cada entrega chega por POST com um envelope fixo — <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">id</code>,{' '}
            <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">event</code>,{' '}
            <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">created_at</code> e{' '}
            <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">data</code>. O campo{' '}
            <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">id</code> é único por entrega: use-o para ignorar repetições.
            A assinatura é o HMAC-SHA256 de <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">timestamp.corpo</code> com o segredo do webhook.
          </p>
          <pre className="bg-surface-3 border border-edge rounded-control p-3 text-xs font-mono text-fg-muted overflow-x-auto whitespace-pre">
{`X-InventoryBlind-Event: physical_count.finalized
X-InventoryBlind-Delivery: <id da entrega>
X-InventoryBlind-Timestamp: <segundos desde 1970>
X-InventoryBlind-Signature: <hmac_sha256(timestamp + "." + corpo)>`}
          </pre>
          <p className="text-xs text-fg-subtle mt-3">
            Responda com qualquer status 2xx. Falhas temporárias são retentadas até {WEBHOOK_MAX_ATTEMPTS} vezes, com intervalos crescentes.
          </p>
        </PanelSection>
      </Panel>

      {/* ── Criar/editar ──────────────────────────────────────────────────── */}
      <Modal open={formOpen} onClose={() => !saving && setFormOpen(false)} title={form.id ? 'Editar webhook' : 'Novo webhook'}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex.: Meu ERP" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">URL (HTTPS)</label>
            <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://exemplo.com/webhooks/inventoryblind" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-fg-muted">
                Eventos <span className="text-fg-subtle">({form.events.length} selecionado{form.events.length === 1 ? '' : 's'})</span>
              </label>
              <button type="button" onClick={toggleAllEvents} className="text-xs text-accent hover:underline">
                {allSelected ? 'Limpar seleção' : 'Selecionar todos'}
              </button>
            </div>

            <div className="border border-edge rounded-control divide-y divide-edge">
              {WEBHOOK_EVENT_GROUPS.map(group => {
                const isCollapsed = collapsed.includes(group.category);
                const selectedInGroup = group.events.filter(e => form.events.includes(e.id)).length;
                return (
                  <div key={group.category}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(group.category)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-3/50 transition-colors"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        {group.label}
                      </span>
                      <span className="text-xs text-fg-subtle">{selectedInGroup}/{group.events.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="px-3 pb-3 space-y-2">
                        {group.events.map(ev => (
                          <label key={ev.id} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={form.events.includes(ev.id)}
                              onChange={() => toggleEvent(ev.id)}
                            />
                            <span>
                              <span className="block text-sm text-fg">{ev.label}</span>
                              <span className="block text-xs text-fg-subtle">{ev.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {form.id && (
            <label className="flex items-center gap-2 text-sm text-fg cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              Webhook ativo
            </label>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={!form.name.trim() || !form.url.trim() || form.events.length === 0 || saving} onClick={handleSave}>
              {saving ? 'Salvando...' : form.id ? 'Salvar' : 'Criar webhook'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Segredo: única exibição ───────────────────────────────────────── */}
      <Modal open={!!revealedSecret} onClose={() => setRevealedSecret(null)} title="Guarde o segredo de assinatura">
        {revealedSecret && (
          <div className="space-y-4">
            <p className="text-sm text-fg">Webhook "{revealedSecret.name}"</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-surface-3 border border-edge rounded-control px-3 py-2 text-xs font-mono text-fg">{revealedSecret.secret}</code>
              <Button size="sm" variant="secondary" onClick={() => copySecret(revealedSecret.secret)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <p>Use este valor para validar a assinatura de cada entrega. Ele não será mostrado de novo — se perder, gere um novo pelo botão de rotação.</p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRevealedSecret(null)}>Concluir</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Resultado do teste ────────────────────────────────────────────── */}
      <Modal open={!!testResult} onClose={() => setTestResult(null)} title="Resultado do teste">
        {testResult && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Webhook "{testResult.name}"</p>
            <div className="flex items-center gap-3">
              <Badge variant={testResult.result.ok ? 'success' : 'danger'}>
                {testResult.result.ok ? 'Sucesso' : 'Falha'}
              </Badge>
              <span className="text-sm font-mono text-fg">
                {testResult.result.httpStatus != null ? `HTTP ${testResult.result.httpStatus}` : 'Sem resposta'}
                {testResult.result.durationMs != null ? ` · ${formatDuration(testResult.result.durationMs)}` : ''}
              </span>
            </div>
            {!testResult.result.ok && testResult.result.error && (
              <p className="text-xs text-fg-muted bg-surface-3 border border-edge rounded-control px-3 py-2">{testResult.result.error}</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setTestResult(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirmação de excluir/rotacionar ─────────────────────────────── */}
      <Modal
        open={!!confirming}
        onClose={() => !busyId && setConfirming(null)}
        title={confirming?.kind === 'delete' ? 'Excluir webhook' : 'Rotacionar segredo'}
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              {confirming.kind === 'delete'
                ? <>O webhook <span className="font-medium text-fg">"{confirming.webhook.name}"</span> e o histórico de entregas dele serão removidos. Esta ação não pode ser desfeita.</>
                : <>Um novo segredo será gerado para <span className="font-medium text-fg">"{confirming.webhook.name}"</span>. Entregas assinadas com o segredo antigo deixam de validar assim que você confirmar.</>}
            </p>
            {actionError && <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={!!busyId} onClick={() => setConfirming(null)}>Cancelar</Button>
              <Button variant={confirming.kind === 'delete' ? 'danger' : 'primary'} size="sm" disabled={!!busyId} onClick={handleConfirm}>
                {busyId ? 'Processando...' : confirming.kind === 'delete' ? 'Excluir' : 'Rotacionar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Histórico de entregas ─────────────────────────────────────────── */}
      <Modal open={!!deliveriesFor} onClose={() => setDeliveriesFor(null)} title={`Entregas — ${deliveriesFor?.name ?? ''}`} maxWidth="max-w-4xl">
        <div className="overflow-x-auto max-h-[24rem]">
          <Table>
            <Thead><Tr><Th>Data</Th><Th>Evento</Th><Th>Status</Th><Th>HTTP</Th><Th>Tentativas</Th><Th>Duração</Th><Th>Entrega</Th><Th>Erro</Th></Tr></Thead>
            <tbody>
              {deliveriesLoading ? (
                <Tr><Td colSpan={8} className="text-center py-6 text-fg-subtle text-sm">Carregando...</Td></Tr>
              ) : deliveries.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center py-6 text-fg-subtle text-sm">Nenhuma entrega registrada ainda.</Td></Tr>
              ) : deliveries.map(d => (
                <Tr key={d.id}>
                  <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDate(d.created_at)}</Td>
                  <Td className="text-xs text-fg-muted">{webhookEventLabel(d.event_type)}</Td>
                  <Td><Badge variant={DELIVERY_BADGE[d.status].variant}>{DELIVERY_BADGE[d.status].label}</Badge></Td>
                  <Td className="text-xs text-fg-subtle">{d.http_status ?? '—'}</Td>
                  <Td className="text-xs text-fg-subtle whitespace-nowrap">{d.attempt_count}/{WEBHOOK_MAX_ATTEMPTS}</Td>
                  <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDuration(d.duration_ms)}</Td>
                  <Td className="text-xs font-mono text-fg-subtle">{d.id.slice(0, 8)}…</Td>
                  <Td className="text-xs text-fg-subtle max-w-[14rem] truncate" title={d.error_message ?? undefined}>{d.error_message ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Modal>
    </Page>
  );
}

export default WebhooksPage;
