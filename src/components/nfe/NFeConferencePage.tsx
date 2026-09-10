import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Plus, Loader2, FileText, Search, ChevronRight, AlertCircle, Archive,
  AlertTriangle, Lock, History, LayoutList, Columns3,
} from 'lucide-react';
import type { InvoiceStatus, NfeInvoice } from '../../lib/nfe/nfeTypes';
import {
  listArchivedInvoices, listInvoices, getInvoiceProgress, getInvoiceCountEvents,
  type InvoiceProgress, type InvoiceCountEvent,
} from '../../lib/nfe/nfeService';
import { canAdministerRecords } from '../../lib/admin/recordAdmin';
import { useAuth } from '../../lib/auth';
import { getTeamProductivity } from '../../lib/productivityService';
import { NfeInvoiceAdminActions } from './NfeInvoiceAdminActions';
import { NFeImportView } from './NFeImportView';
import { NFePreparationView } from './NFePreparationView';
import { NFeCountingView } from './NFeCountingView';
import { NFeReportView } from './NFeReportView';
import { formatDate, formatDateTime } from './nfeUi';
import { Button, Input, Notice, Panel, PanelSection, Select } from '../ui';

type View = 'list' | 'import' | 'prep' | 'counting' | 'report';
type ViewMode = 'supervision' | 'stages';

const VIEW_MODE_KEY = 'inventoryblind:nfe:view-mode';

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'stages' ? 'stages' : 'supervision';
  } catch {
    return 'supervision';
  }
}

function saveViewMode(mode: ViewMode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* localStorage indisponível — só a preferência não persiste */ }
}

function viewForStatus(inv: NfeInvoice): View {
  if (inv.status === 'not_started') return 'prep';
  if (inv.status === 'in_progress') return 'counting';
  return 'report';
}

// ── Período (reaproveita a mesma convenção de Rankings/KPIs) ─────────────────

type PeriodFilter = 'all' | '7d' | '30d' | 'this_month';

function resolvePeriodFrom(period: PeriodFilter): string | null {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  if (period === '7d') { const d = new Date(now); d.setDate(d.getDate() - 7); return startOfDay(d); }
  if (period === '30d') { const d = new Date(now); d.setDate(d.getDate() - 30); return startOfDay(d); }
  if (period === 'this_month') return startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  return null;
}

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 'all', label: 'Período' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
];

const STATUS_OPTIONS: { value: 'all' | InvoiceStatus; label: string }[] = [
  { value: 'all', label: 'Status' },
  { value: 'not_started', label: 'Não iniciada' },
  { value: 'in_progress', label: 'Em contagem' },
  { value: 'with_divergences', label: 'Com divergências' },
  { value: 'completed', label: 'Concluída' },
];

function dateToLocalISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "34 min" / "2h" / "3 dias" — sem SLA configurado, é só isso que a tela
 *  mostra (nunca "fora do prazo", nunca um prazo arbitrário). */
function formatElapsed(fromIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(fromIso).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days} dia${days === 1 ? '' : 's'}`;
}

/** Não existe campo de "responsável" no schema — o mais próximo real é quem
 *  iniciou/finalizou a conferência. Nota nunca iniciada não tem responsável. */
function responsavelUserId(inv: NfeInvoice): string | null {
  if (inv.status === 'not_started') return null;
  if (inv.status === 'in_progress') return inv.started_by ?? null;
  return inv.finished_by ?? inv.started_by ?? null;
}

function responsavelName(inv: NfeInvoice, names: Map<string, string | null>): string {
  const id = responsavelUserId(inv);
  if (!id) return 'Não atribuído';
  return names.get(id) ?? 'Não atribuído';
}

/** Rótulo de etapa — cor só no texto (nunca pill grande), vermelho exclusivo
 *  para divergência real. Ícone acompanha o vermelho para não depender só da cor. */
function EtapaLabel({ status }: { status: InvoiceStatus }) {
  if (status === 'with_divergences') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
        <AlertTriangle size={12} />Com divergência
      </span>
    );
  }
  if (status === 'in_progress') return <span className="text-xs font-medium text-accent">Em contagem</span>;
  if (status === 'completed') return <span className="text-xs font-medium text-accent">Concluída</span>;
  return <span className="text-xs font-medium text-fg-subtle">Não iniciada</span>;
}

function railClass(status: InvoiceStatus): string {
  if (status === 'with_divergences') return 'bg-red-500';
  if (status === 'not_started') return 'bg-fg-subtle/50';
  return 'bg-accent';
}

interface TimelineEvent { label: string; at: string | null; pending?: boolean; }

/** Só timestamps reais existentes — evento sem dado não aparece, "Conclusão
 *  pendente" é o único marcador sem horário (é o próprio estado "ainda não"). */
function buildTimeline(inv: NfeInvoice, progress: InvoiceProgress | null): TimelineEvent[] {
  const events: TimelineEvent[] = [{ label: 'NF-e importada', at: inv.created_at }];
  if (inv.started_at) events.push({ label: 'Conferência iniciada', at: inv.started_at });
  if (progress?.lastActivityAt && progress.lastActivityAt !== inv.started_at && !inv.finished_at) {
    events.push({ label: 'Última leitura', at: progress.lastActivityAt });
  }
  if (inv.finished_at) {
    events.push({ label: inv.status === 'with_divergences' ? 'Divergências identificadas' : 'Conferência concluída', at: inv.finished_at });
  } else {
    events.push({ label: 'Conclusão pendente', at: null, pending: true });
  }
  return events;
}

interface Props {
  onBack: () => void;
  /** Id de uma nota recém-transferida pela ferramenta "Consulta e Download de
   *  XML/NFe" — abre direto nela em vez da lista. */
  initialInvoiceId?: string;
  onConsumedInitialInvoice?: () => void;
}

export default function NFeConferencePage({ onBack, initialInvoiceId, onConsumedInitialInvoice }: Props) {
  const [view, setView] = useState<View>('list');
  const [invoices, setInvoices] = useState<NfeInvoice[]>([]);
  const [selected, setSelected] = useState<NfeInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { profile, companyId } = useAuth();
  const canManageRecords = canAdministerRecords(profile?.role);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<NfeInvoice[] | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [responsavelFilter, setResponsavelFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [nameByUserId, setNameByUserId] = useState<Map<string, string | null>>(new Map());
  const [nowTick, setNowTick] = useState(Date.now());

  const [selectedProgress, setSelectedProgress] = useState<InvoiceProgress | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<InvoiceCountEvent[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stageProgress, setStageProgress] = useState<Map<string, InvoiceProgress>>(new Map());

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  const loadArchived = useCallback(async () => {
    setArchivedError(null);
    try {
      setArchived(await listArchivedInvoices());
    } catch (err) {
      // Antes da migration 062 a coluna não existe. Dizer a falha é melhor do
      // que uma lista vazia, que se leria como "nada arquivado".
      setArchivedError(err instanceof Error ? err.message : 'Não foi possível carregar as notas arquivadas.');
      setArchived([]);
    }
  }, []);

  const toggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archived == null) void loadArchived();
  };

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvoices(await listInvoices());
    } catch {
      setError('Não foi possível carregar as conferências.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Contagem real de arquivadas para o botão "Arquivadas N" no cabeçalho —
  // só para quem já tinha essa permissão antes.
  useEffect(() => {
    if (canManageRecords && archived == null) void loadArchived();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageRecords]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Nomes reais (started_by/finished_by → nome) — reaproveita a mesma view já
  // usada em Rankings/KPIs, sem criar consulta nova.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    getTeamProductivity(companyId)
      .then(stats => { if (!cancelled) setNameByUserId(new Map(stats.map(s => [s.user_id, s.name]))); })
      .catch(() => { /* nomes ficam "Não atribuído" — não é crítico para a tela funcionar */ });
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    if (!initialInvoiceId) return;
    let cancelled = false;
    (async () => {
      const inv = await refresh(initialInvoiceId);
      if (!cancelled && inv) {
        setSelected(inv);
        setView(viewForStatus(inv));
      }
      onConsumedInitialInvoice?.();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoiceId]);

  function open(inv: NfeInvoice) {
    setSelected(inv);
    setView(viewForStatus(inv));
  }

  function selectForDetail(inv: NfeInvoice) {
    setSelected(prev => (prev?.id === inv.id ? prev : inv));
  }

  function backToList() {
    setSelected(null);
    setView('list');
    loadList();
  }

  // Progresso real da nota selecionada — só esta consulta extra, disparada
  // pela seleção, nunca para a lista inteira.
  useEffect(() => {
    setHistoryOpen(false);
    setHistoryEvents(null);
    if (!selected) { setSelectedProgress(null); return; }
    let cancelled = false;
    getInvoiceProgress(selected.id)
      .then(p => { if (!cancelled) setSelectedProgress(p); })
      .catch(() => { if (!cancelled) setSelectedProgress(null); });
    return () => { cancelled = true; };
  }, [selected]);

  async function toggleHistory() {
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true);
    if (historyEvents === null && selected) {
      setHistoryLoading(true);
      try { setHistoryEvents(await getInvoiceCountEvents(selected.id)); }
      catch { setHistoryEvents([]); }
      finally { setHistoryLoading(false); }
    }
  }

  const suppliers = useMemo(
    () => Array.from(new Set(invoices.map(i => i.supplier_name).filter((s): s is string => !!s))).sort(),
    [invoices],
  );
  const responsaveis = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach(inv => {
      const id = responsavelUserId(inv);
      if (id) map.set(id, nameByUserId.get(id) ?? id);
    });
    return Array.from(map.entries());
  }, [invoices, nameByUserId]);

  // Uma única filtragem/ordenação — as duas visualizações partem do mesmo
  // array, sem refazer busca nem manter estado duplicado.
  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = resolvePeriodFrom(periodFilter);
    let list = invoices.filter(inv => {
      if (q && !(
        (inv.invoice_number ?? '').toLowerCase().includes(q) ||
        (inv.supplier_name ?? '').toLowerCase().includes(q) ||
        inv.invoice_key.toLowerCase().includes(q)
      )) return false;
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (supplierFilter !== 'all' && inv.supplier_name !== supplierFilter) return false;
      if (responsavelFilter !== 'all' && responsavelUserId(inv) !== responsavelFilter) return false;
      if (from && inv.created_at < from) return false;
      return true;
    });
    list = [...list].sort((a, b) => oldestFirst
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at));
    return list;
  }, [invoices, search, statusFilter, supplierFilter, responsavelFilter, periodFilter, oldestFirst]);

  // Progresso das notas "Em contagem"/"Em revisão" na Visão por Etapas — só
  // este subconjunto pequeno, nunca a fila inteira.
  useEffect(() => {
    if (viewMode !== 'stages') return;
    const targets = filteredSorted.filter(i => i.status === 'in_progress' || i.status === 'with_divergences');
    if (targets.length === 0) { setStageProgress(new Map()); return; }
    let cancelled = false;
    Promise.all(targets.map(inv => getInvoiceProgress(inv.id).then(p => [inv.id, p] as const).catch(() => null)))
      .then(pairs => {
        if (cancelled) return;
        const map = new Map<string, InvoiceProgress>();
        pairs.forEach(p => { if (p) map.set(p[0], p[1]); });
        setStageProgress(map);
      });
    return () => { cancelled = true; };
  }, [viewMode, filteredSorted]);

  if (view === 'import') {
    return (
      <div>
        <TopBar onBack={() => setView('list')} title="Nova conferência" />
        <NFeImportView
          onImported={(inv) => { setSelected(inv); setView('prep'); }}
          onOpenExisting={(inv) => open(inv)}
        />
      </div>
    );
  }

  if (view === 'prep' && selected) {
    return <NFePreparationView invoice={selected} onBack={backToList} onStarted={() => setView('counting')} />;
  }
  if (view === 'counting' && selected) {
    return <NFeCountingView invoice={selected} onBack={backToList} onFinalized={async () => {
      const fresh = await refresh(selected.id);
      setSelected(fresh ?? selected);
      setView('report');
    }} />;
  }
  if (view === 'report' && selected) {
    return <NFeReportView invoice={selected} onBack={backToList} onReopened={() => setView('counting')} />;
  }

  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface border-b border-edge px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="p-1.5 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors flex-shrink-0">
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-title truncate">Conferência Cega por NF-e</h1>
              <p className="text-caption truncate">Supervisão da fila e andamento das conferências</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canManageRecords && (
              <Button variant="ghost" onClick={toggleArchived}>
                <Archive size={16} /> Arquivadas {archived != null && !archivedError ? archived.length : ''}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => changeViewMode(viewMode === 'supervision' ? 'stages' : 'supervision')}
              aria-pressed={viewMode === 'stages'}
            >
              {viewMode === 'supervision' ? <Columns3 size={16} /> : <LayoutList size={16} />}
              <span className="hidden sm:inline">{viewMode === 'supervision' ? 'Visão por etapas' : 'Visão de supervisão'}</span>
            </Button>
            <Button onClick={() => setView('import')}>
              <Plus size={16} /> <span className="hidden sm:inline">Nova conferência</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <div aria-live="polite">
          {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        </div>

        {/* Barra de controles compartilhada — mesma busca/filtros/ordenação para as duas visualizações */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            icon={<Search size={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar NF-e, fornecedor ou chave"
            aria-label="Buscar NF-e, fornecedor ou chave"
            className="flex-1 min-w-[220px]"
          />
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | InvoiceStatus)} aria-label="Filtrar por status">
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} aria-label="Filtrar por fornecedor">
            <option value="all">Fornecedor</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select value={responsavelFilter} onChange={e => setResponsavelFilter(e.target.value)} aria-label="Filtrar por responsável">
            <option value="all">Responsável</option>
            {responsaveis.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
          <Select value={periodFilter} onChange={e => setPeriodFilter(e.target.value as PeriodFilter)} aria-label="Filtrar por período">
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={oldestFirst ? 'oldest' : 'recent'} onChange={e => setOldestFirst(e.target.value === 'oldest')} aria-label="Ordenar">
            <option value="recent">Mais recentes primeiro</option>
            <option value="oldest">Mais antigas primeiro</option>
          </Select>
        </div>

        {error && (
          <Notice tone="danger">
            <span className="flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error}
            </span>
          </Notice>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-fg-subtle"><Loader2 size={28} className="animate-spin" /></div>
        ) : filteredSorted.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={36} className="mx-auto text-fg-subtle" />
            <p className="mt-3 text-sm text-fg-muted">
              {invoices.length === 0 ? 'Nenhuma conferência ainda. Clique em "Nova conferência" para começar.' : 'Nenhuma conferência encontrada para os filtros atuais.'}
            </p>
          </div>
        ) : viewMode === 'supervision' ? (
          <SupervisionView
            invoices={filteredSorted}
            selected={selected}
            onSelect={selectForDetail}
            onOpen={open}
            onBackMobile={() => setSelected(null)}
            nameByUserId={nameByUserId}
            nowTick={nowTick}
            canManageRecords={canManageRecords}
            onAdminDone={(message) => { setNotice(message); loadList(); }}
            progress={selectedProgress}
            historyOpen={historyOpen}
            historyEvents={historyEvents}
            historyLoading={historyLoading}
            onToggleHistory={toggleHistory}
          />
        ) : (
          <StagesView
            invoices={filteredSorted}
            onOpen={open}
            nameByUserId={nameByUserId}
            progressByInvoice={stageProgress}
            nowTick={nowTick}
          />
        )}

        {canManageRecords && showArchived && (
          <div className="space-y-2 pt-2">
            <h2 className="text-sm font-semibold text-fg">Notas arquivadas</h2>
            <p className="text-caption">
              Removidas da lista, mas nada foi apagado: XML, itens e eventos de contagem continuam
              guardados. Restaurar devolve a nota à lista acima.
            </p>
            {archivedError && <p className="text-sm text-red-600 dark:text-red-400">{archivedError}</p>}
            {archived == null && !archivedError && <p className="text-caption">Carregando…</p>}
            {archived != null && archived.length === 0 && !archivedError && (
              <p className="text-caption">Nenhuma nota arquivada.</p>
            )}
            {(archived ?? []).map((inv) => (
              <div
                key={inv.id}
                className="w-full flex items-center gap-3 bg-surface-2 rounded-container border border-edge p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-fg text-sm">NF {inv.invoice_number ?? '—'}</span>
                    <span className="text-fg-subtle">·</span>
                    <span className="text-sm text-fg-muted truncate">{inv.supplier_name ?? 'Fornecedor não informado'}</span>
                  </div>
                  <p className="text-caption mt-0.5">
                    {inv.total_items} item(ns) · Motivo: {inv.deletion_reason ?? '—'}
                  </p>
                </div>
                <EtapaLabel status={inv.status} />
                <NfeInvoiceAdminActions
                  invoice={inv}
                  mode="archived"
                  onDone={(message) => { setNotice(message); loadList(); loadArchived(); }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function refresh(id: string): Promise<NfeInvoice | null> {
  const { getInvoice } = await import('../../lib/nfe/nfeService');
  return getInvoice(id);
}

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="sticky top-0 z-10 bg-surface border-b border-edge px-4 sm:px-6 py-3 flex items-center gap-3">
      <button onClick={onBack} className="p-1.5 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors">
        <ArrowLeft size={18} />
      </button>
      <h1 className="text-title">{title}</h1>
    </div>
  );
}

// ── Visualização "Supervisão" ────────────────────────────────────────────────

interface SupervisionViewProps {
  invoices: NfeInvoice[];
  selected: NfeInvoice | null;
  onSelect: (inv: NfeInvoice) => void;
  onOpen: (inv: NfeInvoice) => void;
  onBackMobile: () => void;
  nameByUserId: Map<string, string | null>;
  nowTick: number;
  canManageRecords: boolean;
  onAdminDone: (message: string) => void;
  progress: InvoiceProgress | null;
  historyOpen: boolean;
  historyEvents: InvoiceCountEvent[] | null;
  historyLoading: boolean;
  onToggleHistory: () => void;
}

function SupervisionView({
  invoices, selected, onSelect, onOpen, onBackMobile, nameByUserId, nowTick,
  canManageRecords, onAdminDone, progress, historyOpen, historyEvents, historyLoading, onToggleHistory,
}: SupervisionViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[52fr_48fr] gap-4 items-start">
      <Panel className={selected ? 'hidden lg:block' : ''}>
        <PanelSection padding="sm"><h2 className="text-title">Fila de Conferência</h2></PanelSection>
        <div className="divide-y divide-edge/60 max-h-[70vh] overflow-y-auto">
          {invoices.map(inv => (
            <FilaRow
              key={inv.id}
              inv={inv}
              isSelected={selected?.id === inv.id}
              onSelect={() => onSelect(inv)}
              onOpen={() => onOpen(inv)}
              responsavel={responsavelName(inv, nameByUserId)}
              nowTick={nowTick}
              canManageRecords={canManageRecords}
              onAdminDone={onAdminDone}
            />
          ))}
        </div>
      </Panel>

      <div className={selected ? '' : 'hidden lg:block'}>
        {selected ? (
          <DetailPanel
            invoice={selected}
            onBackMobile={onBackMobile}
            onOpen={() => onOpen(selected)}
            responsavel={responsavelName(selected, nameByUserId)}
            nowTick={nowTick}
            canManageRecords={canManageRecords}
            onAdminDone={onAdminDone}
            progress={progress}
            historyOpen={historyOpen}
            historyEvents={historyEvents}
            historyLoading={historyLoading}
            onToggleHistory={onToggleHistory}
          />
        ) : (
          <Panel>
            <PanelSection className="text-center py-16 text-fg-subtle">
              <FileText size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Selecione uma NF-e na fila para ver os detalhes.</p>
            </PanelSection>
          </Panel>
        )}
      </div>
    </div>
  );
}

interface FilaRowProps {
  inv: NfeInvoice;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  responsavel: string;
  nowTick: number;
  canManageRecords: boolean;
  onAdminDone: (message: string) => void;
}

function FilaRow({ inv, isSelected, onSelect, onOpen, responsavel, nowTick, canManageRecords, onAdminDone }: FilaRowProps) {
  return (
    <div
      aria-current={isSelected ? 'true' : undefined}
      className={`flex items-stretch gap-2 transition-colors ${isSelected ? 'bg-accent/5' : 'hover:bg-surface-3/40'}`}
    >
      <span className={`w-[3px] flex-shrink-0 ${isSelected ? 'bg-accent' : 'bg-transparent'}`} />
      <button onClick={onSelect} className="flex-1 min-w-0 text-left px-3 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-fg text-sm">NF {inv.invoice_number ?? '—'}</span>
          <span className="text-fg-subtle">·</span>
          <span className="text-sm text-fg-muted truncate">{inv.supplier_name ?? 'Fornecedor não informado'}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-fg-subtle">
          <span>{inv.total_items} item(ns)</span>
          <span>·</span>
          <EtapaLabel status={inv.status} />
          <span>·</span>
          <span>{responsavel}</span>
          <span>·</span>
          <span>{formatElapsed(inv.started_at ?? inv.created_at, nowTick)}</span>
        </div>
      </button>
      <div className="flex items-center gap-1 pr-2">
        {canManageRecords && <NfeInvoiceAdminActions invoice={inv} onDone={onAdminDone} />}
        <button onClick={onOpen} className="p-1.5 text-fg-subtle hover:text-fg" aria-label={`Abrir NF ${inv.invoice_number ?? ''}`}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

interface DetailPanelProps {
  invoice: NfeInvoice;
  onBackMobile: () => void;
  onOpen: () => void;
  responsavel: string;
  nowTick: number;
  canManageRecords: boolean;
  onAdminDone: (message: string) => void;
  progress: InvoiceProgress | null;
  historyOpen: boolean;
  historyEvents: InvoiceCountEvent[] | null;
  historyLoading: boolean;
  onToggleHistory: () => void;
}

function DetailPanel({
  invoice, onBackMobile, onOpen, responsavel, nowTick, canManageRecords, onAdminDone,
  progress, historyOpen, historyEvents, historyLoading, onToggleHistory,
}: DetailPanelProps) {
  const timeline = buildTimeline(invoice, progress);
  const actionLabel = invoice.status === 'not_started' ? 'Iniciar conferência'
    : invoice.status === 'in_progress' ? 'Continuar conferência'
    : invoice.status === 'with_divergences' ? 'Revisar divergências'
    : 'Ver relatório';

  return (
    <Panel>
      <PanelSection padding="sm" className="space-y-3">
        <button onClick={onBackMobile} className="lg:hidden flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-1">
          <ArrowLeft size={14} /> Voltar à fila
        </button>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-title truncate">NF {invoice.invoice_number ?? '—'}</h2>
              <EtapaLabel status={invoice.status} />
            </div>
            <p className="text-sm text-fg-muted truncate">{invoice.supplier_name ?? 'Fornecedor não informado'}</p>
          </div>
          {canManageRecords && <NfeInvoiceAdminActions invoice={invoice} onDone={onAdminDone} />}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-caption">Emissão</p>
            <p className="text-fg font-medium">{formatDate(invoice.issue_date)}</p>
          </div>
          <div>
            <p className="text-caption">Importação</p>
            <p className="text-fg font-medium">{formatDateTime(invoice.created_at)}</p>
          </div>
          <div>
            <p className="text-caption">Responsável</p>
            <p className="text-fg font-medium truncate">{responsavel}</p>
          </div>
          <div>
            <p className="text-caption">Tempo decorrido</p>
            <p className="text-fg font-medium">{formatElapsed(invoice.started_at ?? invoice.created_at, nowTick)}</p>
          </div>
        </div>
      </PanelSection>

      <PanelSection>
        <div className="flex items-start gap-3 rounded-container border border-edge bg-surface-2 p-3">
          <Lock size={18} className="text-fg-subtle flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-fg">Contagem cega ativa</p>
            <p className="text-xs text-fg-subtle mt-0.5">Quantidades fiscais protegidas até a conclusão.</p>
          </div>
        </div>
      </PanelSection>

      {progress && progress.totalLines > 0 && !invoice.finished_at && (
        <PanelSection className="space-y-2">
          <p className="text-label">Andamento</p>
          <p className="text-sm text-fg">{progress.countedLines} de {progress.totalLines} linhas conferidas</p>
          <div className="h-1.5 rounded-full bg-surface-3">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (progress.countedLines / progress.totalLines) * 100)}%` }} />
          </div>
        </PanelSection>
      )}

      <PanelSection className="space-y-1">
        <p className="text-label mb-2">Linha do Tempo</p>
        <div className="pl-1">
          {timeline.map((e, i) => (
            <div key={i} className="relative pl-5 pb-4 last:pb-0">
              {i < timeline.length - 1 && <span className="absolute left-[3px] top-2.5 bottom-0 w-px bg-edge" />}
              <span className={`absolute left-0 top-1 h-2 w-2 rounded-full ${e.pending ? 'border border-fg-subtle bg-surface' : 'bg-accent'}`} />
              <p className={`text-sm ${e.pending ? 'text-fg-subtle' : 'text-fg'}`}>{e.label}</p>
              {e.at && <p className="text-xs text-fg-subtle mt-0.5">{formatDateTime(e.at)}</p>}
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection className="space-y-3">
        <p className="text-label">Próxima ação</p>
        <Button onClick={onOpen}>{actionLabel}</Button>

        {invoice.started_at && (
          <button
            onClick={onToggleHistory}
            className="flex items-center gap-1.5 text-sm text-accent hover:text-accent-strong"
          >
            <History size={14} />
            Ver histórico completo
          </button>
        )}
        {historyOpen && (
          <div className="rounded-container border border-edge divide-y divide-edge/60 max-h-64 overflow-y-auto">
            {historyLoading ? (
              <p className="p-3 text-sm text-fg-subtle">Carregando…</p>
            ) : historyEvents == null || historyEvents.length === 0 ? (
              <p className="p-3 text-sm text-fg-subtle">Nenhum evento de contagem registrado.</p>
            ) : historyEvents.map(ev => (
              <div key={ev.id} className="p-2.5 text-xs flex items-center justify-between gap-2">
                <span className="text-fg-muted truncate">{ev.sku ?? ev.ean ?? '—'}</span>
                <span className="tabular-nums text-fg">{ev.delta >= 0 ? '+' : ''}{ev.delta} → {ev.resulting_quantity}</span>
                <span className="text-fg-subtle whitespace-nowrap">{formatDateTime(ev.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}

// ── Visualização "Etapas" ────────────────────────────────────────────────────

interface StagesViewProps {
  invoices: NfeInvoice[];
  onOpen: (inv: NfeInvoice) => void;
  nameByUserId: Map<string, string | null>;
  progressByInvoice: Map<string, InvoiceProgress>;
  nowTick: number;
}

function StagesView({ invoices, onOpen, nameByUserId, progressByInvoice, nowTick }: StagesViewProps) {
  const today = dateToLocalISO(new Date());

  const columns: { key: string; title: string; items: NfeInvoice[] }[] = [
    { key: 'aguardando', title: 'Aguardando início', items: invoices.filter(i => i.status === 'not_started') },
    { key: 'em_contagem', title: 'Em contagem', items: invoices.filter(i => i.status === 'in_progress') },
    { key: 'em_revisao', title: 'Em revisão', items: invoices.filter(i => i.status === 'with_divergences') },
    {
      key: 'concluidas',
      title: 'Concluídas hoje',
      items: invoices.filter(i => i.status === 'completed' && i.finished_at && dateToLocalISO(new Date(i.finished_at)) === today),
    },
  ];

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
      {columns.map(col => (
        <div key={col.key} className="flex-shrink-0 w-[85vw] sm:w-80 lg:w-0 lg:flex-1">
          <div className="flex items-center gap-2 mb-2 px-1">
            <h3 className="text-sm font-semibold text-fg">{col.title}</h3>
            <span className="text-xs text-fg-subtle tabular-nums">{col.items.length}</span>
          </div>
          <div className="space-y-2">
            {col.items.length === 0 ? (
              <p className="text-xs text-fg-subtle px-1 py-3">Nenhuma nota nesta etapa.</p>
            ) : col.items.map(inv => (
              <StageCard
                key={inv.id}
                inv={inv}
                onOpen={() => onOpen(inv)}
                responsavel={responsavelName(inv, nameByUserId)}
                progress={progressByInvoice.get(inv.id) ?? null}
                nowTick={nowTick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StageCard({ inv, onOpen, responsavel, progress, nowTick }: {
  inv: NfeInvoice; onOpen: () => void; responsavel: string; progress: InvoiceProgress | null; nowTick: number;
}) {
  const actionLabel = inv.status === 'not_started' ? 'Iniciar'
    : inv.status === 'in_progress' ? 'Continuar'
    : inv.status === 'with_divergences' ? 'Revisar'
    : null;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-surface-2 border border-edge rounded-container overflow-hidden hover:border-accent/40 transition-colors"
    >
      <div className={`h-1 ${railClass(inv.status)}`} />
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-fg text-sm">NF {inv.invoice_number ?? '—'}</span>
          {inv.status === 'with_divergences' && progress && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <AlertTriangle size={11} />{progress.divergentLines} divergência{progress.divergentLines === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="text-xs text-fg-muted truncate">{inv.supplier_name ?? 'Fornecedor não informado'}</p>
        <p className="text-xs text-fg-subtle">{inv.total_items} item(ns) · Importada {formatDate(inv.created_at)}</p>
        <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
          <span className="truncate">{responsavel}</span>
          <span className="flex-shrink-0">{formatElapsed(inv.started_at ?? inv.created_at, nowTick)}</span>
        </div>

        {inv.status === 'in_progress' && progress && progress.totalLines > 0 && (
          <div className="pt-1 space-y-1">
            <div className="h-1 rounded-full bg-surface-3">
              <div className="h-1 rounded-full bg-accent" style={{ width: `${Math.min(100, (progress.countedLines / progress.totalLines) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-fg-subtle">{progress.countedLines} de {progress.totalLines} linhas</p>
          </div>
        )}

        {actionLabel && (
          <p className="pt-1 text-xs font-semibold text-accent flex items-center gap-1">{actionLabel} <ChevronRight size={12} /></p>
        )}
      </div>
    </button>
  );
}
