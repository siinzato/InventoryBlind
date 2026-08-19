// Rankings Complete Page Component

import React, { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  X,
  Award,
  Users,
  Clock,
  BarChart3,
  AlertTriangle,
  Search,
  Download,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Activity,
  Target,
} from 'lucide-react';
import { downloadFile } from '../lib/productImportUtils';
import type { UserProductivityStats } from '../lib/supabase';
import {
  Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button,
  Input, SegmentedControl, Stat, StatRow, StatCell, type SegmentedOption,
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
  brandsData: BrandRow[];
  topVendas: TopVenda[];
  operatorStats: UserProductivityStats[];
  melhores: { nome: string; valor: string }[];
  piores: { nome: string; valor: string }[];
  inProgress: BrandRow[];
}

type TabId = 'acuracidade' | 'divergencias' | 'progresso' | 'andamento' | 'operadores' | 'vendas';

type SortDir = 'asc' | 'desc';

// Target is the metric, not the podium: "Acuracidade" is a measurement, so it
// gets a gauge rather than the trophy it used to carry.
const TABS: SegmentedOption<TabId>[] = [
  { value: 'acuracidade', label: 'Acuracidade', icon: Target },
  { value: 'divergencias', label: 'Divergências', icon: AlertTriangle },
  { value: 'progresso', label: 'Progresso', icon: BarChart3 },
  { value: 'andamento', label: 'Em Andamento', icon: Clock },
  { value: 'operadores', label: 'Operadores', icon: Users },
  { value: 'vendas', label: 'Top Vendas', icon: Award },
];

interface SortState {
  field: string;
  dir: SortDir;
}

const PAGE_SIZE = 20;

/** Position marker. Deliberately not a medal: gold/silver/bronze chips are
 *  gamification borrowed from leaderboards, and this is an operations report —
 *  a warehouse manager reads it to decide where to send people, not to award
 *  prizes. First place gets a quiet accent tint because it is the row the eye
 *  should find; everything else is a plain tabular figure. */
function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'bg-accent/10 text-accent font-semibold' : 'text-fg-subtle';
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums ${cls}`}
    >
      {rank}
    </span>
  );
}

/** Colour policy for every metric in this page.
 *
 *  Only the genuinely-bad end earns colour. The tables previously ran a
 *  three-way emerald/amber/red ramp on every numeric cell, which turns a ranking
 *  into a traffic light: when every row is coloured, nothing stands out and a
 *  real problem has no contrast left to claim. Good and middling values are now
 *  plain figures, so red means "go look at this". */
function metricTone(critical: boolean): string {
  return critical ? 'text-red-600 dark:text-red-400' : 'text-fg';
}

/** Status pill. CONCLUÍDO is a real completion state, so it keeps semantic color;
 *  every other status is the default/majority "still working on it" state and
 *  stays plain muted text — no loud badge for the common case. */
function StatusPill({ status }: { status: string }) {
  if (status === 'CONCLUÍDO') {
    return <Badge variant="success" className="uppercase">{status}</Badge>;
  }
  return <span className="text-xs font-medium text-fg-subtle uppercase">{status}</span>;
}

export const RankingsPage: React.FC<RankingsPageProps> = ({
  onBack,
  brandsData,
  topVendas,
  operatorStats,
  melhores,
  piores,
  inProgress,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('acuracidade');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ field: '', dir: 'desc' });
  const [page, setPage] = useState(1);

  // Reset page when tab or search changes
  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSearch('');
    setSort({ field: '', dir: 'desc' });
    setPage(1);
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  const handleSort = (field: string) => {
    setSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'desc' }
    );
    setPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sort.field !== field) return <ChevronUp size={14} className="text-fg-subtle" />;
    return sort.dir === 'asc'
      ? <ChevronUp size={14} className="text-accent" />
      : <ChevronDown size={14} className="text-accent" />;
  };

  // ---- ACURACIDADE DATA ----
  const acuracidadeData = useMemo(() => {
    let data = melhores.map((m, i) => ({
      rank: i + 1,
      nome: m.nome,
      valor: m.valor,
      rawVal: parseFloat(m.valor),
    }));
    if (search) data = data.filter(r => r.nome.toLowerCase().includes(search.toLowerCase()));
    if (sort.field === 'nome') data.sort((a, b) => sort.dir === 'asc' ? a.nome.localeCompare(b.nome) : b.nome.localeCompare(a.nome));
    if (sort.field === 'valor') data.sort((a, b) => sort.dir === 'asc' ? a.rawVal - b.rawVal : b.rawVal - a.rawVal);
    return data;
  }, [melhores, search, sort]);

  // ---- DIVERGENCIAS DATA ----
  const divergenciasData = useMemo(() => {
    let data = brandsData
      .filter(b => b.doneSku > 0)
      .map(b => ({ id: b.id, brand: b.brand, divergences: b.divergences, doneSku: b.doneSku, totalSku: b.totalSku, status: b.status }));
    data.sort((a, b) => b.divergences - a.divergences);
    if (search) data = data.filter(r => r.brand.toLowerCase().includes(search.toLowerCase()));
    if (sort.field === 'brand') data.sort((a, b) => sort.dir === 'asc' ? a.brand.localeCompare(b.brand) : b.brand.localeCompare(a.brand));
    if (sort.field === 'divergences') data.sort((a, b) => sort.dir === 'asc' ? a.divergences - b.divergences : b.divergences - a.divergences);
    return data;
  }, [brandsData, search, sort]);

  // ---- PROGRESSO DATA ----
  const progressoData = useMemo(() => {
    let data = brandsData.map(b => ({
      id: b.id,
      brand: b.brand,
      progress: b.progress,
      doneSku: b.doneSku,
      totalSku: b.totalSku,
      status: b.status,
      accuracy: b.accuracy,
    }));
    data.sort((a, b) => b.progress - a.progress);
    if (search) data = data.filter(r => r.brand.toLowerCase().includes(search.toLowerCase()));
    if (sort.field === 'brand') data.sort((a, b) => sort.dir === 'asc' ? a.brand.localeCompare(b.brand) : b.brand.localeCompare(a.brand));
    if (sort.field === 'progress') data.sort((a, b) => sort.dir === 'asc' ? a.progress - b.progress : b.progress - a.progress);
    return data;
  }, [brandsData, search, sort]);

  // ---- ANDAMENTO DATA ----
  const andamentoData = useMemo(() => {
    let data = inProgress.map(b => ({
      id: b.id,
      brand: b.brand,
      progress: b.progress,
      doneSku: b.doneSku,
      totalSku: b.totalSku,
      divergences: b.divergences,
    }));
    data.sort((a, b) => b.progress - a.progress);
    if (search) data = data.filter(r => r.brand.toLowerCase().includes(search.toLowerCase()));
    if (sort.field === 'brand') data.sort((a, b) => sort.dir === 'asc' ? a.brand.localeCompare(b.brand) : b.brand.localeCompare(a.brand));
    if (sort.field === 'progress') data.sort((a, b) => sort.dir === 'asc' ? a.progress - b.progress : b.progress - a.progress);
    return data;
  }, [inProgress, search, sort]);

  // ---- OPERADORES DATA ----
  const operadoresData = useMemo(() => {
    let data = operatorStats.filter(o => o.contagens > 0);
    if (search) data = data.filter(r => (r.name || '').toLowerCase().includes(search.toLowerCase()));
    if (sort.field === 'nome') data.sort((a, b) => sort.dir === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || ''));
    if (sort.field === 'valor') {
      data.sort((a, b) => sort.dir === 'asc'
        ? (a.acuracidade_media ?? 0) - (b.acuracidade_media ?? 0)
        : (b.acuracidade_media ?? 0) - (a.acuracidade_media ?? 0));
    }
    if (!sort.field) data.sort((a, b) => (b.acuracidade_media ?? 0) - (a.acuracidade_media ?? 0));
    return data;
  }, [operatorStats, search, sort]);

  // ---- VENDAS DATA ----
  const vendasData = useMemo(() => {
    let data = topVendas.map(v => ({ ...v, vendasNum: parseInt(String(v.vendas).replace(/\D/g, '') || '0') }));
    if (search) data = data.filter(r =>
      r.produto.toLowerCase().includes(search.toLowerCase()) ||
      r.sku.toLowerCase().includes(search.toLowerCase())
    );
    if (sort.field === 'produto') data.sort((a, b) => sort.dir === 'asc' ? a.produto.localeCompare(b.produto) : b.produto.localeCompare(a.produto));
    if (sort.field === 'vendas') data.sort((a, b) => sort.dir === 'asc' ? a.vendasNum - b.vendasNum : b.vendasNum - a.vendasNum);
    return data;
  }, [topVendas, search, sort]);

  // Current dataset + pagination
  const currentData = {
    acuracidade: acuracidadeData,
    divergencias: divergenciasData,
    progresso: progressoData,
    andamento: andamentoData,
    operadores: operadoresData,
    vendas: vendasData,
  }[activeTab];

  const totalPages = Math.ceil(currentData.length / PAGE_SIZE);
  const pagedData = currentData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Export CSV
  const handleExport = () => {
    let rows: string[] = [];
    let header = '';

    if (activeTab === 'acuracidade') {
      header = 'Rank;Linha/Marca;Acuracidade';
      rows = (acuracidadeData as typeof acuracidadeData).map(r => `${r.rank};${r.nome};${r.valor}`);
    } else if (activeTab === 'divergencias') {
      header = 'Linha/Marca;Divergencias;Contados;Total SKU;Status';
      rows = (divergenciasData as typeof divergenciasData).map(r => `${r.brand};${r.divergences};${r.doneSku};${r.totalSku};${r.status}`);
    } else if (activeTab === 'progresso') {
      header = 'Linha/Marca;Progresso;Concluidos;Total SKU;Acuracidade;Status';
      rows = (progressoData as typeof progressoData).map(r => `${r.brand};${r.progress.toFixed(1)}%;${r.doneSku};${r.totalSku};${r.accuracy !== null ? r.accuracy.toFixed(1) + '%' : ''};${r.status}`);
    } else if (activeTab === 'andamento') {
      header = 'Linha/Marca;Progresso;Concluidos;Total SKU;Divergencias';
      rows = (andamentoData as typeof andamentoData).map(r => `${r.brand};${r.progress.toFixed(1)}%;${r.doneSku};${r.totalSku};${r.divergences}`);
    } else if (activeTab === 'operadores') {
      header = 'Operador;SKUs Contados;Contagens;Divergencias Reais;Acuracidade';
      rows = (operadoresData as typeof operadoresData).map(r =>
        `${r.name || '—'};${r.skus_contados};${r.contagens};${r.divergencias_reais};${r.acuracidade_media !== null ? r.acuracidade_media.toFixed(1) + '%' : ''}`
      );
    } else if (activeTab === 'vendas') {
      header = 'Produto;SKU;Vendas';
      rows = (vendasData as typeof vendasData).map(r => `${r.produto};${r.sku};${r.vendas}`);
    }

    const content = [header, ...rows].join('\n');
    downloadFile(content, `ranking-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // Summary cards
  const melhorLinha = melhores[0];
  const piorLinha = piores[0];
  const maiorDiv = [...brandsData].sort((a, b) => b.divergences - a.divergences)[0];
  const melhorOp = [...operatorStats]
    .filter(o => o.contagens > 0 && o.acuracidade_media !== null)
    .sort((a, b) => (b.acuracidade_media ?? 0) - (a.acuracidade_media ?? 0))[0];

  return (
    <div className="min-h-screen bg-surface">
      {/* Sticky bar is chrome only — navigation and actions. The page's own name
          lives in the masthead below, like every other screen in the app. The
          gold trophy that used to sit here was a decorative page mark: it named
          nothing the heading doesn't and framed an operations report as a
          leaderboard. */}
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
          description="Acuracidade, divergências e progresso por linha, operador e produto — a leitura completa por trás do resumo do Dashboard."
        />

        {/* Four figures in ONE panel. Each used to carry its own icon inside a
            tinted box and its own value colour, assigned per card rather than by
            state — four boxes, three hues, colour chosen for variety. Now they go
            through Stat, and only the critical line is coloured, so the one figure
            that needs action is the one that looks like it. */}
        <Panel>
          <PanelSection padding="lg">
            <StatRow>
              <StatCell>
                <Stat label="Melhor Linha" value={melhorLinha?.valor ?? '—'} context={melhorLinha?.nome} icon={<Target />} />
              </StatCell>
              <StatCell>
                <Stat
                  label="Linha Crítica"
                  value={piorLinha?.valor ?? '—'}
                  context={piorLinha?.nome}
                  icon={<AlertTriangle />}
                  valueTone="critical"
                />
              </StatCell>
              <StatCell>
                <Stat
                  label="Maior Divergência"
                  value={`${maiorDiv?.divergences ?? 0} un.`}
                  context={maiorDiv?.brand}
                  icon={<Activity />}
                />
              </StatCell>
              <StatCell>
                <Stat
                  label="Melhor Operador"
                  value={melhorOp ? `${melhorOp.acuracidade_media?.toFixed(1)}%` : '—'}
                  context={melhorOp?.name ?? undefined}
                  icon={<Users />}
                />
              </StatCell>
            </StatRow>
          </PanelSection>
        </Panel>

        {/* Tabs. Was a fourth distinct tab pattern in the app (filled grey bar +
            2px underline); now the same SegmentedControl every other module uses,
            so switching views feels identical everywhere. */}
        <Panel>
          <PanelSection padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SegmentedControl
              label="Ranking exibido"
              options={TABS}
              value={activeTab}
              onChange={handleTabChange}
            />
            <div className="flex items-center gap-3">
              <Input
                icon={<Search />}
                type="text"
                placeholder="Buscar..."
                aria-label="Buscar no ranking"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                className="sm:w-64"
              />
              <span className="whitespace-nowrap text-caption tabular-nums">
                {currentData.length} registro{currentData.length !== 1 ? 's' : ''}
              </span>
            </div>
          </PanelSection>

          {/* Table */}
          <div className="overflow-x-auto">
            {activeTab === 'acuracidade' && (
              <Table>
                <Thead>
                  <Tr>
                    <Th className="w-12">#</Th>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('nome')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="nome" /></span>
                    </Th>
                    <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('valor')}>
                      <span className="flex items-center justify-end gap-1">Acuracidade <SortIcon field="valor" /></span>
                    </Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof acuracidadeData).map((row, i) => (
                    <Tr key={i}>
                      <Td><RankBadge rank={row.rank} /></Td>
                      <Td className="font-medium">{row.nome}</Td>
                      <Td numeric>
                        <span className={`font-semibold ${metricTone(row.rawVal < 50)}`}>{row.valor}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'divergencias' && (
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </Th>
                    <Th className="text-right cursor-pointer select-none" onClick={() => handleSort("divergences")}>
                      <span className="flex items-center justify-end gap-1">Divergências <SortIcon field="divergences" /></span>
                    </Th>
                    <Th className="text-right">Contados</Th>
                    <Th className="text-right">Total SKU</Th>
                    <Th className="text-center">Status</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof divergenciasData).map((row, i) => (
                    <Tr key={i}>
                      <Td className="font-medium">{row.brand}</Td>
                      <Td numeric>
                        <span className={`font-semibold ${metricTone(row.divergences > 20)}`}>{row.divergences}</span>
                      </Td>
                      <Td numeric className="text-fg-muted">{row.doneSku}</Td>
                      <Td numeric className="text-fg-muted">{row.totalSku}</Td>
                      <Td className="text-center"><StatusPill status={row.status} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'progresso' && (
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </Th>
                    <Th className="text-center cursor-pointer select-none" onClick={() => handleSort('progress')}>
                      <span className="flex items-center justify-center gap-1">Progresso <SortIcon field="progress" /></span>
                    </Th>
                    <Th className="text-right">Concluídos</Th>
                    <Th className="text-right">Total SKU</Th>
                    <Th className="text-right">Acuracidade</Th>
                    <Th className="text-center">Status</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof progressoData).map((row, i) => (
                    <Tr key={i}>
                      <Td className="font-medium">{row.brand}</Td>
                      {/* Progress is a quantity, not a severity — a bar that turns
                          red at 40% reads as an alarm for a line that is simply
                          not finished yet. One accent bar, length carries it. */}
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 min-w-[80px] flex-1 rounded-full bg-surface-3">
                            <div
                              className="h-1.5 rounded-full bg-accent"
                              style={{ width: `${Math.min(100, row.progress)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right font-mono text-xs tabular-nums text-fg-muted">
                            {row.progress.toFixed(1)}%
                          </span>
                        </div>
                      </Td>
                      <Td numeric className="text-fg-muted">{row.doneSku}</Td>
                      <Td numeric className="text-fg-muted">{row.totalSku}</Td>
                      <Td numeric>
                        {row.accuracy !== null
                          ? <span className={`font-semibold ${metricTone(row.accuracy < 50)}`}>{row.accuracy.toFixed(1)}%</span>
                          : <span className="text-fg-subtle">—</span>
                        }
                      </Td>
                      <Td className="text-center"><StatusPill status={row.status} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'andamento' && (
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </Th>
                    <Th className="text-center cursor-pointer select-none" onClick={() => handleSort('progress')}>
                      <span className="flex items-center justify-center gap-1">Progresso <SortIcon field="progress" /></span>
                    </Th>
                    <Th className="text-right">Concluídos / Total</Th>
                    <Th className="text-right">Divergências</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof andamentoData).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-fg-subtle">
                      <CheckCircle2 size={32} className="mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Nenhuma linha em andamento.</p>
                      <p className="text-caption mt-1">Todas as linhas do inventário foram concluídas.</p>
                    </td></tr>
                  ) : (
                    (pagedData as typeof andamentoData).map((row, i) => (
                      <Tr key={i}>
                        <Td className="font-medium">{row.brand}</Td>
                        {/* "In progress" is the default state of every row in this
                            tab, so it gets no colour at all — an amber bar on
                            every line is decoration, not information. */}
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 min-w-[80px] flex-1 rounded-full bg-surface-3">
                              <div
                                className="h-1.5 rounded-full bg-accent"
                                style={{ width: `${Math.min(100, row.progress)}%` }}
                              />
                            </div>
                            <span className="w-12 text-right font-mono text-xs tabular-nums text-fg-muted">
                              {row.progress.toFixed(1)}%
                            </span>
                          </div>
                        </Td>
                        <Td numeric className="text-fg-muted">{row.doneSku} / {row.totalSku}</Td>
                        <Td numeric>
                          <span className={`font-semibold ${metricTone(row.divergences > 0)}`}>{row.divergences}</span>
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            )}

            {activeTab === 'operadores' && (
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('nome')}>
                      <span className="flex items-center gap-1">Operador <SortIcon field="nome" /></span>
                    </Th>
                    <Th className="text-center">SKUs Contados</Th>
                    <Th className="text-center">Contagens</Th>
                    <Th className="text-center">Divergências Reais</Th>
                    <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('valor')}>
                      <span className="flex items-center justify-end gap-1">Acuracidade <SortIcon field="valor" /></span>
                    </Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof operadoresData).map((row) => (
                    <Tr key={row.user_id}>
                      <Td className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Users size={12} className="text-fg-subtle" />
                          {row.name || '—'}
                        </span>
                      </Td>
                      <Td numeric className="text-center text-fg-muted">{row.skus_contados}</Td>
                      <Td numeric className="text-center text-fg-muted">{row.contagens}</Td>
                      <Td numeric className="text-center">
                        <span className={metricTone(row.divergencias_reais > 0)}>{row.divergencias_reais}</span>
                      </Td>
                      <Td numeric className="text-right">
                        {row.acuracidade_media !== null
                          ? <span className="font-semibold text-fg">{row.acuracidade_media.toFixed(1)}%</span>
                          : <span className="text-overline">—</span>
                        }
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'vendas' && (
              <Table className="whitespace-nowrap">
                <Thead>
                  <Tr>
                    <Th className="w-12">#</Th>
                    <Th className="cursor-pointer select-none" onClick={() => handleSort('produto')}>
                      <span className="flex items-center gap-1">Produto <SortIcon field="produto" /></span>
                    </Th>
                    <Th>SKU</Th>
                    <Th className="text-right cursor-pointer select-none" onClick={() => handleSort('vendas')}>
                      <span className="flex items-center justify-end gap-1">Vendas <SortIcon field="vendas" /></span>
                    </Th>
                  </Tr>
                </Thead>
                <tbody>
                  {(pagedData as typeof vendasData).map((row, i) => (
                    <Tr key={i}>
                      <Td><RankBadge rank={(page - 1) * PAGE_SIZE + i + 1} /></Td>
                      <Td className="max-w-[280px] truncate font-medium">{row.produto}</Td>
                      <Td className="font-mono text-fg-subtle">{row.sku}</Td>
                      <Td numeric className="font-semibold">{row.vendas}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-edge/60 px-4 py-3">
              <p className="text-caption tabular-nums">
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, currentData.length)} de {currentData.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Anterior
                </Button>
                <span className="px-3 text-sm tabular-nums text-fg-muted">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Próximo
                </Button>
              </div>
            </div>
          )}

        </Panel>
      </Page>
    </div>
  );
};
