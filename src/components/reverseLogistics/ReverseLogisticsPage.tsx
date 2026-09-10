import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, FileText, LayoutGrid, BarChart3, Settings2, PackageMinus } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Button, Input, Select, Table, Thead, Tr, Th, Td, SegmentedControl, StatRow, StatCell, Stat } from '../ui';
import { useAuth } from '../../lib/auth';
import { hasPermission, canConfigureReturnRules } from '../../lib/permissionService';
import {
  listReturns, listItemsForReturns, fetchReturnUserNames, batchApplyToItems,
  type BatchAction,
} from '../../lib/reverseLogistics/reverseLogisticsService';
import { computeReturnItemsSummary } from '../../lib/reverseLogistics/reverseLogisticsRules';
import { buildReturnSlaAlerts } from '../../lib/reverseLogistics/reverseLogisticsSla';
import { computeReturnKpis } from '../../lib/reverseLogistics/reverseLogisticsKpis';
import {
  RETURN_STATUS_LABEL, RETURN_DESTINATION_LABEL,
  type ReturnRecord, type ReturnStatus, type ReturnDestination, type ReturnItem,
} from '../../lib/reverseLogistics/reverseLogisticsTypes';
import type { FullWithdrawalStatus } from '../../lib/reverseLogistics/fullWithdrawalTypes';
import { NewReturnModal } from './NewReturnModal';
import { ReturnDetailPage } from './ReturnDetailPage';
import { ReturnConfigPanel } from './ReturnConfigPanel';
import { FullWithdrawalsView } from './FullWithdrawalsView';
import { PlanFullWithdrawalWizard } from './PlanFullWithdrawalWizard';
import { FullWithdrawalDetail } from './FullWithdrawalDetail';

type View = 'list' | 'full' | 'kpis' | 'config';
type FullSubView = 'list' | 'wizard' | 'detail';

interface ReverseLogisticsPageProps {
  companyId: string;
}

/** Texto + ponto — nunca badge colorido para um status comum. Vermelho é
 *  reservado para cancelamento (o único estado real de bloqueio/falha aqui). */
function ReturnStatusText({ status }: { status: ReturnStatus }) {
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-600 dark:bg-red-400" />
        {RETURN_STATUS_LABEL[status]}
      </span>
    );
  }
  const active = status === 'in_conference' || status === 'in_inspection' || status === 'awaiting_destination';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${active ? 'font-medium text-accent' : 'text-fg-muted'}`}>
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-fg-subtle'}`} />
      {RETURN_STATUS_LABEL[status]}
    </span>
  );
}

export function ReverseLogisticsPage({ companyId }: ReverseLogisticsPageProps) {
  const { profile } = useAuth();
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [summaries, setSummaries] = useState<Map<string, { itemCount: number; predominantDestination: ReturnDestination | null }>>(new Map());
  const [userNames, setUserNames] = useState<Map<string, { name: string | null; email: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'all'>('all');
  const [destinationFilter, setDestinationFilter] = useState<ReturnDestination | 'all'>('all');
  const [reasonFilter, setReasonFilter] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [fullSubView, setFullSubView] = useState<FullSubView>('list');
  const [selectedFullPlanId, setSelectedFullPlanId] = useState<string | null>(null);
  const [editDraftPlanId, setEditDraftPlanId] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<Awaited<ReturnType<typeof listItemsForReturns>>>([]);
  const [kpiPeriodStart, setKpiPeriodStart] = useState('');
  const [kpiPeriodEnd, setKpiPeriodEnd] = useState('');
  const [selectedReturnIds, setSelectedReturnIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const canRead = hasPermission(profile?.role, 'inventory.read');
  const canWrite = hasPermission(profile?.role, 'inventory.write');
  const canConfigure = canConfigureReturnRules(profile?.role);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listReturns(companyId);
      setReturns(data);

      const [items, names] = await Promise.all([
        listItemsForReturns(data.map(r => r.id)),
        fetchReturnUserNames(data.map(r => r.receivedBy)),
      ]);
      setUserNames(names);
      setAllItems(items);

      const byReturn = new Map<string, typeof items>();
      for (const item of items) {
        const list = byReturn.get(item.returnId) ?? [];
        list.push(item);
        byReturn.set(item.returnId, list);
      }
      const nextSummaries = new Map<string, { itemCount: number; predominantDestination: ReturnDestination | null }>();
      for (const record of data) {
        const rows = byReturn.get(record.id) ?? [];
        const summary = computeReturnItemsSummary(rows);
        nextSummaries.set(record.id, { itemCount: summary.itemCount, predominantDestination: summary.predominantDestination });
      }
      setSummaries(nextSummaries);
    } catch (err) {
      console.error('Error loading returns:', err);
      setLoadError('Não foi possível carregar as devoluções. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const reasons = useMemo(() => Array.from(new Set(returns.map(r => r.reason).filter((r): r is string => !!r))).sort(), [returns]);

  const filtered = returns.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (destinationFilter !== 'all' && summaries.get(r.id)?.predominantDestination !== destinationFilter) return false;
    if (reasonFilter && r.reason !== reasonFilter) return false;
    if (skuFilter) {
      const term = skuFilter.trim().toLowerCase();
      const matchesCode = r.code.toLowerCase().includes(term);
      const matchesCustomer = (r.customerName ?? '').toLowerCase().includes(term);
      if (!matchesCode && !matchesCustomer) return false;
    }
    if (periodStart && r.receivedAt < periodStart) return false;
    if (periodEnd && r.receivedAt > `${periodEnd}T23:59:59`) return false;
    return true;
  });

  if (!canRead) {
    return (
      <Page>
        <PageHeader title="Logística Reversa" description="Você não tem permissão para consultar este módulo." />
      </Page>
    );
  }

  if (selectedId) {
    return (
      <ReturnDetailPage
        companyId={companyId}
        returnId={selectedId}
        onBack={() => { setSelectedId(null); load(); }}
      />
    );
  }

  if (view === 'full' && fullSubView === 'wizard') {
    return (
      <PlanFullWithdrawalWizard
        companyId={companyId}
        existingPlanId={editDraftPlanId}
        onCancel={() => setFullSubView('list')}
        onDone={(planId, opts) => {
          setSelectedFullPlanId(planId);
          setFullSubView(opts?.openDetail ? 'detail' : 'list');
        }}
      />
    );
  }

  if (view === 'full' && fullSubView === 'detail' && selectedFullPlanId) {
    return (
      <FullWithdrawalDetail
        planId={selectedFullPlanId}
        onBack={() => setFullSubView('list')}
      />
    );
  }

  const toggleSelected = (id: string) => {
    setSelectedReturnIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runBatchAction = async (action: BatchAction) => {
    if (batchBusy || selectedReturnIds.size === 0) return;
    const itemIds = allItems.filter(i => selectedReturnIds.has(i.returnId)).map(i => i.id);
    if (itemIds.length === 0) return;
    setBatchBusy(true);
    try {
      await batchApplyToItems(itemIds, action, {});
      setSelectedReturnIds(new Set());
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível aplicar a ação em lote.');
    } finally {
      setBatchBusy(false);
    }
  };

  const slaAlerts = buildReturnSlaAlerts(returns, [], [], [], []);
  const kpis = computeReturnKpis(returns, allItems as unknown as ReturnItem[], { start: kpiPeriodStart || null, end: kpiPeriodEnd || null }, () => null, new Set());

  return (
    <Page>
      <PageHeader
        title="Logística Reversa"
        description="Recebimento, conferência, inspeção e destinação de mercadorias devolvidas."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Visão"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'Devoluções', icon: LayoutGrid },
                { value: 'full', label: 'Retiradas Full', icon: PackageMinus },
                { value: 'kpis', label: 'Indicadores', icon: BarChart3 },
                ...(canConfigure ? [{ value: 'config' as View, label: 'Configurações', icon: Settings2 }] : []),
              ]}
            />
            {view === 'list' && canWrite && (
              <Button onClick={() => setShowNew(true)}><Plus size={16} /> Nova Devolução</Button>
            )}
            {view === 'full' && fullSubView === 'list' && canWrite && (
              <Button onClick={() => { setEditDraftPlanId(null); setFullSubView('wizard'); }}>
                <Plus size={16} /> Planejar retirada Full
              </Button>
            )}
          </div>
        }
      />

      {view === 'config' && canConfigure && <ReturnConfigPanel companyId={companyId} userId={profile?.id ?? ''} userEmail={profile?.email ?? ''} />}

      {view === 'full' && fullSubView === 'list' && (
        <FullWithdrawalsView
          companyId={companyId}
          onOpenPlan={(planId: string, status: FullWithdrawalStatus) => {
            setSelectedFullPlanId(planId);
            if (status === 'draft') { setEditDraftPlanId(planId); setFullSubView('wizard'); }
            else setFullSubView('detail');
          }}
        />
      )}

      {view === 'kpis' && (
        <>
          <Panel>
            <PanelSection padding="md" className="flex flex-wrap gap-3">
              <Input type="date" value={kpiPeriodStart} onChange={e => setKpiPeriodStart(e.target.value)} />
              <Input type="date" value={kpiPeriodEnd} onChange={e => setKpiPeriodEnd(e.target.value)} />
            </PanelSection>
            <PanelSection padding="md">
              <StatRow>
                <StatCell><Stat label="Devoluções recebidas" value={kpis.receivedCount} context="No período selecionado" /></StatCell>
                <StatCell><Stat label="Tempo médio de processamento" value={kpis.averageProcessingDays != null ? `${kpis.averageProcessingDays.toFixed(1)}d` : '—'} context="Recebimento → finalização" /></StatCell>
                <StatCell><Stat label="% recuperado para venda" value={kpis.recoveredPct != null ? `${kpis.recoveredPct.toFixed(0)}%` : '—'} context="Itens com destinação restock" /></StatCell>
                <StatCell><Stat label="% enviado à assistência" value={kpis.assistancePct != null ? `${kpis.assistancePct.toFixed(0)}%` : '—'} context="Assistência técnica + recondicionamento" /></StatCell>
                <StatCell><Stat label="% descartado" value={kpis.discardedPct != null ? `${kpis.discardedPct.toFixed(0)}%` : '—'} context="Itens com destinação discard" /></StatCell>
              </StatRow>
            </PanelSection>
            <PanelSection padding="md">
              <StatRow>
                <StatCell><Stat label="Valor recuperado" value={kpis.recoveredValue != null ? kpis.recoveredValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'} context={kpis.hasValueData ? 'Preço cadastrado × qtd. restock' : 'Sem produtos com preço cadastrado no período'} /></StatCell>
                <StatCell><Stat label="Valor estimado de perda" value={kpis.estimatedLossValue != null ? kpis.estimatedLossValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'} context="Preço cadastrado × qtd. discard/avariado" /></StatCell>
              </StatRow>
            </PanelSection>
            {kpis.topReasons.length > 0 && (
              <PanelSection padding="md">
                <p className="text-label mb-2">Principais motivos</p>
                {kpis.topReasons.map(r => <p key={r.reason} className="text-sm text-fg">{r.reason} — {r.count}</p>)}
              </PanelSection>
            )}
            {kpis.topProducts.length > 0 && (
              <PanelSection padding="md">
                <p className="text-label mb-2">Produtos com maior recorrência</p>
                {kpis.topProducts.map(p => <p key={p.sku} className="text-sm text-fg">{p.sku} — {p.count}</p>)}
              </PanelSection>
            )}
          </Panel>
          {slaAlerts.length > 0 && (
            <Panel>
              <PanelSection padding="md"><p className="text-title">Alertas de SLA</p></PanelSection>
              {slaAlerts.map(alert => (
                <PanelSection key={alert.type} padding="sm" className="text-sm text-amber-700 dark:text-amber-400">{alert.title}</PanelSection>
              ))}
            </Panel>
          )}
        </>
      )}

      {view === 'list' && (
        <>
          <Panel>
            <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
              <Input placeholder="Código, cliente ou SKU..." value={skuFilter} onChange={e => setSkuFilter(e.target.value)} className="flex-1 min-w-[220px]" />
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} aria-label="Data inicial" />
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} aria-label="Data final" />
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as ReturnStatus | 'all')}>
                <option value="all">Todos os status</option>
                {(Object.keys(RETURN_STATUS_LABEL) as ReturnStatus[]).map(s => <option key={s} value={s}>{RETURN_STATUS_LABEL[s]}</option>)}
              </Select>
              <Select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)}>
                <option value="">Todos os motivos</option>
                {reasons.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
              <Select value={destinationFilter} onChange={e => setDestinationFilter(e.target.value as ReturnDestination | 'all')}>
                <option value="all">Todas as destinações</option>
                {(Object.keys(RETURN_DESTINATION_LABEL) as ReturnDestination[]).map(d => <option key={d} value={d}>{RETURN_DESTINATION_LABEL[d]}</option>)}
              </Select>
              {(statusFilter !== 'all' || destinationFilter !== 'all' || reasonFilter || skuFilter || periodStart || periodEnd) && (
                <button
                  onClick={() => { setStatusFilter('all'); setDestinationFilter('all'); setReasonFilter(''); setSkuFilter(''); setPeriodStart(''); setPeriodEnd(''); }}
                  className="text-xs text-accent hover:underline"
                >
                  Limpar filtros
                </button>
              )}
            </PanelSection>

            {canWrite && selectedReturnIds.size > 0 && (
              <PanelSection padding="md" className="flex flex-wrap items-center gap-2 bg-surface-3">
                <span className="text-sm text-fg-subtle">{selectedReturnIds.size} devolução(ões) selecionada(s):</span>
                <Button size="sm" variant="secondary" disabled={batchBusy} onClick={() => runBatchAction('move_to_conference')}>Mover para conferência</Button>
                <Button size="sm" variant="secondary" disabled={batchBusy} onClick={() => runBatchAction('send_to_quarantine')}>Enviar para quarentena</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedReturnIds(new Set())}>Limpar seleção</Button>
              </PanelSection>
            )}

            {loading && (
              <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" /> Carregando...
              </PanelSection>
            )}

            {!loading && loadError && (
              <PanelSection padding="lg" className="text-center text-sm text-red-600 dark:text-red-400">{loadError}</PanelSection>
            )}

            {!loading && !loadError && filtered.length === 0 && (
              <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
                Nenhuma devolução encontrada.
              </PanelSection>
            )}

            {!loading && !loadError && filtered.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Tr>
                      {canWrite && <Th className="w-8"></Th>}
                      <Th>Código</Th>
                      <Th>Cliente / Origem</Th>
                      <Th>Pedido/Documento</Th>
                      <Th className="text-right">Itens</Th>
                      <Th>Recebida em</Th>
                      <Th>Status</Th>
                      <Th>Destinação predominante</Th>
                      <Th>Responsável</Th>
                      <Th></Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {filtered.map(r => {
                      const summary = summaries.get(r.id);
                      return (
                        <Tr key={r.id} className="cursor-pointer" onClick={() => setSelectedId(r.id)}>
                          {canWrite && (
                            <Td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedReturnIds.has(r.id)} onChange={() => toggleSelected(r.id)} className="h-4 w-4 rounded border-edge" />
                            </Td>
                          )}
                          <Td className="font-medium whitespace-nowrap">{r.code}</Td>
                          <Td>
                            <p className="text-fg">{r.customerName ?? r.origin ?? '—'}</p>
                            {r.customerName && r.origin && <p className="text-xs text-fg-subtle">{r.origin}</p>}
                          </Td>
                          <Td>{r.referenceValue ?? '—'}</Td>
                          <Td numeric>{summary?.itemCount ?? 0}</Td>
                          <Td>{new Date(r.receivedAt).toLocaleDateString('pt-BR')}</Td>
                          <Td><ReturnStatusText status={r.status} /></Td>
                          <Td className="text-fg-muted">{summary?.predominantDestination ? RETURN_DESTINATION_LABEL[summary.predominantDestination] : '—'}</Td>
                          <Td>{r.receivedBy ? (userNames.get(r.receivedBy)?.name ?? userNames.get(r.receivedBy)?.email ?? '—') : '—'}</Td>
                          <Td>
                            <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setSelectedId(r.id); }}>
                              <FileText size={14} /> Ver
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Panel>

          {showNew && (
            <NewReturnModal companyId={companyId} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />
          )}
        </>
      )}
    </Page>
  );
}
