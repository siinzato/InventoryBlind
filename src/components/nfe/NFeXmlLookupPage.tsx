import { useState } from 'react';
import { ArrowLeft, KeyRound, Search, Loader2, AlertCircle, ArrowRight, Eye } from 'lucide-react';
import { fetchAndImportNfeByKey, isValidNfeAccessKey, NfeFetchByKeyError } from '../../lib/nfe/nfeProviderFetch';
import type { NfeInvoice } from '../../lib/nfe/nfeTypes';
import { InvoiceStatusBadge, formatDate } from './nfeUi';
import { Card, Button } from '../ui';

interface Props {
  onBack: () => void;
  onTransferToConference: (invoiceId: string) => void;
}

function downloadInvoiceXml(invoice: NfeInvoice) {
  const xml = invoice.raw_xml;
  if (!xml) return;
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NFe-${invoice.invoice_number ?? invoice.invoice_key}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function NFeXmlLookupPage({ onBack, onTransferToConference }: Props) {
  const [accessKey, setAccessKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<NfeInvoice | null>(null);

  async function runLookup() {
    setBusy(true);
    setError(null);
    setDuplicate(null);
    setStatus('Consultando a NF-e no provedor...');
    try {
      const { invoice } = await fetchAndImportNfeByKey(accessKey, (attempt, max) => {
        if (attempt > 1) setStatus(`Aguardando o provedor... (tentativa ${attempt} de ${max})`);
      });
      downloadInvoiceXml(invoice);
      setStatus('Nota encontrada. Transferindo para a Conferência por NF-e...');
      await sleep(700);
      onTransferToConference(invoice.id);
    } catch (e) {
      if (e instanceof NfeFetchByKeyError && e.existing) {
        setDuplicate(e.existing);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Não foi possível consultar a NF-e.');
      }
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface border-b border-edge px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-title">Consulta e Download de XML/NFe</h1>
      </div>

      <div className="max-w-2xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <p className="text-sm text-fg-subtle">
          Cole a chave de acesso de 44 dígitos da NF-e para buscar automaticamente no provedor. O XML é baixado
          e a nota é transferida direto para a Conferência por NF-e, sem precisar do arquivo manualmente.
        </p>

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
            <Button onClick={() => onTransferToConference(duplicate.id)}>
              {duplicate.status === 'not_started' || duplicate.status === 'in_progress'
                ? <><ArrowRight size={15} /> Continuar conferência</>
                : <><Eye size={15} /> Visualizar relatório</>}
            </Button>
          </div>
        )}

        <Card className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound size={16} className="text-fg-subtle" /> Chave de acesso da NF-e
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value.replace(/\D/g, '').slice(0, 44))}
              placeholder="Chave de acesso (44 dígitos)"
              inputMode="numeric"
              disabled={busy}
              className="flex-1 rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-mono text-fg placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
            />
            <Button disabled={busy || !isValidNfeAccessKey(accessKey)} onClick={runLookup}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Buscar nota
            </Button>
          </div>
          {accessKey.length > 0 && accessKey.length !== 44 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {accessKey.length}/44 dígitos — a chave de acesso precisa ter exatamente 44 dígitos.
            </p>
          )}
        </Card>

        {busy && status && (
          <div className="flex items-center justify-center gap-2 text-fg-subtle text-sm">
            <Loader2 size={16} className="animate-spin" /> {status}
          </div>
        )}
      </div>
    </div>
  );
}
