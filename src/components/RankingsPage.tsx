// Rankings Complete Page Component

import React, { useState, useMemo, useCallback } from 'react';
import {
  Trophy,
  ArrowLeft,
  X,
  Award,
  TrendingUp,
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
} from 'lucide-react';
import { downloadFile } from '../lib/productImportUtils';

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

interface OpCapa {
  nome: string;
  valor: string;
  resp: string;
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
  opCapas: OpCapa[];
  melhores: { nome: string; valor: string }[];
  piores: { nome: string; valor: string }[];
  inProgress: BrandRow[];
}

type TabId = 'acuracidade' | 'divergencias' | 'progresso' | 'andamento' | 'operadores' | 'vendas';

type SortDir = 'asc' | 'desc';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'acuracidade', label: 'Acuracidade', icon: <Trophy size={16} /> },
  { id: 'divergencias', label: 'Divergencias', icon: <AlertTriangle size={16} /> },
  { id: 'progresso', label: 'Progresso', icon: <BarChart3 size={16} /> },
  { id: 'andamento', label: 'Em Andamento', icon: <Clock size={16} /> },
  { id: 'operadores', label: 'Operadores', icon: <Users size={16} /> },
  { id: 'vendas', label: 'Top Vendas', icon: <Award size={16} /> },
];

interface SortState {
  field: string;
  dir: SortDir;
}

const PAGE_SIZE = 20;

export const RankingsPage: React.FC<RankingsPageProps> = ({
  onBack,
  brandsData,
  topVendas,
  opCapas,
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
    if (sort.field !== field) return <ChevronUp size={14} className="text-zinc-300" />;
    return sort.dir === 'asc'
      ? <ChevronUp size={14} className="text-blue-500" />
      : <ChevronDown size={14} className="text-blue-500" />;
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
    let data = [...opCapas];
    if (search) data = data.filter(r =>
      r.nome.toLowerCase().includes(search.toLowerCase()) ||
      r.resp.toLowerCase().includes(search.toLowerCase())
    );
    if (sort.field === 'nome') data.sort((a, b) => sort.dir === 'asc' ? a.nome.localeCompare(b.nome) : b.nome.localeCompare(a.nome));
    if (sort.field === 'resp') data.sort((a, b) => sort.dir === 'asc' ? a.resp.localeCompare(b.resp) : b.resp.localeCompare(a.resp));
    return data;
  }, [opCapas, search, sort]);

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
      header = 'Linha/Marca;Operador;Acuracidade';
      rows = (operadoresData as typeof operadoresData).map(r => `${r.nome};${r.resp};${r.valor}`);
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
  const melhorOp = opCapas.find(o => o.valor !== 'Andamento' && o.valor !== '');

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-zinc-950 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition text-sm font-medium"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Voltar ao Dashboard</span>
            </button>
            <div className="flex items-center gap-2">
              <Trophy size={22} className="text-amber-400" />
              <div>
                <h1 className="font-bold text-base leading-tight">Rankings Completos</h1>
                <p className="text-xs text-zinc-400 hidden sm:block">Analise completa de desempenho</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition text-sm font-medium"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Exportar CSV</span>
            </button>
            <button
              onClick={onBack}
              className="p-2 hover:bg-zinc-800 rounded-lg transition"
              title="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-emerald-100 rounded-lg"><Trophy size={16} className="text-emerald-600" /></div>
              <span className="text-xs font-semibold text-zinc-500 uppercase">Melhor Linha</span>
            </div>
            <p className="font-bold text-zinc-800 text-sm truncate">{melhorLinha?.nome ?? '—'}</p>
            <p className="text-emerald-600 font-mono text-lg font-bold">{melhorLinha?.valor ?? '—'}</p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle size={16} className="text-red-600" /></div>
              <span className="text-xs font-semibold text-zinc-500 uppercase">Linha Critica</span>
            </div>
            <p className="font-bold text-zinc-800 text-sm truncate">{piorLinha?.nome ?? '—'}</p>
            <p className="text-red-600 font-mono text-lg font-bold">{piorLinha?.valor ?? '—'}</p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-amber-100 rounded-lg"><Activity size={16} className="text-amber-600" /></div>
              <span className="text-xs font-semibold text-zinc-500 uppercase">Maior Divergencia</span>
            </div>
            <p className="font-bold text-zinc-800 text-sm truncate">{maiorDiv?.brand ?? '—'}</p>
            <p className="text-amber-600 font-mono text-lg font-bold">{maiorDiv?.divergences ?? 0} unid.</p>
          </div>

          <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg"><Users size={16} className="text-blue-600" /></div>
              <span className="text-xs font-semibold text-zinc-500 uppercase">Melhor Operador</span>
            </div>
            <p className="font-bold text-zinc-800 text-sm truncate">{melhorOp?.resp ?? '—'}</p>
            <p className="text-blue-600 font-mono text-lg font-bold">{melhorOp?.valor ?? '—'}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex overflow-x-auto border-b border-zinc-200 bg-zinc-50">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-zinc-900 text-zinc-900 bg-white'
                    : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200">
            <div className="relative flex-1 max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={e => handleSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </div>
            <span className="text-xs text-zinc-400 font-medium">
              {currentData.length} registro{currentData.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {activeTab === 'acuracidade' && (
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase w-12">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('nome')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="nome" /></span>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('valor')}>
                      <span className="flex items-center justify-end gap-1">Acuracidade <SortIcon field="valor" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof acuracidadeData).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          row.rank === 1 ? 'bg-amber-400 text-white' :
                          row.rank === 2 ? 'bg-zinc-300 text-zinc-700' :
                          row.rank === 3 ? 'bg-amber-700 text-white' :
                          'bg-zinc-100 text-zinc-500'
                        }`}>{row.rank}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-800">{row.nome}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-bold text-base ${row.rawVal >= 80 ? 'text-emerald-600' : row.rawVal >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {row.valor}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'divergencias' && (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('divergences')}>
                      <span className="flex items-center justify-center gap-1">Divergencias <SortIcon field="divergences" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Contados</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Total SKU</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof divergenciasData).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium text-zinc-800">{row.brand}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold text-base ${row.divergences === 0 ? 'text-emerald-600' : row.divergences > 20 ? 'text-red-600' : 'text-amber-600'}`}>
                          {row.divergences}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">{row.doneSku}</td>
                      <td className="px-4 py-3 text-center text-zinc-600">{row.totalSku}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-[11px] font-bold rounded-md uppercase ${
                          row.status === 'CONCLUÍDO' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'progresso' && (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('progress')}>
                      <span className="flex items-center justify-center gap-1">Progresso <SortIcon field="progress" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Concluidos</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Total SKU</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Acuracidade</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof progressoData).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium text-zinc-800">{row.brand}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-zinc-200 rounded-full h-2 min-w-[80px]">
                            <div
                              className={`h-2 rounded-full ${row.progress >= 100 ? 'bg-emerald-500' : row.progress >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                              style={{ width: `${Math.min(100, row.progress)}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-semibold w-12 text-right">{row.progress.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">{row.doneSku}</td>
                      <td className="px-4 py-3 text-center text-zinc-600">{row.totalSku}</td>
                      <td className="px-4 py-3 text-center font-bold">
                        {row.accuracy !== null
                          ? <span className={row.accuracy >= 80 ? 'text-emerald-600' : row.accuracy >= 50 ? 'text-amber-600' : 'text-red-600'}>{row.accuracy.toFixed(1)}%</span>
                          : <span className="text-zinc-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 text-[11px] font-bold rounded-md uppercase ${
                          row.status === 'CONCLUÍDO' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'andamento' && (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('brand')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="brand" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('progress')}>
                      <span className="flex items-center justify-center gap-1">Progresso <SortIcon field="progress" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Concluidos / Total</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase">Divergencias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof andamentoData).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-400">
                      <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
                      Todas as linhas foram concluidas!
                    </td></tr>
                  ) : (
                    (pagedData as typeof andamentoData).map((row, i) => (
                      <tr key={i} className="hover:bg-zinc-50">
                        <td className="px-4 py-3 font-medium text-zinc-800">{row.brand}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-zinc-200 rounded-full h-2 min-w-[80px]">
                              <div
                                className="h-2 rounded-full bg-amber-500"
                                style={{ width: `${Math.min(100, row.progress)}%` }}
                              />
                            </div>
                            <span className="text-xs font-mono font-bold text-amber-600 w-12 text-right">{row.progress.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-zinc-600">{row.doneSku} / {row.totalSku}</td>
                        <td className="px-4 py-3 text-center font-bold">
                          <span className={row.divergences > 0 ? 'text-red-600' : 'text-emerald-600'}>{row.divergences}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {activeTab === 'operadores' && (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('nome')}>
                      <span className="flex items-center gap-1">Linha / Marca <SortIcon field="nome" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('resp')}>
                      <span className="flex items-center justify-center gap-1">Operador <SortIcon field="resp" /></span>
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 uppercase">Acuracidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof operadoresData).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-medium text-zinc-800">{row.nome}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-semibold">
                          <Users size={12} />
                          {row.resp}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {row.valor === 'Andamento'
                          ? <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-md font-bold">Em Andamento</span>
                          : <span className="text-zinc-800">{row.valor}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'vendas' && (
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase w-12">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('produto')}>
                      <span className="flex items-center gap-1">Produto <SortIcon field="produto" /></span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase">SKU</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 uppercase cursor-pointer select-none" onClick={() => handleSort('vendas')}>
                      <span className="flex items-center justify-end gap-1">Vendas <SortIcon field="vendas" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(pagedData as typeof vendasData).map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          i + 1 === 1 ? 'bg-amber-400 text-white' :
                          i + 1 === 2 ? 'bg-zinc-300 text-zinc-700' :
                          i + 1 === 3 ? 'bg-amber-700 text-white' :
                          'bg-zinc-100 text-zinc-500'
                        }`}>{(page - 1) * PAGE_SIZE + i + 1}</span>
                      </td>
                      <td className="px-4 py-3 font-medium text-zinc-800 max-w-[280px] truncate">{row.produto}</td>
                      <td className="px-4 py-3 font-mono text-zinc-500">{row.sku}</td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-900">{row.vendas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50">
              <p className="text-xs text-zinc-500">
                Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, currentData.length)} de {currentData.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Anterior
                </button>
                <span className="px-3 py-1.5 text-sm font-medium">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Proximo
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Back button at bottom */}
        <div className="flex justify-center pb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-semibold transition shadow-sm"
          >
            <ArrowLeft size={18} />
            Voltar ao Dashboard
          </button>
        </div>

      </div>
    </div>
  );
};
