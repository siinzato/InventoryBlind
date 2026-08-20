import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, Check, Trash2, Send, RotateCw, History } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input } from '../ui';
import {
  listWebhooks, listWebhookDeliveries, createWebhook, updateWebhook, deleteWebhook,
  rotateWebhookSecret, sendWebhookTest, WEBHOOK_EVENT_OPTIONS,
  type CompanyWebhook, type CompanyWebhookDelivery, type WebhookEvent,
} from '../../lib/settings/webhooksService';

interface WebhooksPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const DELIVERY_BADGE: Record<CompanyWebhookDelivery['status'], { variant: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  delivered: { variant: 'success', label: 'Entregue' },
  pending: { variant: 'warning', label: 'Pendente' },
  failed: { variant: 'warning', label: 'Falhou (retentando)' },
  exhausted: { variant: 'danger', label: 'Falhou (esgotado)' },
};

interface FormState {
  id: string | null;
  name: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
}

const EMPTY_FORM: FormState = { id: null, name: '', url: '', events: [], isActive: true };

export function WebhooksPage({ companyId, userId, userEmail }: WebhooksPageProps) {
  const [webhooks, setWebhooks] = useState<CompanyWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<CompanyWebhook | null>(null);
  const [deliveries, setDeliveries] = useState<CompanyWebhookDelivery[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWebhooks(await listWebhooks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(w: CompanyWebhook) {
    setForm({ id: w.id, name: w.name, url: w.url, events: w.events as WebhookEvent[], isActive: w.is_active });
    setError(null);
    setFormOpen(true);
  }

  function toggleEvent(ev: WebhookEvent) {
    setForm(f => ({ ...f, events: f.events.includes(ev) ? f.events.filter(e => e !== ev) : [...f.events, ev] }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.url.trim() || form.events.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        await updateWebhook(form.id, { name: form.name.trim(), url: form.url.trim(), events: form.events, isActive: form.isActive }, companyId, userId, userEmail);
      } else {
        const created = await createWebhook({ name: form.name.trim(), url: form.url.trim(), events: form.events }, companyId, userId, userEmail);
        setRevealedSecret({ name: form.name.trim(), secret: created.secret });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o webhook.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(w: CompanyWebhook) {
    if (!confirm(`Remover o webhook "${w.name}"? As entregas registradas continuam no histórico.`)) return;
    setBusyId(w.id);
    try {
      await deleteWebhook(w.id, w.name, companyId, userId, userEmail);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível remover o webhook.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRotate(w: CompanyWebhook) {
    if (!confirm(`Rotacionar o segredo de "${w.name}"? Entregas assinadas com o segredo antigo vão parar de validar.`)) return;
    setBusyId(w.id);
    try {
      const secret = await rotateWebhookSecret(w.id, w.name, companyId, userId, userEmail);
      setRevealedSecret({ name: w.name, secret });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível rotacionar o segredo.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(w: CompanyWebhook) {
    setBusyId(w.id);
    try {
      await sendWebhookTest(w.id, w.name, companyId, userId, userEmail);
      alert('Disparo de teste enfileirado — a entrega roda pelo mesmo caminho real, em até 1 minuto.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível enviar o teste.');
    } finally {
      setBusyId(null);
    }
  }

  async function openDeliveries(w: CompanyWebhook) {
    setDeliveriesFor(w);
    setDeliveries(await listWebhookDeliveries(w.id));
  }

  async function copySecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponível */ }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="Webhooks"
        description="Receba uma notificação HTTP assinada quando eventos reais acontecerem no InventoryBlind."
        actions={<Button onClick={openCreate}><Plus size={16} /> Novo webhook</Button>}
      />

      {revealedSecret && (
        <Panel className="mb-6 border-accent/40">
          <PanelSection padding="lg">
            <p className="text-sm font-semibold text-fg mb-1">Segredo de "{revealedSecret.name}"</p>
            <p className="text-xs text-fg-muted mb-3">Use para validar a assinatura HMAC de cada entrega — este valor não será mostrado de novo.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-surface-3 border border-edge rounded-control px-3 py-2 text-xs font-mono text-fg">{revealedSecret.secret}</code>
              <Button size="sm" variant="secondary" onClick={() => copySecret(revealedSecret.secret)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setRevealedSecret(null)}>Entendi, já copiei</Button>
          </PanelSection>
        </Panel>
      )}

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Webhooks ({webhooks.length})</p></PanelSection>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Carregando...</PanelSection>
        ) : webhooks.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhum webhook configurado ainda.</PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr><Th>Nome</Th><Th>URL</Th><Th>Eventos</Th><Th>Status</Th><Th></Th></Tr>
              </Thead>
              <tbody>
                {webhooks.map(w => (
                  <Tr key={w.id}>
                    <Td className="font-medium text-fg">{w.name}</Td>
                    <Td className="text-fg-muted text-xs font-mono truncate max-w-[16rem]">{w.url}</Td>
                    <Td className="text-xs text-fg-subtle">{w.events.length} evento(s)</Td>
                    <Td>{w.is_active ? <Badge variant="success">Ativo</Badge> : <Badge variant="neutral">Inativo</Badge>}</Td>
                    <Td>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>Editar</Button>
                        <Button size="sm" variant="ghost" disabled={busyId === w.id} onClick={() => handleTest(w)}><Send size={13} /> Testar</Button>
                        <Button size="sm" variant="ghost" onClick={() => openDeliveries(w)}><History size={13} /> Entregas</Button>
                        <Button size="sm" variant="ghost" disabled={busyId === w.id} onClick={() => handleRotate(w)}><RotateCw size={13} /></Button>
                        <Button size="sm" variant="ghost" disabled={busyId === w.id} onClick={() => handleDelete(w)}><Trash2 size={13} /></Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={form.id ? 'Editar webhook' : 'Novo webhook'}>
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
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Eventos</label>
            <div className="space-y-1.5">
              {WEBHOOK_EVENT_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input type="checkbox" checked={form.events.includes(opt.value)} onChange={() => toggleEvent(opt.value)} />
                  {opt.label}
                </label>
              ))}
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
            <Button variant="secondary" size="sm" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={!form.name.trim() || !form.url.trim() || form.events.length === 0 || saving} onClick={handleSave}>
              {saving ? 'Salvando...' : form.id ? 'Salvar' : 'Criar webhook'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deliveriesFor} onClose={() => setDeliveriesFor(null)} title={`Entregas — ${deliveriesFor?.name ?? ''}`} maxWidth="max-w-2xl">
        <div className="overflow-x-auto max-h-[24rem]">
          <Table>
            <Thead><Tr><Th>Data</Th><Th>Evento</Th><Th>Status</Th><Th>Tentativas</Th><Th>HTTP</Th></Tr></Thead>
            <tbody>
              {deliveries.length === 0 ? (
                <Tr><Td colSpan={5} className="text-center py-6 text-fg-subtle text-sm">Nenhuma entrega registrada ainda.</Td></Tr>
              ) : deliveries.map(d => (
                <Tr key={d.id}>
                  <Td className="text-xs text-fg-subtle whitespace-nowrap">{formatDate(d.created_at)}</Td>
                  <Td className="text-xs font-mono text-fg-muted">{d.event_type}</Td>
                  <Td><Badge variant={DELIVERY_BADGE[d.status].variant}>{DELIVERY_BADGE[d.status].label}</Badge></Td>
                  <Td className="text-xs text-fg-subtle">{d.attempt_count}/3</Td>
                  <Td className="text-xs text-fg-subtle">{d.http_status ?? '—'}</Td>
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
