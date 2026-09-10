import { useRef, useState } from 'react';
import { Upload, ClipboardPaste, Loader2, AlertCircle, FileText, ArrowRight, Eye } from 'lucide-react';
import { importNfeXml, NfeImportError } from '../../lib/nfe/nfeService';
import type { NfeInvoice } from '../../lib/nfe/nfeTypes';
import { InvoiceStatusBadge, formatDate } from './nfeUi';
import { Card, Button } from '../ui';

interface Props {
  onImported: (invoice: NfeInvoice) => void;
  onOpenExisting: (invoice: NfeInvoice) => void;
}

export function NFeImportView({ onImported, onOpenExisting }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<NfeInvoice | null>(null);

  async function runImport(xml: string) {
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const { invoice } = await importNfeXml(xml);
      onImported(invoice);
    } catch (e) {
      if (e instanceof NfeImportError && e.existing) {
        setDuplicate(e.existing);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Não foi possível importar a NF-e.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    const text = await file.text();
    await runImport(text);
  }

  const canResume = duplicate && (duplicate.status === 'not_started' || duplicate.status === 'in_progress');

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 lg:p-8 space-y-8">
      <div>
        <h2 className="text-title">Importar NF-e</h2>
        <p className="text-sm text-fg-subtle mt-1">
          Envie o arquivo XML da nota fiscal ou cole o conteúdo. A conferência será cega: as quantidades da nota ficam ocultas até a finalização.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {duplicate && (
        <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-4">
          <div className="flex items-start gap-3 text-amber-700 dark:text-amber-400">
            <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Esta NF-e já foi importada.</p>
              <p className="text-xs mt-1 text-amber-700/80 dark:text-amber-400/80">
                Nota {duplicate.invoice_number ?? '—'} · {duplicate.supplier_name ?? 'Fornecedor não informado'} · {formatDate(duplicate.issue_date)}
              </p>
            </div>
            <div className="ml-auto"><InvoiceStatusBadge status={duplicate.status} /></div>
          </div>
          <Button onClick={() => onOpenExisting(duplicate)}>
            {canResume ? <><ArrowRight size={15} /> Continuar conferência</> : <><Eye size={15} /> Visualizar relatório</>}
          </Button>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 p-8 rounded-container border-2 border-dashed border-edge hover:border-accent/40 hover:bg-accent/5 transition-colors disabled:opacity-50"
        >
          <div className="p-3 rounded-xl bg-accent/10 text-accent"><Upload size={24} /></div>
          <span className="text-sm font-semibold text-fg">Selecionar arquivo XML</span>
          <span className="text-xs text-fg-subtle">Formato aceito: .xml</span>
        </button>

        <Card className="flex flex-col">
          <label className="flex items-center gap-2 text-sm font-semibold text-fg mb-2">
            <ClipboardPaste size={16} className="text-fg-subtle" /> Colar XML
          </label>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Cole aqui o conteúdo do XML da NF-e..."
            className="flex-1 min-h-[120px] resize-none rounded-lg border border-edge bg-surface p-3 text-xs font-mono text-fg-muted placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button
            disabled={busy || pasted.trim() === ''}
            onClick={() => runImport(pasted)}
            className="mt-3 w-full"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            Importar da área de transferência
          </Button>
        </Card>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      {busy && (
        <div className="flex items-center justify-center gap-2 text-fg-subtle text-sm">
          <Loader2 size={16} className="animate-spin" /> Processando NF-e...
        </div>
      )}
    </div>
  );
}
