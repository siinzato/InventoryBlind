import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Plus, Loader2, FileText, Search, ChevronRight, AlertCircle, Archive,
} from 'lucide-react';
import type { NfeInvoice } from '../../lib/nfe/nfeTypes';
import { listArchivedInvoices, listInvoices } from '../../lib/nfe/nfeService';
import { canAdministerRecords } from '../../lib/admin/recordAdmin';
import { useAuth } from '../../lib/auth';
import { NfeInvoiceAdminActions } from './NfeInvoiceAdminActions';
import { NFeImportView } from './NFeImportView';
import { NFePreparationView } from './NFePreparationView';
import { NFeCountingView } from './NFeCountingView';
import { NFeReportView } from './NFeReportView';
import { InvoiceStatusBadge, formatDate } from './nfeUi';
import { Button } from '../ui';

type View = 'list' | 'import' | 'prep' | 'counting' | 'report';

function viewForStatus(inv: NfeInvoice): View {
  if (inv.status === 'not_started') return 'prep';
  if (inv.status === 'in_progress') return 'counting';
  return 'report';
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
  // Controles administrativos (owner/admin). A autorização real está nas RPCs
  // nfe_admin_*; isto só decide o que a tela mostra.
  const { profile } = useAuth();
  const canManageRecords = canAdministerRecords(profile?.role);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<NfeInvoice[] | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);

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

  function backToList() {
    setSelected(null);
    setView('list');
    loadList();
  }

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

  const filtered = invoices.filter((inv) => {
    const q = search.trim().toLowerCase();
    if (q === '') return true;
    return (
      (inv.invoice_number ?? '').toLowerCase().includes(q) ||
      (inv.supplier_name ?? '').toLowerCase().includes(q) ||
      inv.invoice_key.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <TopBar onBack={onBack} title="Conferência Cega por NF-e" />
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">Importe uma NF-e e realize a contagem cega dos itens recebidos.</p>
          <div className="flex items-center gap-2">
            {canManageRecords && (
              <Button variant="ghost" onClick={toggleArchived}>
                <Archive size={16} /> {showArchived ? 'Ocultar arquivadas' : 'Ver arquivadas'}
              </Button>
            )}
            <Button onClick={() => setView('import')}>
              <Plus size={16} /> Nova conferência
            </Button>
          </div>
        </div>

        <div aria-live="polite">
          {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, fornecedor ou chave..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-edge bg-surface text-fg placeholder-fg-subtle text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {error && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 text-red-700 dark:text-red-400">
            <AlertCircle size={20} className="flex-shrink-0 mt-0.5" /><p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-fg-subtle"><Loader2 size={28} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={36} className="mx-auto text-fg-subtle" />
            <p className="mt-3 text-sm text-fg-muted">Nenhuma conferência ainda. Clique em "Nova conferência" para começar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((inv) => (
              // A linha era um único <button>. Virou <div> com o botão por
              // dentro porque o menu administrativo é um botão, e botão dentro
              // de botão é HTML inválido. As classes de fundo/borda/hover foram
              // para o <div>, então a aparência é a mesma de antes.
              <div
                key={inv.id}
                className="w-full flex items-center gap-3 bg-surface-2 rounded-xl border border-edge p-4 hover:bg-surface-3/40 transition-colors"
              >
                <button onClick={() => open(inv)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-fg text-sm">NF {inv.invoice_number ?? '—'}</span>
                      <span className="text-fg-subtle">·</span>
                      <span className="text-sm text-fg-muted truncate">{inv.supplier_name ?? 'Fornecedor não informado'}</span>
                    </div>
                    <p className="text-caption mt-0.5">
                      {inv.total_items} item(ns) · Emissão {formatDate(inv.issue_date)} · Importada {formatDate(inv.created_at)}
                    </p>
                  </div>
                  <InvoiceStatusBadge status={inv.status} />
                  <ChevronRight size={18} className="text-fg-subtle flex-shrink-0" />
                </button>
                {canManageRecords && (
                  <NfeInvoiceAdminActions
                    invoice={inv}
                    onDone={(message) => { setNotice(message); loadList(); }}
                  />
                )}
              </div>
            ))}
          </div>
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
                className="w-full flex items-center gap-3 bg-surface-2 rounded-xl border border-edge p-4"
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
                <InvoiceStatusBadge status={inv.status} />
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
      <button onClick={onBack} className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors">
        <ArrowLeft size={18} />
      </button>
      <h1 className="text-title">{title}</h1>
    </div>
  );
}
