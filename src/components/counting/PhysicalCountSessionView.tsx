import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Search, X, CloudOff, MapPinOff } from 'lucide-react';
import { Button, Input } from '../ui';
import { useAuth } from '../../lib/auth';
import { describeLocation } from '../../lib/physicalCount/locationAddressing';
import {
  finalizeSession,
  flagFoundElsewhere,
  flushPendingCounts,
  getBlindItems,
  registerCount,
} from '../../lib/physicalCount/physicalCountService';
import { pendingCount } from '../../lib/physicalCount/offlineQueue';
import { logAuditEvent } from '../../lib/auditLogService';
import { recomputeForProducts } from '../../lib/cbcService';
import { recomputeRiskForProducts } from '../../lib/riskService';
import { recomputeAbcXyzForCompany } from '../../lib/abcXyzService';

type BlindItem = {
  id: string;
  sessionId: string;
  productId: string;
  sku: string | null;
  ean: string | null;
  location: string | null;
  physicalQuantity: number | null;
  foundLocation: string | null;
  foundElsewhereQuantity: number;
  productName: string | null;
};

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

interface PhysicalCountSessionViewProps {
  sessionId: string;
  companyId: string;
  onDone: () => void;
}

export function PhysicalCountSessionView({ sessionId, companyId, onDone }: PhysicalCountSessionViewProps) {
  const { profile } = useAuth();
  const [items, setItems] = useState<BlindItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [manualInput, setManualInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [foundElsewhereOpen, setFoundElsewhereOpen] = useState(false);
  const [foundElsewhereInput, setFoundElsewhereInput] = useState('');
  const [foundElsewhereQtyInput, setFoundElsewhereQtyInput] = useState('');
  const [flaggingFoundElsewhere, setFlaggingFoundElsewhere] = useState(false);

  useEffect(() => {
    setFoundElsewhereOpen(false);
    setFoundElsewhereInput('');
    setFoundElsewhereQtyInput('');
  }, [currentIndex]);

  useEffect(() => {
    getBlindItems(sessionId)
      .then(rows => setItems(rows))
      .catch(err => setError(err instanceof Error ? err.message : 'Falha ao carregar os itens.'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    setPending(pendingCount(companyId));
    const flush = () => flushPendingCounts(companyId).then(({ stillPending }) => setPending(stillPending));
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [companyId]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return items.filter(
      i =>
        (i.sku ?? '').toLowerCase().includes(q) ||
        (i.ean ?? '').toLowerCase() === q ||
        (i.ean ?? '').toLowerCase().includes(q) ||
        (i.productName ?? '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const current = items[currentIndex] as BlindItem | undefined;
  const countedItems = items.filter(i => i.physicalQuantity !== null || i.foundElsewhereQuantity > 0).length;

  const applyLocalResult = (itemId: string, resulting: number) => {
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, physicalQuantity: resulting } : i)));
  };

  const handleQuickAdd = async (amount: number) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resulting = await registerCount({
        companyId,
        itemId: current.id,
        mode: 'increment',
        quantity: amount,
        source: 'manual',
        idempotencyKey: crypto.randomUUID(),
      });
      applyLocalResult(current.id, resulting);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar a contagem — mantida na fila local.');
      setPending(pendingCount(companyId));
    } finally {
      setBusy(false);
    }
  };

  const handleManualApply = async () => {
    if (!current || busy) return;
    const quantity = Number(manualInput.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity < 0) return;
    setBusy(true);
    setError(null);
    try {
      const resulting = await registerCount({
        companyId,
        itemId: current.id,
        mode: 'set',
        quantity,
        source: 'manual',
        idempotencyKey: crypto.randomUUID(),
      });
      applyLocalResult(current.id, resulting);
      setManualInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar a contagem — mantida na fila local.');
      setPending(pendingCount(companyId));
    } finally {
      setBusy(false);
    }
  };

  const handleFlagFoundElsewhere = async () => {
    if (!current || !foundElsewhereInput.trim() || flaggingFoundElsewhere) return;
    const quantity = Number(foundElsewhereQtyInput.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity < 0) return;
    setFlaggingFoundElsewhere(true);
    setError(null);
    try {
      const foundLocation = foundElsewhereInput.trim();
      await flagFoundElsewhere({ itemId: current.id, foundLocation, quantity, idempotencyKey: crypto.randomUUID() });
      setItems(prev => prev.map(i => (i.id === current.id ? { ...i, foundLocation, foundElsewhereQuantity: quantity } : i)));
      setFoundElsewhereInput('');
      setFoundElsewhereQtyInput('');
      setFoundElsewhereOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar o local encontrado.');
    } finally {
      setFlaggingFoundElsewhere(false);
    }
  };

  const jumpToItem = (itemId: string) => {
    const idx = items.findIndex(i => i.id === itemId);
    if (idx >= 0) {
      setCurrentIndex(idx);
      setSearch('');
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const q = search.trim().toLowerCase();
    const exactEan = items.find(i => (i.ean ?? '').toLowerCase() === q);
    if (exactEan) jumpToItem(exactEan.id);
    else if (searchResults.length > 0) jumpToItem(searchResults[0].id);
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      await finalizeSession(sessionId);
      if (profile) {
        logAuditEvent({
          companyId,
          userId: profile.id,
          userEmail: profile.email ?? '',
          action: 'physical_count.finalized',
          resourceType: 'physical_count_session',
          resourceId: sessionId,
        });
      }
      const productIds = items.map(i => i.productId);
      recomputeForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
      recomputeRiskForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
      recomputeAbcXyzForCompany(companyId, profile?.id, profile?.email ?? undefined);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível finalizar a contagem.');
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-surface">
        <p className="text-sm text-fg-muted">Carregando itens da contagem…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3 sm:px-6">
        <button onClick={onDone} className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition-colors">
          <X size={18} /> Sair
        </button>
        <div className="text-sm font-medium text-fg">
          Item {items.length === 0 ? 0 : currentIndex + 1} de {items.length} · {countedItems} contados · {items.length - countedItems} pendentes
        </div>
        {pending > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <CloudOff size={14} /> {pending} pendente(s) de sincronização
          </div>
        )}
      </div>

      <div className="border-b border-edge px-4 py-2.5 sm:px-6">
        <Input
          icon={<Search />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          autoFocus
          placeholder="Buscar ou escanear por SKU, EAN ou nome…"
          aria-label="Buscar ou escanear item"
        />
        {search && searchResults.length > 0 && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-control border border-edge bg-surface-2">
            {searchResults.slice(0, 8).map(r => (
              <button
                key={r.id}
                onClick={() => jumpToItem(r.id)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-fg">{r.productName ?? r.sku}</span>
                  {r.productName && <span className="block truncate text-xs text-fg-subtle">{r.sku}</span>}
                </span>
                <span className="shrink-0 text-fg-muted text-xs">{describeLocation(r.location)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {!current ? (
          <p className="text-center text-sm text-fg-muted">Nenhum item nesta sessão.</p>
        ) : (
          <div className="mx-auto max-w-xl space-y-6">
            <div className="rounded-container border border-edge bg-surface-2 p-6 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{describeLocation(current.location)}</p>
              <p className="mt-2 text-lg font-semibold text-fg">{current.productName ?? current.sku}</p>
              <p className="text-sm text-fg-muted">
                {current.productName ? current.sku : null}
                {current.ean ? `${current.productName ? ' · ' : ''}EAN ${current.ean}` : ''}
              </p>

              {/* Large figures are functional here: the operator reads them
                  standing at the shelf, at arm's length. Weight follows the type
                  scale (font-display + semibold) instead of raw font-bold. */}
              <div className="mt-6 grid grid-cols-2 divide-x divide-edge">
                <div>
                  <p className="text-label">Quantidade no local</p>
                  <p className="font-display text-4xl font-semibold tracking-tight text-fg tabular-nums">{current.physicalQuantity ?? 0}</p>
                </div>
                <div className="pl-4">
                  <p className="text-label">Excedente em outro local</p>
                  <p
                    className={`font-display text-4xl font-semibold tracking-tight tabular-nums ${
                      current.foundElsewhereQuantity > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-fg-subtle'
                    }`}
                  >
                    {current.foundElsewhereQuantity}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-edge pt-4">
                {current.foundLocation ? (
                  <button
                    onClick={() => {
                      setFoundElsewhereInput(current.foundLocation ?? '');
                      setFoundElsewhereQtyInput(String(current.foundElsewhereQuantity));
                      setFoundElsewhereOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    <MapPinOff size={13} /> {current.foundElsewhereQuantity} un. em {current.foundLocation} — editar
                  </button>
                ) : foundElsewhereOpen ? (
                  <div className="space-y-2">
                    <Input
                      value={foundElsewhereInput}
                      onChange={e => setFoundElsewhereInput(e.target.value)}
                      autoFocus
                      placeholder="Local onde foi encontrado"
                      aria-label="Local onde foi encontrado"
                    />
                    <div className="flex gap-2">
                      <Input
                        value={foundElsewhereQtyInput}
                        onChange={e => setFoundElsewhereQtyInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleFlagFoundElsewhere()}
                        inputMode="decimal"
                        placeholder="Quantidade"
                        aria-label="Quantidade encontrada em outro local"
                        className="w-28 tabular-nums"
                      />
                      <Button
                        variant="secondary"
                        disabled={flaggingFoundElsewhere || !foundElsewhereInput.trim() || foundElsewhereQtyInput === ''}
                        onClick={handleFlagFoundElsewhere}
                        className="flex-1"
                      >
                        Confirmar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setFoundElsewhereOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
                  >
                    <MapPinOff size={13} /> Encontrado em local diferente do esperado?
                  </button>
                )}
              </div>
            </div>

            <p className="text-section">Adicionar à quantidade no local</p>

            {/* Deliberately oversized for gloved, one-handed tablet use — well
                above the 44px floor. */}
            <div className="grid grid-cols-3 gap-3">
              {QUICK_AMOUNTS.map(amount => (
                <Button
                  key={amount}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => handleQuickAdd(amount)}
                  className="!min-h-[56px] !text-lg tabular-nums"
                >
                  +{amount}
                </Button>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualApply()}
                inputMode="decimal"
                placeholder="Quantidade manual"
                aria-label="Quantidade manual"
                className="flex-1 !min-h-[52px] !text-base tabular-nums"
              />
              <Button disabled={busy || manualInput === ''} onClick={handleManualApply} className="!min-h-[52px] !px-6">
                Aplicar
              </Button>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-3 sm:px-6">
        <Button
          variant="ghost"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
        >
          <ArrowLeft size={16} /> Anterior
        </Button>
        <Button variant="primary" disabled={finalizing} onClick={handleFinalize}>
          {finalizing ? 'Finalizando…' : 'Finalizar contagem'}
        </Button>
        <Button
          variant="ghost"
          disabled={currentIndex >= items.length - 1}
          onClick={() => setCurrentIndex(i => Math.min(items.length - 1, i + 1))}
        >
          Próximo <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}
