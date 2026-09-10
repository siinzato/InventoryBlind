import { useEffect, useState } from 'react';
import {
  ArrowLeft, RefreshCw, ExternalLink, Link2, AlertTriangle, Package, DollarSign, Building2, Boxes,
} from 'lucide-react';
import { Button, Input, Panel, PanelSection, Notice, Table, Thead, Tr, Th, Td } from '../ui';
import {
  getFullWithdrawalPlan, getFullWithdrawalItems, getFullWithdrawalEvents,
  advanceFullWithdrawalStatus, linkFullWithdrawalMl, conferFullWithdrawalItem, justifyFullWithdrawalDivergence,
} from '../../lib/reverseLogistics/fullWithdrawalService';
import {
  FULL_WITHDRAWAL_STATUS_LABEL, FULL_WITHDRAWAL_EVENT_LABEL, FULL_WITHDRAWAL_ITEM_SITUATION_LABEL,
  type FullWithdrawalPlan, type FullWithdrawalItem, type FullWithdrawalEvent, type FullWithdrawalStatus,
} from '../../lib/reverseLogistics/fullWithdrawalTypes';

const MERCADO_LIVRE_URL = 'https://www.mercadolivre.com.br/';

type Tab = 'items' | 'movements' | 'documents' | 'receiving';
const TABS: { key: Tab; label: string }[] = [
  { key: 'items', label: 'Itens' },
  { key: 'movements', label: 'Movimentações' },
  { key: 'documents', label: 'Documentos fiscais' },
  { key: 'receiving', label: 'Recebimento' },
];

interface FullWithdrawalDetailProps {
  planId: string;
  onBack: () => void;
}

function nextAdvance(status: FullWithdrawalStatus): { label: string; to: FullWithdrawalStatus } | null {
  if (status === 'reserved') return { label: 'Iniciar preparação', to: 'preparing' };
  if (status === 'preparing') return { label: 'Marcar como despachada', to: 'shipped' };
  if (status === 'shipped') return { label: 'Marcar como recebida', to: 'received' };
  return null;
}

function TimelineBar({ plan }: { plan: FullWithdrawalPlan }) {
  const steps = [
    { label: 'Planejada no IB', at: plan.createdAt },
    { label: 'Confirmada no\nMercado Livre', at: plan.mlConfirmedAt },
    { label: 'Reserva registrada', at: plan.reservedAt },
    { label: 'Em preparação', at: plan.preparingAt },
    { label: 'Despachada', at: plan.shippedAt },
    { label: 'Recebida', at: plan.receivedAt },
    { label: 'Conferida', at: plan.conferredAt },
  ];
  let lastDone = -1;
  steps.forEach((s, i) => { if (s.at) lastDone = i; });
  const current = plan.status === 'cancelled' || plan.status === 'with_divergence' ? lastDone : lastDone + 1;

  return (
    <div className="flex items-start">
      {steps.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center text-center min-w-0">
          <div className="flex items-center w-full">
            <div className={`flex-1 h-px ${i === 0 ? 'invisible' : i <= lastDone ? 'bg-accent' : 'bg-edge'}`} />
            <span className={`h-3 w-3 rounded-full flex-shrink-0 ${
              i <= lastDone ? 'bg-accent' : i === current ? 'border-2 border-accent bg-surface' : 'border border-edge bg-surface'
            }`} />
            <div className={`flex-1 h-px ${i === steps.length - 1 ? 'invisible' : i < lastDone ? 'bg-accent' : 'bg-edge'}`} />
          </div>
          <p className={`text-xs mt-2 whitespace-pre-line ${i <= lastDone ? 'text-fg font-medium' : i === current ? 'text-accent font-medium' : 'text-fg-subtle'}`}>{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function SituationText({ situation }: { situation: FullWithdrawalItem['situation'] }) {
  if (situation === 'divergent') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400">
        <AlertTriangle size={12} />{FULL_WITHDRAWAL_ITEM_SITUATION_LABEL[situation]}
      </span>
    );
  }
  if (situation === 'ok') return <span className="text-sm font-medium text-accent">{FULL_WITHDRAWAL_ITEM_SITUATION_LABEL[situation]}</span>;
  return <span className="text-sm text-fg-subtle">{FULL_WITHDRAWAL_ITEM_SITUATION_LABEL[situation]}</span>;
}

export function FullWithdrawalDetail({ planId, onBack }: FullWithdrawalDetailProps) {
  const [plan, setPlan] = useState<FullWithdrawalPlan | null>(null);
  const [items, setItems] = useState<FullWithdrawalItem[]>([]);
  const [events, setEvents] = useState<FullWithdrawalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('items');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number>(Date.now());
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [linkOpen, setLinkOpen] = useState(false);
  const [mlRefInput, setMlRefInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [dateInput, setDateInput] = useState('');

  const [receivedInputs, setReceivedInputs] = useState<Map<string, string>>(new Map());
  const [justifyInputs, setJustifyInputs] = useState<Map<string, string>>(new Map());

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, its, evs] = await Promise.all([
        getFullWithdrawalPlan(planId),
        getFullWithdrawalItems(planId),
        getFullWithdrawalEvents(planId),
      ]);
      setPlan(p);
      setItems(its);
      setEvents(evs);
      setLastLoadedAt(Date.now());
    } catch {
      setLoadError('Não foi possível carregar a retirada Full.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  async function handleAdvance(to: FullWithdrawalStatus) {
    setBusy(true);
    setActionError(null);
    try {
      await advanceFullWithdrawalStatus(planId, to);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLinkMl() {
    if (!mlRefInput.trim()) { setActionError('Informe o identificador real da retirada no Mercado Livre.'); return; }
    setBusy(true);
    setActionError(null);
    try {
      await linkFullWithdrawalMl(planId, mlRefInput.trim(), costInput ? Number(costInput) : null, dateInput || null);
      setLinkOpen(false);
      setMlRefInput(''); setCostInput(''); setDateInput('');
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível vincular a retirada do Mercado Livre.');
    } finally {
      setBusy(false);
    }
  }

  async function handleConferItem(itemId: string) {
    const raw = receivedInputs.get(itemId);
    if (raw === undefined || raw.trim() === '') return;
    setBusy(true);
    setActionError(null);
    try {
      await conferFullWithdrawalItem(itemId, Number(raw));
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível registrar a conferência.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJustify(itemId: string) {
    const note = justifyInputs.get(itemId);
    if (!note || note.trim().length < 5) { setActionError('A justificativa precisa ter pelo menos 5 caracteres.'); return; }
    setBusy(true);
    setActionError(null);
    try {
      await justifyFullWithdrawalDivergence(itemId, note.trim());
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível justificar a divergência.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setSyncNotice(null);
    await load();
    setSyncNotice('Não há sincronização automática com o Mercado Livre nesta versão — os dados exibidos são os já registrados no InventoryBlind.');
  }

  if (loading) return <div className="p-8 text-center text-sm text-fg-subtle">Carregando…</div>;
  if (loadError || !plan) {
    return (
      <div className="p-8">
        <Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Voltar</Button>
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{loadError ?? 'Retirada não encontrada.'}</p>
      </div>
    );
  }

  const advance = nextAdvance(plan.status);
  const canConference = plan.status === 'received' || plan.status === 'with_divergence';

  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface border-b border-edge px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="p-1.5 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors flex-shrink-0">
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <p className="text-xs text-fg-subtle">Logística Reversa / Retiradas Full</p>
              <h1 className="text-title truncate">Retirada Full {plan.code}</h1>
              <p className="text-caption truncate">
                {plan.mlReference ? `Retirada Mercado Livre #${plan.mlReference} · ` : ''}Criada em {new Date(plan.createdAt).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="secondary" onClick={handleSync}><RefreshCw size={15} /> <span className="hidden sm:inline">Atualizar do Mercado Livre</span></Button>
            <Button
              variant="secondary"
              onClick={() => window.open(MERCADO_LIVRE_URL, '_blank', 'noopener,noreferrer')}
              disabled={plan.status === 'draft'}
            >
              <ExternalLink size={15} /> <span className="hidden sm:inline">Abrir no Mercado Livre</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="text-sm">
          <span className={plan.status === 'with_divergence' || plan.status === 'cancelled' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-accent font-medium'}>
            {FULL_WITHDRAWAL_STATUS_LABEL[plan.status]}
          </span>
        </div>

        {syncNotice && <Notice tone="neutral">{syncNotice}</Notice>}
        {actionError && <Notice tone="danger">{actionError}</Notice>}

        <Panel>
          <PanelSection padding="md" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-2"><Boxes size={16} className="text-fg-subtle" /><div><p className="text-caption">SKUs</p><p className="text-fg font-semibold">{items.length}</p></div></div>
            <div className="flex items-center gap-2"><Package size={16} className="text-fg-subtle" /><div><p className="text-caption">Unidades</p><p className="text-fg font-semibold">{items.reduce((s, i) => s + i.plannedQuantity, 0)}</p></div></div>
            <div className="flex items-center gap-2"><DollarSign size={16} className="text-fg-subtle" /><div><p className="text-caption">Custo informado</p><p className="text-fg font-semibold">{plan.cost != null ? plan.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</p></div></div>
            <div className="flex items-center gap-2"><Building2 size={16} className="text-fg-subtle" /><div><p className="text-caption">Destino</p><p className="text-fg font-semibold truncate">{plan.destinationLabel ?? '—'}</p></div></div>
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="sm"><h2 className="text-title">Andamento da retirada</h2></PanelSection>
          <PanelSection><TimelineBar plan={plan} /></PanelSection>
          <PanelSection padding="sm" className="flex items-center justify-between text-caption flex-wrap gap-2">
            <span>Última atualização: {new Date(lastLoadedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            <button onClick={() => setTab('movements')} className="text-accent font-medium">Ver histórico completo</button>
          </PanelSection>
        </Panel>

        {plan.status === 'awaiting_confirmation' && (
          <Panel>
            <PanelSection padding="sm" className="flex items-center justify-between">
              <h3 className="text-title flex items-center gap-2"><Link2 size={15} className="text-fg-subtle" />Vincular retirada do ML</h3>
              {!linkOpen && <Button size="sm" onClick={() => setLinkOpen(true)}>Vincular retirada do ML</Button>}
            </PanelSection>
            {linkOpen && (
              <PanelSection className="space-y-2">
                <p className="text-sm text-fg-subtle">Não há correlação automática com o Mercado Livre — informe o identificador real confirmado no painel deles.</p>
                <Input placeholder="Identificador da retirada no Mercado Livre" value={mlRefInput} onChange={e => setMlRefInput(e.target.value)} />
                <Input placeholder="Custo informado (opcional)" type="number" value={costInput} onChange={e => setCostInput(e.target.value)} />
                <Input placeholder="Previsão de entrega (opcional)" type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={handleLinkMl}>Confirmar vínculo</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>Cancelar</Button>
                </div>
              </PanelSection>
            )}
          </Panel>
        )}

        {advance && (
          <Panel>
            <PanelSection padding="md" className="flex items-center justify-between">
              <div>
                <p className="text-label">Próxima ação</p>
                <p className="text-sm text-fg-muted">Atualize o status assim que confirmar a etapa no Mercado Livre.</p>
              </div>
              <Button disabled={busy} onClick={() => handleAdvance(advance.to)}>{advance.label}</Button>
            </PanelSection>
          </Panel>
        )}

        <Panel>
          <div className="flex gap-5 border-b border-edge px-4 pt-2 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  tab === t.key ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'items' && (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Produto / SKU</Th>
                    <Th>Inventory ID</Th>
                    <Th>Planejado</Th>
                    <Th>Confirmado pelo Full</Th>
                    <Th>Recebido</Th>
                    <Th>Situação</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {items.map(it => (
                    <Tr key={it.id}>
                      <Td>
                        <p className="font-medium text-fg">{it.description}</p>
                        <p className="text-caption">SKU {it.sku ?? '—'}</p>
                      </Td>
                      <Td className="text-fg-subtle">—</Td>
                      <Td numeric>{it.plannedQuantity}</Td>
                      <Td numeric>{it.confirmedQuantity ?? '—'}</Td>
                      <Td numeric>{it.receivedQuantity ?? '—'}</Td>
                      <Td><SituationText situation={it.situation} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <PanelSection padding="sm" className="text-caption">
                {items.reduce((s, i) => s + i.plannedQuantity, 0)} unidades planejadas nesta retirada.
              </PanelSection>
            </div>
          )}

          {tab === 'movements' && (
            <div className="divide-y divide-edge/60">
              {events.length === 0 ? (
                <p className="p-6 text-sm text-fg-subtle text-center">Nenhuma movimentação registrada ainda.</p>
              ) : events.map(ev => (
                <div key={ev.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{FULL_WITHDRAWAL_EVENT_LABEL[ev.eventType]}</p>
                    {ev.note && <p className="text-xs text-fg-subtle truncate">{ev.note}</p>}
                    <p className="text-[11px] text-fg-subtle">{ev.eventType}</p>
                  </div>
                  <span className="text-xs text-fg-subtle whitespace-nowrap flex-shrink-0">{new Date(ev.occurredAt).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'documents' && (
            <PanelSection className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-fg">Documento fiscal de retirada</p>
                  <p className="text-caption">Nenhum documento disponível ainda.</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-edge pt-3">
                <div>
                  <p className="text-sm font-medium text-fg">Custo de retirada</p>
                  <p className="text-caption">{plan.cost != null ? plan.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Aguardando informação do Mercado Livre'}{plan.costNote ? ` · ${plan.costNote}` : ''}</p>
                </div>
              </div>
            </PanelSection>
          )}

          {tab === 'receiving' && (
            <PanelSection className="space-y-4">
              {!canConference ? (
                <p className="text-sm text-fg-subtle">A conferência é liberada assim que a retirada for marcada como recebida.</p>
              ) : (
                <div className="space-y-3">
                  {items.map(it => (
                    <div key={it.id} className="border border-edge rounded-container p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">{it.description}</p>
                          <p className="text-caption">Planejado {it.plannedQuantity} · Confirmado pelo Full {it.confirmedQuantity ?? '—'}</p>
                        </div>
                        <SituationText situation={it.situation} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input
                          type="number"
                          placeholder="Quantidade recebida"
                          value={receivedInputs.get(it.id) ?? ''}
                          onChange={e => setReceivedInputs(prev => new Map(prev).set(it.id, e.target.value))}
                          className="w-40"
                        />
                        <Button size="sm" disabled={busy} onClick={() => handleConferItem(it.id)}>Confirmar contagem</Button>
                      </div>
                      {it.situation === 'divergent' && !it.divergenceNote && (
                        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-edge">
                          <Input
                            placeholder="Justificativa da divergência"
                            value={justifyInputs.get(it.id) ?? ''}
                            onChange={e => setJustifyInputs(prev => new Map(prev).set(it.id, e.target.value))}
                            className="flex-1 min-w-[220px]"
                          />
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleJustify(it.id)}>Justificar</Button>
                        </div>
                      )}
                      {it.divergenceNote && (
                        <p className="text-xs text-fg-subtle">Justificativa: {it.divergenceNote}</p>
                      )}
                    </div>
                  ))}
                  <Button disabled={busy} onClick={() => handleAdvance('conferred')}>Concluir conferência</Button>
                </div>
              )}
            </PanelSection>
          )}
        </Panel>
      </div>
    </div>
  );
}
