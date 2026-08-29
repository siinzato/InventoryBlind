// Rankings Complete Page Component

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  X,
  Search,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Users,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UserProductivityStats } from '../lib/supabase';
import { downloadFile } from '../lib/productImportUtils';
import { resolvePeriodRange, type ReportPeriod } from '../lib/productivityService';
import {
  MIN_RANKING_SAMPLE, SITUACAO_LABEL, computeSituacao, pickDestaquesConsistentes,
  compareByQualityFirst, groupEntityPeriodStats, dailyStatsByEntity, summarizeTrend,
  buildAttentionRows, type EntityPeriodStat, type RankingCountRecord, type Situacao,
  type TrendSummary,
} from '../lib/rankings/rankingsCalc';
import {
  Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button,
  Input, Select, Stat, StatRow, StatCell,
} from './ui';

interface BrandRow {
  id: string;
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  status: string;
}

interface TopVenda {
  id: string;
  produto: string;
  sku: string;
  vendas: string;
  order_index: number;
}

interface RankingsPageProps {
  onBack: () => void;
  companyId: string;
  brandsData: BrandRow[];
  topVendas: TopVenda[];
  operatorStats: UserProductivityStats[];
}

type EntityTab = 'linhas' | 'operadores' | 'produtos';
type SortDir = 'asc' | 'desc';
interface SortState { field: string; dir: SortDir; }

const ACCURACY_TARGET = 95;
const PAGE_SIZE = 20;
const EMPTY_TREND: TrendSummary = { points: [], totalSkus: 0, varianceP: null, avgAccuracy: null };

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
];

const ENTITY_TABS: { value: EntityTab; label: string }[] = [
  { value: 'linhas', label: 'Linhas' },
  { value: 'operadores', label: 'Operadores' },
  { value: 'produtos', label: 'Produtos' },
];

function formatRelativeUpdate(atMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - atMs) / 60000);
  if (minutes < 1) return 'Atualizado agora mesmo';
  if (minutes === 1) return 'Atualizado há 1 min';
  if (minutes < 60) return `Atualizado há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Atualizado há ${hours}h`;
}

/** Chip de situação — única fonte de cor semântica da página: vermelho só para
 *  risco real, azul IB para a condição de referência, neutro para o resto. O
 *  ícone no risco garante que a leitura não dependa só da cor. */
function SituacaoBadge({ situacao }: { situacao: Situacao }) {
  if (situacao === 'risco') {
    return (
      <Badge variant="danger" className="inline-flex items-center gap-1">
        <AlertTriangle size={11} />{SITUACAO_LABEL[situacao]}
      </Badge>
    );
  }
  if (situacao === 'referencia') return <Badge variant="accent">{SITUACAO_LABEL[situacao]}</Badge>;
  return <Badge variant="neutral">{SITUACAO_LABEL[situacao]}</Badge>;
}

/** Sparkline mínima — só desenhada quando há pelo menos 2 dias de histórico
 *  real; caso contrário o chamador mostra "Dados insuficientes" em texto. */
function Sparkline({ points, critical }: { points: { accuracy: number }[]; critical: boolean }) {
  const w = 64;
  const h = 20;
  const min = Math.min(...points.map(p => p.accuracy));
  const max = Math.max(...points.map(p => p.accuracy));
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p.accuracy - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible flex-shrink-0">
      <path d={d} fill="none" strokeWidth={1.5} className={critical ? 'stroke-red-500' : 'stroke-accent'} />
    </svg>
  );
}

/** Dispersão ritmo × acuracidade — SVG simples, sem biblioteca. Cor por
 *  condição (abaixo/dentro da meta), nunca por identidade do operador; a linha
 *  de meta é a única referência auxiliar (sem meta oficial de ritmo, o eixo X
 *  não ganha uma segunda linha). */
function ProductivityScatter({ data, meta }: { data: EntityPeriodStat[]; meta: number }) {
  const points = data.filter(d => d.ritmoPerHour !== null && d.accuracy !== null && d.skus > 0);
  if (points.length === 0) {
    return <p className="text-sm text-fg-subtle py-10 text-center">Sem dados de ritmo e acuracidade no período selecionado.</p>;
  }
  const W = 480;
  const H = 260;
  const PAD = 40;
  const maxRitmo = Math.max(1, ...points.map(p => p.ritmoPerHour ?? 0));
  const minAcc = Math.min(50, ...points.map(p => p.accuracy ?? 100));
  const x = (v: number) => PAD + (v / maxRitmo) * (W - PAD * 1.4);
  const y = (v: number) => H - PAD - ((Math.max(minAcc, v) - minAcc) / (100 - minAcc)) * (H - PAD * 1.4);
  const metaY = y(meta);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64" role="img" aria-label="Produtividade por acuracidade, por operador">
      <line x1={PAD} y1={PAD / 2} x2={PAD} y2={H - PAD} strokeWidth={1} className="stroke-edge" />
      <line x1={PAD} y1={H - PAD} x2={W - PAD / 2} y2={H - PAD} strokeWidth={1} className="stroke-edge" />
      <line x1={PAD} y1={metaY} x2={W - PAD / 2} y2={metaY} strokeDasharray="4 3" strokeWidth={1} className="stroke-fg-subtle" />
      <text x={W - PAD / 2} y={metaY - 4} textAnchor="end" className="fill-fg-subtle text-[10px]">Meta {meta}%</text>
      {points.map(p => (
        <g key={p.id}>
          <circle cx={x(p.ritmoPerHour ?? 0)} cy={y(p.accuracy ?? 0)} r={4} className={(p.accuracy ?? 0) < meta ? 'fill-red-500' : 'fill-accent'} />
          <text x={x(p.ritmoPerHour ?? 0)} y={y(p.accuracy ?? 0) - 7} textAnchor="middle" className="fill-fg-muted text-[10px]">{p.name}</text>
        </g>
      ))}
      <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-fg-subtle text-[10px]">Ritmo (SKUs/h)</text>
    </svg>
  );
}

function Pagination({ page, totalPages, setPage, currentCount }: {
  page: number; totalPages: number; setPage: (fn: (p: number) => number) => void; currentCount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-edge/60 px-4 py-3">
      <p className="text-caption tabular-nums">
        Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, currentCount)} de {currentCount}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Anterior</Button>
        <span className="px-3 text-sm tabular-nums text-fg-muted">{page} / {totalPages}</span>
        <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Próximo</Button>
      </div>
    </div>
  );
}

interface LinhaRow extends EntityPeriodStat {
  volume: number;
  progress: number;
  situacao: Situacao;
  trend: TrendSummary;
}

interface OperadorRow extends EntityPeriodStat {
  situacao: Situacao;
  trend: TrendSummary;
  elegivel: boolean;
}

export const RankingsPage: React.FC<RankingsPageProps> = ({ onBack, companyId, brandsData, topVendas, operatorStats }) => {
  const [activeTab, setActiveTab] = useState<EntityTab>('linhas');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: 'accuracy', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<ReportPeriod>('30d');
  const [operatorId, setOperatorId] = useState<string>('all');
  const [records, setRecords] = useState<RankingCountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const [expandedBrandId, setExpandedBrandId] = useState<string | null>(null);

  const handleTabChange = (tab: EntityTab) => {
    setActiveTab(tab);
    setSearch('');
    setSort({ field: 'accuracy', dir: 'desc' });
    setPage(1);
    setExpandedBrandId(null);
  };

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };

  const handleSort = (field: string) => {
    setSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' });
    setPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.field !== field) return <ChevronUp size={14} className="text-fg-subtle" />;
    return sort.dir === 'asc' ? <ChevronUp size={14} className="text-accent" /> : <ChevronDown size={14} className="text-accent" />;
  };

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Uma única busca (todo o histórico da empresa em inventory_count_records) —
  // alimenta o ritmo/acuracidade por linha (lifetime, preserva o cálculo
  // oficial de computeGlobalStats), o desempenho por operador no período
  // selecionado e a tendência fixa dos últimos 7 dias, sem refazer a consulta
  // a cada troca de filtro.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('inventory_count_records')
        .select('brand_id, created_by, created_at, skus_contados, divergencias_reais, duration_seconds')
        .eq('company_id', companyId);
      if (cancelled) return;
      if (!error) setRecords((data ?? []) as RankingCountRecord[]);
      setLastLoadedAt(Date.now());
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  const { from, to } = useMemo(() => resolvePeriodRange(period), [period]);
  const sevenDay = useMemo(() => resolvePeriodRange('7d'), []);
  const periodRecords = useMemo(() => records.filter(r => r.created_at >= from && r.created_at <= to), [records, from, to]);
  const trend7Records = useMemo(
    () => records.filter(r => r.created_at >= sevenDay.from && r.created_at <= sevenDay.to),
    [records, sevenDay],
  );

  // ---- LINHAS: acuracidade/divergências/progresso continuam vindo de
  // brandsData (oficial, lifetime) — só o ritmo (SKUs/h) e a tendência de 7
  // dias vêm da consulta nova, porque não existiam antes. ----
  const nameByBrandId = useMemo(() => new Map(brandsData.map(b => [b.id, b.brand])), [brandsData]);
  const brandRitmoStats = useMemo(() => groupEntityPeriodStats(records, r => r.brand_id, nameByBrandId), [records, nameByBrandId]);
  const brandRitmoById = useMemo(() => new Map(brandRitmoStats.map(s => [s.id, s.ritmoPerHour])), [brandRitmoStats]);
  const brandDailyMap = useMemo(() => dailyStatsByEntity(trend7Records, r => r.brand_id), [trend7Records]);
  const brandTrendById = useMemo(() => {
    const m = new Map<string, TrendSummary>();
    brandsData.forEach(b => m.set(b.id, summarizeTrend(brandDailyMap.get(b.id))));
    return m;
  }, [brandsData, brandDailyMap]);

  const linhaRows: LinhaRow[] = useMemo(() => brandsData.map(b => {
    const divergenciasPor100 = b.doneSku > 0 ? (b.divergences / b.doneSku) * 100 : null;
    return {
      id: b.id,
      name: b.brand,
      skus: b.doneSku,
      ritmoPerHour: brandRitmoById.get(b.id) ?? null,
      accuracy: b.accuracy,
      divergencias: b.divergences,
      divergenciasPor100,
      volume: b.totalSku,
      progress: b.progress,
      situacao: computeSituacao(b.doneSku, b.accuracy, ACCURACY_TARGET),
      trend: brandTrendById.get(b.id) ?? EMPTY_TREND,
    };
  }), [brandsData, brandRitmoById, brandTrendById]);

  const destaques = useMemo(() => pickDestaquesConsistentes(linhaRows, ACCURACY_TARGET), [linhaRows]);
  const atencao = useMemo(() => buildAttentionRows(linhaRows, brandTrendById, ACCURACY_TARGET), [linhaRows, brandTrendById]);

  const linhasFiltered = useMemo(() => {
    let data = linhaRows;
    if (search) data = data.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const sorted = [...data];
    switch (sort.field) {
      case 'brand': sorted.sort((a, b) => dir * a.name.localeCompare(b.name)); break;
      case 'volume': sorted.sort((a, b) => dir * (a.volume - b.volume)); break;
      case 'progress': sorted.sort((a, b) => dir * (a.progress - b.progress)); break;
      case 'divergenciasPor100': sorted.sort((a, b) => dir * ((a.divergenciasPor100 ?? -1) - (b.divergenciasPor100 ?? -1))); break;
      case 'ritmo': sorted.sort((a, b) => dir * ((a.ritmoPerHour ?? -1) - (b.ritmoPerHour ?? -1))); break;
      default: sorted.sort((a, b) => dir * ((a.accuracy ?? -1) - (b.accuracy ?? -1)));
    }
    return sorted;
  }, [linhaRows, search, sort]);

  // ---- OPERADORES: SKUs/acuracidade/divergências agregados no período
  // selecionado (elegibilidade explicitamente "no período selecionado"). ----
  const nameByUserId = useMemo(() => new Map(operatorStats.map(o => [o.user_id, o.name])), [operatorStats]);
  const rawOperatorPeriodStats = useMemo(
    () => groupEntityPeriodStats(periodRecords, r => r.created_by, nameByUserId),
    [periodRecords, nameByUserId],
  );
  const rawOperatorById = useMemo(() => new Map(rawOperatorPeriodStats.map(s => [s.id, s])), [rawOperatorPeriodStats]);
  const activeOperators = useMemo(() => operatorStats.filter(o => o.contagens > 0), [operatorStats]);
  const allOperatorPeriodStats: EntityPeriodStat[] = useMemo(() => activeOperators.map(o =>
    rawOperatorById.get(o.user_id) ?? {
      id: o.user_id, name: o.name ?? '—', skus: 0, ritmoPerHour: null, accuracy: null, divergencias: 0, divergenciasPor100: null,
    }), [activeOperators, rawOperatorById]);

  const operatorDailyMap = useMemo(() => dailyStatsByEntity(trend7Records, r => r.created_by), [trend7Records]);
  const operatorTrendById = useMemo(() => {
    const m = new Map<string, TrendSummary>();
    allOperatorPeriodStats.forEach(o => m.set(o.id, summarizeTrend(operatorDailyMap.get(o.id))));
    return m;
  }, [allOperatorPeriodStats, operatorDailyMap]);

  const operatorScope = useMemo(
    () => operatorId === 'all' ? allOperatorPeriodStats : allOperatorPeriodStats.filter(o => o.id === operatorId),
    [allOperatorPeriodStats, operatorId],
  );

  const operadoresElegiveis = useMemo(() => allOperatorPeriodStats.filter(o => o.skus >= MIN_RANKING_SAMPLE), [allOperatorPeriodStats]);
  const maiorAcuracidade = useMemo(() => {
    const list = operadoresElegiveis.filter(o => o.accuracy !== null).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
    return list[0] ?? null;
  }, [operadoresElegiveis]);
  const melhorRitmoComQualidade = useMemo(() => {
    const list = operadoresElegiveis
      .filter(o => o.accuracy !== null && o.accuracy >= ACCURACY_TARGET && o.ritmoPerHour !== null)
      .sort((a, b) => (b.ritmoPerHour ?? 0) - (a.ritmoPerHour ?? 0));
    return list[0] ?? null;
  }, [operadoresElegiveis]);
  const maiorRiscoRetrabalho = useMemo(() => {
    const list = operadoresElegiveis.filter(o => o.divergenciasPor100 !== null).sort((a, b) => (b.divergenciasPor100 ?? 0) - (a.divergenciasPor100 ?? 0));
    return list[0] ?? null;
  }, [operadoresElegiveis]);

  const operadorRows: OperadorRow[] = useMemo(() => operatorScope.map(o => ({
    ...o,
    situacao: computeSituacao(o.skus, o.accuracy, ACCURACY_TARGET),
    trend: operatorTrendById.get(o.id) ?? EMPTY_TREND,
    elegivel: o.skus >= MIN_RANKING_SAMPLE,
  })), [operatorScope, operatorTrendById]);

  const operadoresFiltered = useMemo(() => {
    let data = operadorRows;
    if (search) data = data.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
    return [...data].sort((a, b) => compareByQualityFirst(a, b, ACCURACY_TARGET));
  }, [operadorRows, search]);

  // ---- PRODUTOS: dados de vendas já existentes, mesmo padrão visual. ----
  const produtosFiltered = useMemo(() => {
    let data = topVendas.map(v => ({ ...v, vendasNum: parseInt(String(v.vendas).replace(/\D/g, '') || '0') }));
    if (search) {
      data = data.filter(r => r.produto.toLowerCase().includes(search.toLowerCase()) || r.sku.toLowerCase().includes(search.toLowerCase()));
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.field === 'produto') data.sort((a, b) => dir * a.produto.localeCompare(b.produto));
    else if (sort.field === 'vendas') data.sort((a, b) => dir * (a.vendasNum - b.vendasNum));
    return data;
  }, [topVendas, search, sort]);

  const currentData = activeTab === 'linhas' ? linhasFiltered : activeTab === 'operadores' ? operadoresFiltered : produtosFiltered;
  const totalPages = Math.ceil(currentData.length / PAGE_SIZE);
  const pagedData = currentData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleExport = () => {
    let rows: string[] = [];
    let header = '';
    if (activeTab === 'linhas') {
      header = 'Linha/Marca;Volume;Progresso;Acuracidade;Divergencias por 100;Situacao';
      rows = linhasFiltered.map(r =>
        `${r.name};${r.volume};${r.progress.toFixed(1)}%;${r.accuracy !== null ? r.accuracy.toFixed(1) + '%' : ''};${r.divergenciasPor100 !== null ? r.divergenciasPor100.toFixed(1) : ''};${SITUACAO_LABEL[r.situacao]}`);
    } else if (activeTab === 'operadores') {
      header = 'Operador;SKUs;Ritmo (SKUs por h);Acuracidade;Divergencias por 100;Elegibilidade;Situacao';
      rows = operadoresFiltered.map(r =>
        `${r.name};${r.skus};${r.ritmoPerHour !== null ? r.ritmoPerHour.toFixed(1) : ''};${r.accuracy !== null ? r.accuracy.toFixed(1) + '%' : ''};${r.divergenciasPor100 !== null ? r.divergenciasPor100.toFixed(1) : ''};${r.elegivel ? 'Elegivel' : 'Nao elegivel'};${SITUACAO_LABEL[r.situacao]}`);
    } else {
      header = 'Produto;SKU;Vendas';
      rows = produtosFiltered.map(r => `${r.produto};${r.sku};${r.vendas}`);
    }
    const content = [header, ...rows].join('\n');
    downloadFile(content, `ranking-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="sticky top-0 z-50 border-b border-edge/70 bg-surface-2 text-fg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Voltar ao Dashboard</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleExport}>
              <Download size={16} />
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
            <button
              onClick={onBack}
              className="rounded-control p-2 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
              title="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <Page width="wide">
        <PageHeader
          eyebrow="Desempenho"
          title="Rankings"
          description="Comparação operacional sem premiar velocidade acima da qualidade."
        />

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-fg-muted px-3 py-2 rounded-control border border-edge bg-surface-2">
            Inventário atual
          </span>
          <Select value={period} onChange={e => setPeriod(e.target.value as ReportPeriod)}>
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {activeTab === 'operadores' && (
            <Select value={operatorId} onChange={e => setOperatorId(e.target.value)}>
              <option value="all">Todos os operadores</option>
              {activeOperators.map(o => <option key={o.user_id} value={o.user_id}>{o.name ?? 'Sem nome'}</option>)}
            </Select>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-fg-subtle">
            {loading ? <RefreshCw size={12} className="animate-spin" /> : null}
            {formatRelativeUpdate(lastLoadedAt, nowTick)}
          </span>
        </div>

        <div className="flex gap-5 border-b border-edge overflow-x-auto">
          {ENTITY_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              className={`pb-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === t.value ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'linhas' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Panel>
                <PanelSection padding="sm"><h3 className="text-title">Destaques Consistentes</h3></PanelSection>
                <PanelSection className="space-y-3">
                  {destaques.length === 0 ? (
                    <p className="text-sm text-fg-subtle py-4 text-center">Nenhuma linha atingiu os critérios de destaque no período.</p>
                  ) : destaques.map((d, i) => (
                    <div key={d.id} className="flex items-center gap-3">
                      <span className="w-5 text-xs tabular-nums text-fg-subtle">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{d.name}</p>
                        <p className="text-xs text-fg-subtle">
                          {d.ritmoPerHour !== null ? `${d.ritmoPerHour.toFixed(1)} SKUs/h · ` : ''}{d.skus} SKUs
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-fg tabular-nums">{d.accuracy?.toFixed(1)}%</span>
                    </div>
                  ))}
                </PanelSection>
              </Panel>

              <Panel>
                <PanelSection padding="sm"><h3 className="text-title">Atenção Necessária</h3></PanelSection>
                <PanelSection className="space-y-3">
                  {atencao.length === 0 ? (
                    <p className="text-sm text-fg-subtle py-4 text-center">Nenhum risco identificado no período.</p>
                  ) : atencao.map(a => (
                    <div key={a.id} className="flex items-start gap-2 pl-3 border-l-2 border-red-500">
                      <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg truncate">{a.title}</p>
                        <p className="text-xs text-red-600 dark:text-red-400">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </PanelSection>
              </Panel>
            </div>

            <Panel>
              <PanelSection padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-subtle whitespace-nowrap">Ordenar por:</span>
                  <Select value={sort.field || 'accuracy'} onChange={e => { setSort({ field: e.target.value, dir: 'desc' }); setPage(1); }}>
                    <option value="accuracy">Acuracidade</option>
                    <option value="volume">Volume</option>
                    <option value="progress">Progresso</option>
                    <option value="divergenciasPor100">Divergências por 100</option>
                    <option value="ritmo">Ritmo</option>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Input icon={<Search />} placeholder="Buscar linha ou marca" aria-label="Buscar linha ou marca" value={search} onChange={e => handleSearch(e.target.value)} className="sm:w-64" />
                  <span className="whitespace-nowrap text-caption tabular-nums">{linhasFiltered.length} registro{linhasFiltered.length !== 1 ? 's' : ''}</span>
                </div>
              </PanelSection>

              <div className="overflow-x-auto">
                <Table className="whitespace-nowrap">
                  <Thead>
                    <Tr>
                      <Th className="cursor-pointer select-none" onClick={() => handleSort('brand')}><span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span></Th>
                      <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('volume')}><span className="flex items-center justify-end gap-1">Volume <SortIcon field="volume" /></span></Th>
                      <Th className="text-center cursor-pointer select-none" onClick={() => handleSort('progress')}><span className="flex items-center justify-center gap-1">Progresso <SortIcon field="progress" /></span></Th>
                      <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('accuracy')}><span className="flex items-center justify-end gap-1">Acuracidade <SortIcon field="accuracy" /></span></Th>
                      <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('ritmo')}><span className="flex items-center justify-end gap-1">Ritmo <SortIcon field="ritmo" /></span></Th>
                      <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('divergenciasPor100')}><span className="flex items-center justify-end gap-1">Diverg./100 <SortIcon field="divergenciasPor100" /></span></Th>
                      <Th className="text-center">Tendência 7d</Th>
                      <Th className="text-center">Situação</Th>
                      <Th className="w-8" />
                    </Tr>
                  </Thead>
                  <tbody>
                    {pagedData.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-fg-subtle text-sm">Nenhuma linha encontrada.</td></tr>
                    ) : (pagedData as typeof linhasFiltered).map(row => (
                      <React.Fragment key={row.id}>
                        <Tr>
                          <Td className="font-medium">{row.name}</Td>
                          <Td numeric className="text-fg-muted">{row.volume}</Td>
                          <Td>
                            <div className="flex items-center gap-2 justify-center">
                              <div className="h-1.5 w-20 rounded-full bg-surface-3">
                                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, row.progress)}%` }} />
                              </div>
                              <span className="w-12 text-right font-mono text-xs tabular-nums text-fg-muted">{row.progress.toFixed(1)}%</span>
                            </div>
                          </Td>
                          <Td numeric>
                            {row.accuracy !== null
                              ? <span className={`font-semibold ${row.situacao === 'risco' ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{row.accuracy.toFixed(1)}%</span>
                              : <span className="text-fg-subtle">—</span>}
                          </Td>
                          <Td numeric className="text-fg-muted">{row.ritmoPerHour !== null ? `${row.ritmoPerHour.toFixed(1)}/h` : '—'}</Td>
                          <Td numeric>
                            {row.divergenciasPor100 !== null
                              ? <span className={row.situacao === 'risco' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-fg-muted'}>{row.divergenciasPor100.toFixed(1)}</span>
                              : <span className="text-fg-subtle">—</span>}
                          </Td>
                          <Td className="text-center">
                            {row.trend.points.length >= 2
                              ? <span className="inline-flex justify-center"><Sparkline points={row.trend.points} critical={row.situacao === 'risco'} /></span>
                              : <span className="text-xs text-fg-subtle">—</span>}
                          </Td>
                          <Td className="text-center"><SituacaoBadge situacao={row.situacao} /></Td>
                          <Td className="text-center">
                            {row.trend.points.length > 0 && (
                              <button
                                onClick={() => setExpandedBrandId(expandedBrandId === row.id ? null : row.id)}
                                className="text-fg-subtle hover:text-fg"
                                aria-label={`Expandir detalhes de ${row.name}`}
                              >
                                <ChevronRight size={14} className={`transition-transform ${expandedBrandId === row.id ? 'rotate-90' : ''}`} />
                              </button>
                            )}
                          </Td>
                        </Tr>
                        {expandedBrandId === row.id && row.trend.points.length > 0 && (
                          <tr className="border-b border-edge/60">
                            <td colSpan={9} className="px-4 py-3 bg-surface-2">
                              <p className="text-xs font-medium text-fg-subtle mb-1.5">Acuracidade diária — últimos 7 dias</p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                                {row.trend.points.map(p => (
                                  <span key={p.dateISO}>{p.dateISO.slice(8, 10)}/{p.dateISO.slice(5, 7)}: {p.accuracy.toFixed(1)}%</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </Table>
              </div>

              {totalPages > 1 && <Pagination page={page} totalPages={totalPages} setPage={setPage} currentCount={currentData.length} />}
              <PanelSection padding="sm"><p className="text-caption">Comparável após {MIN_RANKING_SAMPLE} SKUs contabilizados.</p></PanelSection>
            </Panel>
          </>
        )}

        {activeTab === 'operadores' && (
          <>
            <Panel>
              <PanelSection padding="lg">
                <StatRow>
                  <StatCell>
                    <Stat
                      label="Operadores Elegíveis"
                      value={`${operadoresElegiveis.length} de ${allOperatorPeriodStats.length}`}
                      context={`Mínimo de ${MIN_RANKING_SAMPLE} SKUs`}
                      icon={<Users />}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Maior Acuracidade"
                      value={maiorAcuracidade ? `${maiorAcuracidade.accuracy?.toFixed(1)}%` : '—'}
                      context={maiorAcuracidade ? `${maiorAcuracidade.name} · ${maiorAcuracidade.skus} SKUs` : 'Nenhum operador elegível'}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Melhor Ritmo com Qualidade"
                      value={melhorRitmoComQualidade ? `${melhorRitmoComQualidade.ritmoPerHour?.toFixed(1)} SKUs/h` : '—'}
                      context={melhorRitmoComQualidade ? `${melhorRitmoComQualidade.name} · ${melhorRitmoComQualidade.accuracy?.toFixed(1)}%` : 'Nenhum operador elegível'}
                    />
                  </StatCell>
                  <StatCell>
                    <Stat
                      label="Maior Risco de Retrabalho"
                      value={maiorRiscoRetrabalho?.name ?? '—'}
                      context={maiorRiscoRetrabalho ? `${maiorRiscoRetrabalho.divergencias} divergências` : 'Nenhum operador elegível'}
                      valueTone={maiorRiscoRetrabalho ? 'critical' : 'default'}
                    />
                  </StatCell>
                </StatRow>
              </PanelSection>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <Panel>
                <PanelSection padding="sm"><h3 className="text-title">Produtividade × Acuracidade</h3></PanelSection>
                <PanelSection><ProductivityScatter data={operatorScope} meta={ACCURACY_TARGET} /></PanelSection>
              </Panel>

              <Panel>
                <PanelSection padding="sm"><h3 className="text-title">Consistência nos Últimos 7 Dias</h3></PanelSection>
                <div className="overflow-x-auto">
                  <Table className="whitespace-nowrap">
                    <Thead>
                      <Tr>
                        <Th>Operador</Th>
                        <Th className="text-right">Acuracidade</Th>
                        <Th className="text-right">Variação</Th>
                        <Th className="text-right">Amostra</Th>
                        <Th className="text-center">7 dias</Th>
                      </Tr>
                    </Thead>
                    <tbody>
                      {operatorScope.filter(o => o.skus > 0).length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-6 text-center text-fg-subtle text-sm">Nenhuma contagem nos últimos 7 dias.</td></tr>
                      ) : operatorScope.filter(o => o.skus > 0).map(o => {
                        const trend = operatorTrendById.get(o.id) ?? EMPTY_TREND;
                        return (
                          <Tr key={o.id}>
                            <Td className="font-medium">{o.name}</Td>
                            <Td numeric>{trend.avgAccuracy !== null ? `${trend.avgAccuracy.toFixed(1)}%` : '—'}</Td>
                            <Td numeric>{trend.varianceP !== null ? `${trend.varianceP >= 0 ? '+' : ''}${trend.varianceP.toFixed(1)} p.p.` : '—'}</Td>
                            <Td numeric className="text-fg-muted">{trend.totalSkus}</Td>
                            <Td className="text-center">
                              {trend.points.length >= 2
                                ? <span className="inline-flex justify-center"><Sparkline points={trend.points} critical={trend.avgAccuracy !== null && trend.avgAccuracy < ACCURACY_TARGET} /></span>
                                : <span className="text-xs text-fg-subtle">Dados insuficientes</span>}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </Panel>
            </div>

            <Panel>
              <PanelSection padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-title">Ranking de Operadores</h3>
                <div className="flex items-center gap-3">
                  <Input icon={<Search />} placeholder="Buscar operador" aria-label="Buscar operador" value={search} onChange={e => handleSearch(e.target.value)} className="sm:w-64" />
                  <span className="whitespace-nowrap text-caption tabular-nums">{operadoresFiltered.length} operador{operadoresFiltered.length !== 1 ? 'es' : ''}</span>
                </div>
              </PanelSection>
              <div className="overflow-x-auto">
                <Table className="whitespace-nowrap">
                  <Thead>
                    <Tr>
                      <Th className="w-10">#</Th>
                      <Th>Operador</Th>
                      <Th className="text-right">SKUs</Th>
                      <Th className="text-right">Ritmo</Th>
                      <Th className="text-right">Acuracidade</Th>
                      <Th className="text-right">Diverg./100</Th>
                      <Th className="text-center">Consistência 7d</Th>
                      <Th className="text-center">Elegibilidade</Th>
                      <Th className="text-center">Situação</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {pagedData.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-fg-subtle text-sm">Nenhum operador encontrado.</td></tr>
                    ) : (pagedData as typeof operadoresFiltered).map((row, i) => (
                      <Tr key={row.id}>
                        <Td className="text-xs tabular-nums text-fg-subtle">{(page - 1) * PAGE_SIZE + i + 1}</Td>
                        <Td className="font-medium">{row.name}</Td>
                        <Td numeric className="text-fg-muted">{row.skus}</Td>
                        <Td numeric className="text-fg-muted">{row.ritmoPerHour !== null ? `${row.ritmoPerHour.toFixed(1)}/h` : '—'}</Td>
                        <Td numeric>
                          {row.accuracy !== null
                            ? <span className={`font-semibold ${row.situacao === 'risco' ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{row.accuracy.toFixed(1)}%</span>
                            : <span className="text-fg-subtle">—</span>}
                        </Td>
                        <Td numeric className={row.situacao === 'risco' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-fg-muted'}>
                          {row.divergenciasPor100 !== null ? row.divergenciasPor100.toFixed(1) : '—'}
                        </Td>
                        <Td className="text-center">
                          {row.trend.points.length >= 2
                            ? <span className="inline-flex justify-center"><Sparkline points={row.trend.points} critical={row.situacao === 'risco'} /></span>
                            : <span className="text-xs text-fg-subtle">—</span>}
                        </Td>
                        <Td className="text-center">
                          {row.elegivel
                            ? <span className="text-xs text-fg-muted">Elegível</span>
                            : <span className="text-xs text-fg-subtle">Não elegível (amostra &lt; {MIN_RANKING_SAMPLE} SKUs)</span>}
                        </Td>
                        <Td className="text-center"><SituacaoBadge situacao={row.situacao} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {totalPages > 1 && <Pagination page={page} totalPages={totalPages} setPage={setPage} currentCount={currentData.length} />}
              <PanelSection padding="sm"><p className="text-caption">Velocidade não compensa acuracidade abaixo da meta.</p></PanelSection>
            </Panel>
          </>
        )}

        {activeTab === 'produtos' && (
          <Panel>
            <PanelSection padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-fg-muted">Produtos mais vendidos (dados já importados)</span>
              <div className="flex items-center gap-3">
                <Input icon={<Search />} placeholder="Buscar produto ou SKU" aria-label="Buscar produto ou SKU" value={search} onChange={e => handleSearch(e.target.value)} className="sm:w-64" />
                <span className="whitespace-nowrap text-caption tabular-nums">{produtosFiltered.length} registro{produtosFiltered.length !== 1 ? 's' : ''}</span>
              </div>
            </PanelSection>
            <div className="overflow-x-auto">
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="w-12">#</Th>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('produto')}><span className="flex items-center gap-1">Produto <SortIcon field="produto" /></span></Th>
                    <Th>SKU</Th>
                    <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('vendas')}><span className="flex items-center justify-end gap-1">Vendas <SortIcon field="vendas" /></span></Th>
                  </Tr>
                </Thead>
                <tbody>
                  {pagedData.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-fg-subtle text-sm">Nenhum produto encontrado.</td></tr>
                  ) : (pagedData as typeof produtosFiltered).map((row, i) => (
                    <Tr key={row.id}>
                      <Td className="text-xs tabular-nums text-fg-subtle">{(page - 1) * PAGE_SIZE + i + 1}</Td>
                      <Td className="max-w-[280px] truncate font-medium">{row.produto}</Td>
                      <Td className="font-mono text-fg-subtle">{row.sku}</Td>
                      <Td numeric className="font-semibold">{row.vendas}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} setPage={setPage} currentCount={currentData.length} />}
          </Panel>
        )}
      </Page>
    </div>
  );
};
