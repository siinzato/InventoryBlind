import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, ClipboardList, PackageCheck, Truck } from 'lucide-react';
import { Panel, PanelSection, Table, Thead, Tr, Th, Td, Button, Input, Select, StatRow, StatCell, Stat } from '../ui';
import {
  listFullWithdrawalPlans, listItemsForPlans, fetchFullWithdrawalUserNames,
} from '../../lib/reverseLogistics/fullWithdrawalService';
import {
  FULL_WITHDRAWAL_STATUS_LABEL,
  type FullWithdrawalPlan, type FullWithdrawalStatus,
} from '../../lib/reverseLogistics/fullWithdrawalTypes';

interface FullWithdrawalsViewProps {
  companyId: string;
  onOpenPlan: (planId: string, status: FullWithdrawalStatus) => void;
}

/** Etapa como mostrada na tabela — "Divergência no recebimento" é mais
 *  específico que o rótulo genérico de status (usado no filtro), mas é o
 *  mesmo status real (with_divergence). */
function stageColumnLabel(status: FullWithdrawalStatus): string {
  if (status === 'with_divergence') return 'Divergência no recebimento';
  return FULL_WITHDRAWAL_STATUS_LABEL[status];
}

/** Só "Com divergência" e falhas (cancelada) recebem vermelho — o resto é
 *  grafite (ainda não avançou) ou azul (ativa/concluída), nunca uma cor por etapa. */
function StageText({ status }: { status: FullWithdrawalStatus }) {
  if (status === 'with_divergence' || status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400">
        <AlertTriangle size={13} />{stageColumnLabel(status)}
      </span>
    );
  }
  if (status === 'draft' || status === 'awaiting_confirmation') {
    return <span className="text-sm font-medium text-fg-subtle">{stageColumnLabel(status)}</span>;
  }
  return <span className="text-sm font-medium text-accent">{stageColumnLabel(status)}</span>;
}

function actionLabel(status: FullWithdrawalStatus): string {
  switch (status) {
    case 'draft': return 'Continuar rascunho';
    case 'awaiting_confirmation': return 'Continuar no ML';
    case 'received': return 'Iniciar conferência';
    case 'with_divergence': return 'Revisar';
    case 'shipped':
    case 'conferred':
    case 'cancelled': return 'Ver detalhes';
    default: return 'Acompanhar';
  }
}

export function FullWithdrawalsView({ companyId, onOpenPlan }: FullWithdrawalsViewProps) {
  const [plans, setPlans] = useState<FullWithdrawalPlan[]>([]);
  const [itemSummary, setItemSummary] = useState<Map<string, { skuCount: number; totalUnits: number }>>(new Map());
  const [userNames, setUserNames] = useState<Map<string, { name: string | null; email: string | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FullWithdrawalStatus | 'all'>('all');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listFullWithdrawalPlans(companyId);
      setPlans(data);
      const [items, names] = await Promise.all([
        listItemsForPlans(data.map(p => p.id)),
        fetchFullWithdrawalUserNames(data.map(p => p.createdBy)),
      ]);
      setUserNames(names);
      const byPlan = new Map<string, { skuCount: number; totalUnits: number }>();
      for (const item of items) {
        const entry = byPlan.get(item.planId) ?? { skuCount: 0, totalUnits: 0 };
        entry.skuCount += 1;
        entry.totalUnits += item.plannedQuantity;
        byPlan.set(item.planId, entry);
      }
      setItemSummary(byPlan);
    } catch (err) {
      console.error('Error loading full withdrawal plans:', err);
      setLoadError('Não foi possível carregar as retiradas Full. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const handleSync = async () => {
    setSyncNotice(null);
    await load();
    setSyncNotice('Não há sincronização automática com o Mercado Livre nesta versão — use "Vincular retirada do ML" dentro de cada plano para registrar o identificador real.');
  };

  const filtered = plans.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (periodStart && p.createdAt < periodStart) return false;
    if (periodEnd && p.createdAt > `${periodEnd}T23:59:59`) return false;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      const matches = p.code.toLowerCase().includes(term)
        || (p.mlReference ?? '').toLowerCase().includes(term)
        || (userNames.get(p.createdBy ?? '')?.name ?? '').toLowerCase().includes(term);
      if (!matches) return false;
    }
    return true;
  });

  const kpi = useMemo(() => ({
    planosNoIb: plans.filter(p => p.status !== 'cancelled').length,
    reservadasNoFull: plans.filter(p => p.status === 'reserved').length,
    emTransporte: plans.filter(p => p.status === 'shipped').length,
    comDivergencia: plans.filter(p => p.status === 'with_divergence').length,
  }), [plans]);

  return (
    <>
      <Panel>
        <PanelSection padding="sm" className="text-sm text-fg-muted flex items-center gap-2">
          <ClipboardList size={15} className="text-fg-subtle flex-shrink-0" />
          Planeje no IB, confirme no Mercado Livre e acompanhe a movimentação até o recebimento.
        </PanelSection>
        <PanelSection padding="md">
          <StatRow>
            <StatCell><Stat label="Planos no IB" value={kpi.planosNoIb} icon={<ClipboardList />} /></StatCell>
            <StatCell><Stat label="Reservadas no Full" value={kpi.reservadasNoFull} icon={<PackageCheck />} /></StatCell>
            <StatCell><Stat label="Em transporte" value={kpi.emTransporte} icon={<Truck />} /></StatCell>
            <StatCell>
              <Stat
                label="Com divergência"
                value={kpi.comDivergencia}
                icon={<AlertTriangle />}
                valueTone={kpi.comDivergencia > 0 ? 'critical' : 'default'}
              />
            </StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
          <Input placeholder="Buscar retirada, SKU ou responsável" value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[220px]" />
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FullWithdrawalStatus | 'all')}>
            <option value="all">Status</option>
            {(Object.keys(FULL_WITHDRAWAL_STATUS_LABEL) as FullWithdrawalStatus[]).map(s => (
              <option key={s} value={s}>{FULL_WITHDRAWAL_STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} aria-label="Período - de" />
          <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} aria-label="Período - até" />
          <Button variant="secondary" onClick={handleSync} className="ml-auto">
            <RefreshCw size={15} /> Sincronizar Mercado Livre
          </Button>
        </PanelSection>

        {syncNotice && (
          <PanelSection padding="sm" className="text-sm text-fg-subtle">{syncNotice}</PanelSection>
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
            {plans.length === 0
              ? 'Nenhuma retirada Full planejada ainda. Clique em "Planejar retirada Full" para começar.'
              : 'Nenhuma retirada encontrada para os filtros atuais.'}
          </PanelSection>
        )}

        {!loading && !loadError && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Plano IB</Th>
                  <Th>Retirada ML</Th>
                  <Th>SKUs</Th>
                  <Th>Unidades</Th>
                  <Th>Atualização</Th>
                  <Th>Etapa</Th>
                  <Th>Custo</Th>
                  <Th>Responsável</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <tbody>
                {filtered.map(p => {
                  const summary = itemSummary.get(p.id);
                  const responsible = p.createdBy ? (userNames.get(p.createdBy)?.name ?? userNames.get(p.createdBy)?.email ?? '—') : '—';
                  return (
                    <Tr key={p.id} className="cursor-pointer" onClick={() => onOpenPlan(p.id, p.status)}>
                      <Td className="font-medium">{p.code}</Td>
                      <Td>{p.mlReference ?? '—'}</Td>
                      <Td numeric>{summary?.skuCount ?? 0}</Td>
                      <Td numeric>{summary?.totalUnits ?? 0}</Td>
                      <Td>{new Date(p.updatedAt).toLocaleDateString('pt-BR')}</Td>
                      <Td><StageText status={p.status} /></Td>
                      <Td numeric>{p.cost != null ? p.cost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</Td>
                      <Td>{responsible}</Td>
                      <Td>
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); onOpenPlan(p.id, p.status); }}>
                          {actionLabel(p.status)}
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}

        <PanelSection padding="sm" className="text-caption">
          A confirmação da retirada é concluída no painel do Mercado Livre.
        </PanelSection>
      </Panel>
    </>
  );
}
