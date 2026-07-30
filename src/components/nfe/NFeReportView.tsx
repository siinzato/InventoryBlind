import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, Loader2, AlertCircle, Search, Printer, FileSpreadsheet, RotateCcw,
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import * as XLSX from 'xlsx';
import type { NfeInvoice, NfeInvoiceItem, ItemResultStatus } from '../../lib/nfe/nfeTypes';
import { getInvoiceItems, reopenConference } from '../../lib/nfe/nfeService';
import { computeReportStats, computeItemStatus } from '../../lib/nfe/nfeReportUtils';
import { useAuth } from '../../lib/auth';
import { ItemStatusBadge, InvoiceStatusBadge, formatDate, formatDateTime, formatQty } from './nfeUi';

interface Props {
  invoice: NfeInvoice;
  onReopened: () => void;
  onBack: () => void;
}

type Filter = 'all' | 'ok' | 'missing' | 'surplus' | 'pending';

export function NFeReportView({ invoice, onReopened, onBack }: Props) {
  const { profile } = useAuth();
  const [items, setItems] = useState<NfeInvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [reopening, setReopening] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const canReopen = ['owner', 'admin', 'manager'].includes(profile?.role ?? '');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getInvoiceItems(invoice.id));
    } catch {
      setError('Não foi possível carregar o relatório.');
    } finally {
      setLoading(false);
    }
  }, [invoice.id]);

  useEffect(() => { load(); }, [load]);

  const statusOf = (it: NfeInvoiceItem): ItemResultStatus => it.result_status ?? computeItemStatus(it);
  const stats = useMemo(() => computeReportStats(items), [items]);

  const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: `NFe-${invoice.invoice_number ?? invoice.invoice_key}` });

  function exportExcel() {
    const rows = items.map((it) => ({
      Nome: it.snapshot_product_name ?? it.description ?? '',
      SKU: it.snapshot_sku ?? it.nfe_code ?? '',
      EAN: it.snapshot_ean ?? it.nfe_ean ?? '',
      'Qtd NF': it.expected_quantity,
      'Qtd Física': it.physical_quantity ?? '',
      Diferença: it.physical_quantity != null ? it.physical_quantity - it.expected_quantity : '',
      Status: statusOf(it),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Conferência');
    XLSX.writeFile(wb, `nfe-${invoice.invoice_number ?? invoice.invoice_key}.xlsx`);
  }

  async function handleReopen() {
    setReopening(true);
    setError(null);
    try {
      await reopenConference(invoice.id);
      onReopened();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível reabrir a conferência.');
      setReopening(false);
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      const st = statusOf(it);
      if (filter === 'ok' && st !== 'ok') return false;
      if (filter === 'missing' && st !== 'missing') return false;
      if (filter === 'surplus' && st !== 'surplus') return false;
      if (filter === 'pending' && st !== 'pending' && st !== 'unlinked') return false;
      if (q === '') return true;
      return (
        (it.snapshot_product_name ?? it.description ?? '').toLowerCase().includes(q) ||
        (it.snapshot_sku ?? it.nfe_code ?? '').toLowerCase().includes(q) ||
        (it.snapshot_ean ?? it.nfe_ean ?? '').toLowerCase().includes(q)
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, search]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 transition-colors">
          <ArrowLeft size={16} /> Voltar
        </button>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 text-sm font-semibold hover:bg-zinc-50">
            <FileSpreadsheet size={15} /> Excel
          </button>
          <button onClick={() => handlePrint()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 text-sm font-semibold hover:bg-zinc-50">
            <Printer size={15} /> Imprimir / PDF
          </button>
          {canReopen && (
            <button onClick={handleReopen} disabled={reopening} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50">
              {reopening ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Recontar
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" /><p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-400"><Loader2 size={28} className="animate-spin" /></div>
      ) : (
        <div ref={printRef} className="space-y-4">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Relatório de conferência</h2>
                <p className="text-sm text-zinc-500 mt-0.5">{invoice.supplier_name ?? 'Fornecedor não informado'} · CNPJ {invoice.supplier_cnpj ?? '—'}</p>
              </div>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 mt-4 text-sm">
              <Detail label="Número" value={invoice.invoice_number ?? '—'} />
              <Detail label="Série" value={invoice.invoice_series ?? '—'} />
              <Detail label="Emissão" value={formatDate(invoice.issue_date)} />
              <Detail label="Início real" value={formatDateTime(invoice.started_at)} />
              <Detail label="Finalização" value={formatDateTime(invoice.finished_at)} />
              <Detail label="Chave" value={invoice.invoice_key} mono wide />
            </div>
          </div>

          {/* Indicators */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Indicator label="SKUs na NF" value={stats.skuCount} />
            <Indicator label="Conferidos" value={stats.conferredCount} />
            <Indicator label="OK" value={stats.okCount} tone="emerald" />
            <Indicator label="Faltas" value={stats.missingCount} tone="red" />
            <Indicator label="Sobras" value={stats.surplusCount} tone="amber" />
            <Indicator label="Não conferidos" value={stats.uncountedCount + stats.unlinkedCount} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Indicator label="Qtd total NF" value={formatQty(stats.totalNfQty)} />
            <Indicator label="Qtd física" value={formatQty(stats.totalPhysicalQty)} />
            <Indicator label="Conformidade" value={`${stats.conformityPct}%`} tone={stats.conformityPct === 100 ? 'emerald' : 'amber'} />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="flex gap-1 bg-zinc-100 rounded-lg p-1 flex-wrap">
              {([['all', 'Todos'], ['ok', 'OK'], ['missing', 'Faltas'], ['surplus', 'Sobras'], ['pending', 'Não conferidos']] as [Filter, string][]).map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${filter === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item..." className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Nome</th>
                  <th className="text-left font-semibold px-4 py-3">SKU</th>
                  <th className="text-left font-semibold px-4 py-3">EAN</th>
                  <th className="text-right font-semibold px-4 py-3">NF</th>
                  <th className="text-right font-semibold px-4 py-3">Físico</th>
                  <th className="text-right font-semibold px-4 py-3">Diferença</th>
                  <th className="text-center font-semibold px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((it) => {
                  const diff = it.physical_quantity != null ? it.physical_quantity - it.expected_quantity : null;
                  return (
                    <tr key={it.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 text-zinc-800">{it.snapshot_product_name ?? it.description ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-600">{it.snapshot_sku ?? it.nfe_code ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-zinc-600">{it.snapshot_ean ?? it.nfe_ean ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">{formatQty(it.expected_quantity)}</td>
                      <td className="px-4 py-2.5 text-right">{formatQty(it.physical_quantity)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${diff == null ? 'text-zinc-400' : diff === 0 ? 'text-zinc-500' : diff < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {diff == null ? '—' : diff > 0 ? `+${formatQty(diff)}` : formatQty(diff)}
                      </td>
                      <td className="px-4 py-2.5 text-center"><ItemStatusBadge status={statusOf(it)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && <p className="text-center text-sm text-zinc-400 py-8">Nenhum item.</p>}
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {visible.map((it) => {
              const diff = it.physical_quantity != null ? it.physical_quantity - it.expected_quantity : null;
              return (
                <div key={it.id} className="bg-white rounded-xl border border-zinc-200 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-zinc-900 text-sm">{it.snapshot_product_name ?? it.description ?? '—'}</p>
                    <ItemStatusBadge status={statusOf(it)} />
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">SKU {it.snapshot_sku ?? it.nfe_code ?? '—'}{(it.snapshot_ean ?? it.nfe_ean) ? ` · EAN ${it.snapshot_ean ?? it.nfe_ean}` : ''}</p>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                    <div><p className="text-[10px] uppercase text-zinc-400 font-semibold">NF</p><p className="font-bold text-zinc-800">{formatQty(it.expected_quantity)}</p></div>
                    <div><p className="text-[10px] uppercase text-zinc-400 font-semibold">Físico</p><p className="font-bold text-zinc-800">{formatQty(it.physical_quantity)}</p></div>
                    <div><p className="text-[10px] uppercase text-zinc-400 font-semibold">Dif.</p><p className={`font-bold ${diff == null ? 'text-zinc-400' : diff === 0 ? 'text-zinc-500' : diff < 0 ? 'text-red-600' : 'text-amber-600'}`}>{diff == null ? '—' : diff > 0 ? `+${formatQty(diff)}` : formatQty(diff)}</p></div>
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && <p className="text-center text-sm text-zinc-400 py-8">Nenhum item.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-4' : ''}>
      <span className="text-zinc-400 text-xs uppercase tracking-wide font-semibold">{label}: </span>
      <span className={`text-zinc-800 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</span>
    </div>
  );
}

function Indicator({ label, value, tone = 'zinc' }: { label: string; value: string | number; tone?: 'zinc' | 'emerald' | 'red' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-zinc-900';
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-semibold mt-0.5">{label}</p>
    </div>
  );
}
