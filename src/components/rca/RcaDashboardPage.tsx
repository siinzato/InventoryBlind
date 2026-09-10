import { useEffect, useState, useCallback, useMemo } from 'react';
import { GitBranch, ListOrdered, AlertOctagon, Settings2, ClipboardList } from 'lucide-react';
import { Page,
  PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Stat, StatRow, StatCell,
  ListRow, SegmentedControl, Button, Badge, type StatProps, type SegmentedOption,
} from '../ui';
import {
  listRecords, getParetoSummary, getCauseBreakdown, getTrend, RcaFilters,
  getClassificationCoverage, getPendingClassificationQueue, getLegacyUnclassifiedDivergences,
  listCases, getCaseDivergenceCounts, getCauseTaxonomy, getOverdueActionsCount, getEffectivenessStats,
  listOpenActions, getSettings, type RcaTaxonomyCategory, type LegacyUnclassifiedItem, type OpenActionRow,
} from '../../lib/rcaService';
import { listTeamMembers } from '../../lib/tasks/taskService';
import {
  CAUSE_LABEL, type RcaDimension, type ParetoBucket, type DimensionBucket,
  groupByRecurrenceSignature, hasMultipleOperators,
} from '../../lib/rcaAlgorithm';
import type { RcaRecord, RcaCase, RcaSourceModule } from '../../lib/supabase';
import type { TeamMember } from '../../lib/tasks/types';
import { CauseBadge } from './CauseBadge';
import { ParetoChart } from './ParetoChart';
import { RcaFilterBar } from './RcaFilterBar';
import { RcaCasesTable } from './RcaCasesTable';
import { RcaCaseDetailPage } from './RcaCaseDetailPage';
import { RcaTaxonomyModal } from './RcaTaxonomyModal';
import { RcaClassificationModal, type PendingRcaItem } from './RcaClassificationModal';

interface RcaDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role: string;
}

const DIMENSIONS: SegmentedOption<RcaDimension>[] = [
  { value: 'operator', label: 'Operador' },
  { value: 'location', label: 'Endereço' },
  { value: 'sku', label: 'SKU' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'period', label: 'Período' },
];

type MainTab = 'visao_geral' | 'casos' | 'acoes' | 'taxonomia';
const MAIN_TABS: SegmentedOption<MainTab>[] = [
  { value: 'visao_geral', label: 'Visão geral' },
  { value: 'casos', label: 'Casos de RCA' },
  { value: 'acoes', label: 'Ações corretivas' },
  { value: 'taxonomia', label: 'Taxonomia' },
];

const COVERAGE_MIN_PCT = 30;

function TrendSparkline({ points }: { points: { period: string; count: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-fg-subtle">A tendência aparecerá após a classificação das primeiras ocorrências.</p>;
  const w = 600, h = 80;
  const max = Math.max(...points.map(p => p.count), 1);
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (p.count / max) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline points={coords} fill="none" className="stroke-accent" strokeWidth="2" />
    </svg>
  );
}

/** Dashboard central do módulo de Root Cause Analysis. Classificação inicial (leve, toda
 *  divergência) alimenta Pareto/tendência/cobertura em tempo real; escalonamento para Caso
 *  de RCA completo (rcaService.createRcaRecord → evaluateEscalation) só acontece quando os
 *  critérios do workspace são atingidos — severidade alta/crítica, recorrência, impacto
 *  financeiro, falha de controle ou escalonamento manual. */
export function RcaDashboardPage({ companyId, userId, userEmail, role }: RcaDashboardPageProps) {
  const canManage = role === 'owner' || role === 'admin' || role === 'manager';

  const [mainTab, setMainTab] = useState<MainTab>('visao_geral');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [taxonomyModalOpen, setTaxonomyModalOpen] = useState(false);
  const [manualClassifyItem, setManualClassifyItem] = useState<{ sourceModule: RcaSourceModule; item: PendingRcaItem } | null>(null);

  const [filters, setFilters] = useState<RcaFilters>({});
  const [records, setRecords] = useState<RcaRecord[]>([]);
  const [pareto, setPareto] = useState<ParetoBucket[]>([]);
  const [trend, setTrend] = useState<{ period: string; count: number }[]>([]);
  const [dimension, setDimension] = useState<RcaDimension>('operator');
  const [breakdown, setBreakdown] = useState<DimensionBucket[]>([]);
  const [taxonomy, setTaxonomy] = useState<RcaTaxonomyCategory[]>([]);

  const [coverage, setCoverage] = useState({ classified: 0, pending: 0, legacy: 0, totalClosed: 0, coveragePct: null as number | null });
  const [pendingQueue, setPendingQueue] = useState<RcaRecord[]>([]);
  const [legacyQueue, setLegacyQueue] = useState<LegacyUnclassifiedItem[]>([]);
  const [cases, setCases] = useState<RcaCase[]>([]);
  const [caseDivergenceCounts, setCaseDivergenceCounts] = useState<Map<string, number>>(new Map());
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [overdueActions, setOverdueActions] = useState(0);
  const [effectiveness, setEffectiveness] = useState({ verifiedEffective: 0, verifiedTotal: 0, pct: null as number | null });
  const [openActions, setOpenActions] = useState<OpenActionRow[]>([]);
  const [recurrenceWindowDays, setRecurrenceWindowDays] = useState(60);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listRecords(companyId, filters),
      getParetoSummary(companyId, filters),
      getTrend(companyId),
      getClassificationCoverage(companyId),
      getPendingClassificationQueue(companyId),
      getLegacyUnclassifiedDivergences(companyId),
      listCases(companyId),
      getCaseDivergenceCounts(companyId),
      listTeamMembers(companyId),
      getOverdueActionsCount(companyId),
      getEffectivenessStats(companyId),
      getCauseTaxonomy(companyId),
      getSettings(companyId),
    ]).then(([r, p, t, cov, pending, legacy, caseRows, caseCounts, memberRows, overdue, eff, tax, settings]) => {
      setRecords(r); setPareto(p); setTrend(t);
      setCoverage(cov); setPendingQueue(pending); setLegacyQueue(legacy);
      setCases(caseRows); setCaseDivergenceCounts(caseCounts); setMembers(memberRows);
      setOverdueActions(overdue); setEffectiveness(eff); setTaxonomy(tax);
      setRecurrenceWindowDays(settings.recurrence_window_days);
      setLoading(false);
    });
  }, [companyId, filters]);

  useEffect(load, [load]);

  useEffect(() => {
    getCauseBreakdown(companyId, dimension, filters).then(setBreakdown);
  }, [companyId, dimension, filters]);

  useEffect(() => {
    if (mainTab === 'acoes') listOpenActions(companyId).then(setOpenActions);
  }, [mainTab, companyId]);

  const causeOptions = useMemo(() => taxonomy.filter(c => c.isActive).map(c => ({ value: c.code, label: c.label })), [taxonomy]);

  const recurrenceGroups = useMemo(() => groupByRecurrenceSignature(records, recurrenceWindowDays), [records, recurrenceWindowDays]);
  const recurringCount = useMemo(() => Array.from(recurrenceGroups.values()).filter(g => g.length > 1).reduce((sum, g) => sum + g.length, 0), [recurrenceGroups]);
  const recurrencePct = records.length > 0 ? (recurringCount / records.length) * 100 : null;

  const inInvestigationCount = cases.filter(c => ['em_investigacao', 'causa_proposta', 'plano_em_execucao'].includes(c.status)).length;
  const notClassifiedCount = coverage.pending + coverage.legacy;

  const topCause = pareto[0] ? (CAUSE_LABEL[pareto[0].category] ?? pareto[0].category) : '—';

  const cards: StatProps[] = [
    { label: 'Não Classificadas', value: notClassifiedCount, icon: <ListOrdered />, context: 'resolvidas sem causa registrada' },
    { label: 'Em Investigação', value: inInvestigationCount, icon: <AlertOctagon />, context: 'casos com plano em andamento' },
    { label: 'Ações Vencidas', value: overdueActions, icon: <AlertOctagon />, context: 'prazo expirado, sem verificação', valueTone: overdueActions > 0 ? 'critical' : 'default' },
    { label: 'Recorrência', value: recurrencePct != null ? `${Math.round(recurrencePct)}%` : '—', icon: <GitBranch />, context: `em grupos recorrentes (${recurrenceWindowDays}d)` },
    { label: 'Eficácia Verificada', value: effectiveness.pct != null ? `${Math.round(effectiveness.pct)}%` : '—', context: 'eficazes ÷ já verificadas' },
  ];

  const weeklyFocus = useMemo(() => {
    const items: string[] = [];
    if (pareto[0] && pareto[0].pctOfTotal >= 20) items.push(`${topCause} concentra ${Math.round(pareto[0].pctOfTotal)}% das divergências classificadas.`);
    const topRecurrentGroup = Array.from(recurrenceGroups.entries()).sort((a, b) => b[1].length - a[1].length)[0];
    if (topRecurrentGroup && topRecurrentGroup[1].length >= 3) {
      const sample = topRecurrentGroup[1][0] as RcaRecord;
      const systemic = hasMultipleOperators(topRecurrentGroup[1] as RcaRecord[]);
      items.push(`Mesmo problema repetido ${topRecurrentGroup[1].length}x em ${sample.location ?? sample.sku ?? sample.process_area ?? 'contexto similar'}${systemic ? ' — padrão pode ser sistêmico' : ''}.`);
    }
    const highestImpactCase = [...cases].filter(c => c.financial_impact != null).sort((a, b) => (b.financial_impact ?? 0) - (a.financial_impact ?? 0))[0];
    if (highestImpactCase) items.push(`Caso RCA-${highestImpactCase.case_year}-${String(highestImpactCase.case_number).padStart(3, '0')} tem o maior impacto financeiro estimado.`);
    if (overdueActions > 0) items.push(`${overdueActions} ação(ões) corretiva(s)/preventiva(s) com prazo vencido.`);
    return items.slice(0, 4);
  }, [pareto, topCause, recurrenceGroups, cases, overdueActions]);

  const reload = () => load();

  const handleClassifyPending = (record: RcaRecord) => {
    setManualClassifyItem({
      sourceModule: record.source_module,
      item: {
        sourceItemId: record.source_item_id, productId: record.product_id, sku: record.sku, productName: record.product_name,
        location: record.location, operatorUserId: record.operator_user_id, operatorName: record.operator_name,
        supplierName: record.supplier_name, supplierCnpj: record.supplier_cnpj, divergenceQty: record.divergence_qty, occurredAt: record.occurred_at,
      },
    });
  };
  const handleClassifyLegacy = (legacyItem: LegacyUnclassifiedItem) => {
    setManualClassifyItem({
      sourceModule: legacyItem.sourceModule,
      item: {
        sourceItemId: legacyItem.sourceItemId, productId: null, sku: legacyItem.sku, productName: legacyItem.productName,
        location: legacyItem.location, operatorUserId: null, operatorName: null, divergenceQty: legacyItem.divergenceQty, occurredAt: legacyItem.occurredAt,
      },
    });
  };

  if (selectedCaseId) {
    return (
      <RcaCaseDetailPage
        caseId={selectedCaseId} companyId={companyId} userId={userId} userEmail={userEmail} role={role}
        onBack={() => { setSelectedCaseId(null); reload(); }}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="Root Cause Analysis"
        eyebrow="MELHORIA CONTÍNUA"
        description="Transforme divergências em causas tratáveis, ações corretivas e prevenção de recorrência."
        actions={
          <div className="flex gap-2">
            {canManage && (
              <Button variant="secondary" onClick={() => setTaxonomyModalOpen(true)}><Settings2 size={14} /> Configurar taxonomia</Button>
            )}
            {pendingQueue[0] && (
              <Button onClick={() => handleClassifyPending(pendingQueue[0])}><ClipboardList size={14} /> Classificar divergências</Button>
            )}
          </div>
        }
      />

      <SegmentedControl
        label="Seção de Root Cause Analysis"
        options={canManage ? MAIN_TABS : MAIN_TABS.filter(t => t.value !== 'taxonomia')}
        value={mainTab}
        onChange={setMainTab}
      />

      {loading ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Root Cause Analysis...</PanelSection></Panel>
      ) : mainTab === 'taxonomia' ? (
        <Panel>
          <PanelSection padding="md" className="space-y-2">
            <p className="text-sm text-fg-muted">Gerencie as categorias e subcausas usadas na classificação de divergências desta empresa.</p>
            <Button onClick={() => setTaxonomyModalOpen(true)}><Settings2 size={14} /> Abrir configuração</Button>
          </PanelSection>
        </Panel>
      ) : mainTab === 'acoes' ? (
        <Panel>
          <PanelSection padding="sm"><p className="text-section">Ações Corretivas e Preventivas</p></PanelSection>
          <div className="overflow-x-auto">
            <Table>
              <Thead><Tr><Th>Caso</Th><Th>Tipo</Th><Th>Critério de eficácia</Th><Th>Resultado</Th><Th /></Tr></Thead>
              <tbody>
                {openActions.length === 0 && <Tr><Td colSpan={5} className="text-center text-fg-subtle">Nenhuma ação em aberto.</Td></Tr>}
                {openActions.map(({ action, caseCode, caseId }) => (
                  <Tr key={action.id}>
                    <Td>{caseCode}</Td>
                    <Td>{action.action_type}</Td>
                    <Td className="max-w-xs truncate">{action.effectiveness_criteria ?? '—'}</Td>
                    <Td>{action.verification_result ? <Badge variant={action.verification_result === 'eficaz' ? 'success' : 'danger'}>{action.verification_result}</Badge> : '—'}</Td>
                    <Td><Button size="sm" variant="secondary" onClick={() => setSelectedCaseId(caseId)}>Abrir caso</Button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Panel>
      ) : mainTab === 'casos' ? (
        <RcaCasesTable
          cases={cases} caseDivergenceCounts={caseDivergenceCounts} members={members}
          pendingQueue={pendingQueue} legacyQueue={legacyQueue}
          onOpenCase={setSelectedCaseId} onClassifyPending={handleClassifyPending} onClassifyLegacy={handleClassifyLegacy}
        />
      ) : (
        <>
          <Panel>
            <PanelSection padding="md">
              <RcaFilterBar filters={filters} onChange={setFilters} causeOptions={causeOptions} />
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <StatRow>
                {cards.map(card => (
                  <StatCell key={card.label}>
                    <Stat {...card} />
                  </StatCell>
                ))}
              </StatRow>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-3">Pareto de Causas (80/20)</p>
              {coverage.coveragePct != null && coverage.coveragePct < COVERAGE_MIN_PCT ? (
                <p className="text-xs text-fg-subtle">Cobertura de classificação ainda baixa ({Math.round(coverage.coveragePct)}%) — Pareto fica mais confiável conforme mais divergências forem classificadas.</p>
              ) : (
                <ParetoChart buckets={pareto} onSelectCategory={category => setFilters(f => ({ ...f, causeCategory: category }))} />
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Cobertura da Classificação</p>
              <div className="flex items-center gap-4">
                <p className="text-2xl font-display font-semibold tabular-nums">{coverage.coveragePct != null ? `${Math.round(coverage.coveragePct)}%` : '—'}</p>
                <p className="text-xs text-fg-subtle">{coverage.classified} de {coverage.totalClosed} divergências encerradas classificadas</p>
              </div>
              {notClassifiedCount > 0 && (
                <button type="button" className="text-xs text-accent hover:underline mt-1" onClick={() => setMainTab('casos')}>
                  Revisar {notClassifiedCount} pendências
                </button>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-2">Tendência</p>
              <TrendSparkline points={trend} />
            </PanelSection>
          </Panel>

          {weeklyFocus.length > 0 && (
            <Panel>
              <PanelSection padding="md" className="space-y-1.5">
                <p className="text-section mb-1">Foco da Semana</p>
                {weeklyFocus.map((line, i) => <p key={i} className="text-sm text-fg-muted">{line}</p>)}
              </PanelSection>
            </Panel>
          )}

          <Panel>
            <PanelSection padding="md" className="space-y-3">
              <div>
                <p className="text-section mb-2">Causas por</p>
                <SegmentedControl
                  label="Dimensão da quebra de causas"
                  options={DIMENSIONS}
                  value={dimension}
                  onChange={setDimension}
                />
              </div>
              <div>
                {breakdown.length === 0 ? (
                  <p className="text-xs text-fg-subtle">Sem dados para essa quebra ainda.</p>
                ) : (
                  breakdown.slice(0, 15).map(b => (
                    <ListRow key={b.key} value={b.count}>
                      <p className="truncate text-sm text-fg">{b.label}</p>
                    </ListRow>
                  ))
                )}
              </div>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="sm">
              <p className="text-section">Classificações Recentes ({records.length})</p>
            </PanelSection>
            <div className="overflow-x-auto max-h-96">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Data</Th>
                    <Th>SKU</Th>
                    <Th>Local</Th>
                    <Th>Qtd.</Th>
                    <Th>Causa</Th>
                    <Th>Operador</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {records.slice(0, 100).map(r => (
                    <Tr key={r.id}>
                      <Td>{new Date(r.occurred_at).toLocaleDateString('pt-BR')}</Td>
                      <Td numeric>{r.sku ?? '—'}</Td>
                      <Td numeric>{r.location ?? '—'}</Td>
                      <Td numeric className={r.divergence_qty < 0 ? 'text-red-500' : 'text-amber-500'}>{r.divergence_qty}</Td>
                      <Td>{r.cause_category ? <CauseBadge cause={r.cause_category} customLabel={r.custom_cause_label} /> : '—'}</Td>
                      <Td>{r.operator_name ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        </>
      )}

      <RcaTaxonomyModal open={taxonomyModalOpen} onClose={() => { setTaxonomyModalOpen(false); reload(); }} companyId={companyId} userId={userId} userEmail={userEmail} />

      {manualClassifyItem && (
        <RcaClassificationModal
          open={true}
          sourceModule={manualClassifyItem.sourceModule}
          items={[manualClassifyItem.item]}
          companyId={companyId}
          userId={userId}
          userEmail={userEmail}
          onDone={() => { setManualClassifyItem(null); reload(); }}
        />
      )}
    </Page>
  );
}
