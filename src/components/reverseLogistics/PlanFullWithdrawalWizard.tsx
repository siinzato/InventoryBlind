import { useEffect, useState } from 'react';
import { ArrowLeft, Search, Minus, Plus, Save, ExternalLink, Info } from 'lucide-react';
import { Button, Input, Select, Panel, PanelSection, Notice } from '../ui';
import { useAuth } from '../../lib/auth';
import {
  getFullWithdrawalPlan, getFullWithdrawalItems, saveDraftPlan, advanceFullWithdrawalStatus,
  searchWithdrawalCandidates,
} from '../../lib/reverseLogistics/fullWithdrawalService';
import {
  FULL_WITHDRAWAL_REASON_LABEL, FULL_WITHDRAWAL_METHOD_LABEL,
  type FullWithdrawalReason, type FullWithdrawalMethod, type WithdrawalCandidateProduct,
} from '../../lib/reverseLogistics/fullWithdrawalTypes';

// Não existe conector real da API do Mercado Livre neste projeto — a confirmação
// da retirada é sempre feita no painel deles, nunca aqui. O domínio abaixo é o
// endereço oficial estável do Mercado Livre; não existe um deep-link confiável
// para a tela específica de retiradas Full sem uma integração real.
const MERCADO_LIVRE_URL = 'https://www.mercadolivre.com.br/';

type Step = 'stock' | 'destination' | 'review' | 'confirm';
const STEPS: { key: Step; label: string }[] = [
  { key: 'stock', label: 'Selecionar estoque' },
  { key: 'destination', label: 'Definir destino' },
  { key: 'review', label: 'Revisar' },
  { key: 'confirm', label: 'Confirmar no Mercado Livre' },
];

interface WizardItem {
  productId: string;
  sku: string;
  name: string;
  plannedQuantity: number;
}

interface PlanFullWithdrawalWizardProps {
  companyId: string;
  existingPlanId: string | null;
  onDone: (planId: string, opts?: { openDetail?: boolean }) => void;
  onCancel: () => void;
}

export function PlanFullWithdrawalWizard({ companyId, existingPlanId, onDone, onCancel }: PlanFullWithdrawalWizardProps) {
  const { profile } = useAuth();
  const [step, setStep] = useState<Step>('stock');
  const [loadingExisting, setLoadingExisting] = useState(!!existingPlanId);

  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidates, setCandidates] = useState<WithdrawalCandidateProduct[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [items, setItems] = useState<WizardItem[]>([]);

  const [reason, setReason] = useState<FullWithdrawalReason | ''>('');
  const [method, setMethod] = useState<FullWithdrawalMethod>('withdraw_and_receive');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existingPlanId) return;
    let cancelled = false;
    (async () => {
      try {
        const [plan, planItems] = await Promise.all([
          getFullWithdrawalPlan(existingPlanId),
          getFullWithdrawalItems(existingPlanId),
        ]);
        if (cancelled || !plan) return;
        setReason(plan.reason ?? '');
        setMethod(plan.method);
        setDestinationLabel(plan.destinationLabel ?? '');
        setDestinationAddress(plan.destinationAddress ?? '');
        setNotes(plan.notes ?? '');
        setItems(planItems.map(it => ({ productId: it.productId ?? '', sku: it.sku ?? '', name: it.description, plannedQuantity: it.plannedQuantity })));
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [existingPlanId]);

  useEffect(() => {
    let cancelled = false;
    setCandidatesLoading(true);
    searchWithdrawalCandidates(candidateSearch)
      .then(result => { if (!cancelled) setCandidates(result); })
      .catch(() => { if (!cancelled) setCandidates([]); })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [candidateSearch]);

  const isSelected = (productId: string) => items.some(i => i.productId === productId);

  const toggleCandidate = (p: WithdrawalCandidateProduct) => {
    setItems(prev => {
      if (prev.some(i => i.productId === p.id)) return prev.filter(i => i.productId !== p.id);
      return [...prev, { productId: p.id, sku: p.sku, name: p.name, plannedQuantity: 1 }];
    });
  };

  const setQuantity = (productId: string, quantity: number) => {
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, plannedQuantity: Math.max(0, quantity) } : i));
  };

  const totalUnits = items.reduce((s, i) => s + i.plannedQuantity, 0);

  const stockValid = items.length > 0 && items.every(i => i.plannedQuantity > 0);
  const destinationValid = destinationLabel.trim() !== '' && reason !== '';

  function buildDraftInput() {
    return {
      companyId,
      reason: reason === '' ? null : reason,
      method,
      destinationLabel: destinationLabel.trim() || null,
      destinationAddress: destinationAddress.trim() || null,
      notes: notes.trim() || null,
      items: items.map(i => ({ productId: i.productId || null, sku: i.sku || null, description: i.name, plannedQuantity: i.plannedQuantity })),
    };
  }

  async function handleSaveDraft() {
    setBusy(true);
    setError(null);
    try {
      const plan = await saveDraftPlan(existingPlanId, buildDraftInput(), profile?.id ?? '', profile?.email ?? '');
      onDone(plan.id, { openDetail: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o rascunho.');
    } finally {
      setBusy(false);
    }
  }

  async function handleContinueToMl() {
    if (!stockValid || !destinationValid) {
      setError('Selecione ao menos um item com quantidade válida e informe destino e motivo antes de continuar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = await saveDraftPlan(existingPlanId, buildDraftInput(), profile?.id ?? '', profile?.email ?? '');
      await advanceFullWithdrawalStatus(plan.id, 'awaiting_confirmation');
      window.open(MERCADO_LIVRE_URL, '_blank', 'noopener,noreferrer');
      onDone(plan.id, { openDetail: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar para o Mercado Livre.');
    } finally {
      setBusy(false);
    }
  }

  if (loadingExisting) {
    return <div className="p-8 text-center text-sm text-fg-subtle">Carregando rascunho…</div>;
  }

  const stepIndex = STEPS.findIndex(s => s.key === step);

  return (
    <div>
      <div className="sticky top-0 z-10 bg-surface border-b border-edge px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onCancel} className="p-1.5 rounded-control text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-title truncate">Planejar retirada Full</h1>
            <p className="text-caption truncate">Prepare os itens e o destino antes de confirmar a retirada no Mercado Livre.</p>
          </div>
        </div>
        <Button variant="secondary" disabled={busy} onClick={handleSaveDraft}>
          <Save size={15} /> <span className="hidden sm:inline">Salvar rascunho</span>
        </Button>
      </div>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Indicador de etapas — barra linear, sem círculos numerados */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex-1 min-w-0">
              <button
                onClick={() => i <= stepIndex && setStep(s.key)}
                disabled={i > stepIndex}
                className={`w-full text-left text-sm font-medium truncate pb-2 border-b-2 transition-colors ${
                  i === stepIndex ? 'text-accent border-accent' : i < stepIndex ? 'text-fg-muted border-accent/40 cursor-pointer' : 'text-fg-subtle border-edge cursor-default'
                }`}
              >
                {s.label}
              </button>
            </div>
          ))}
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {step === 'stock' && (
              <Panel>
                <PanelSection padding="sm">
                  <h2 className="text-title">Estoque disponível no Full</h2>
                </PanelSection>
                <PanelSection padding="sm" className="flex items-start gap-2 text-xs text-fg-subtle">
                  <Info size={13} className="flex-shrink-0 mt-0.5" />
                  Saldo e antiguidade no Full ainda dependem de confirmação manual — não há consulta automática ao Mercado Livre nesta versão. Selecione pelo catálogo e informe a quantidade que pretende retirar.
                </PanelSection>
                <PanelSection padding="sm">
                  <Input icon={<Search size={15} />} placeholder="Buscar produto, SKU ou EAN" value={candidateSearch} onChange={e => setCandidateSearch(e.target.value)} />
                </PanelSection>
                <div className="divide-y divide-edge/60 max-h-[50vh] overflow-y-auto">
                  {candidatesLoading ? (
                    <p className="p-4 text-sm text-fg-subtle text-center">Carregando…</p>
                  ) : candidates.length === 0 ? (
                    <p className="p-4 text-sm text-fg-subtle text-center">Nenhum produto encontrado.</p>
                  ) : candidates.map(p => {
                    const selected = isSelected(p.id);
                    const item = items.find(i => i.productId === p.id);
                    return (
                      <div key={p.id} className="flex items-center gap-3 p-3">
                        <input type="checkbox" checked={selected} onChange={() => toggleCandidate(p)} className="h-4 w-4 rounded border-edge flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-fg truncate">{p.name}</p>
                          <p className="text-xs text-fg-subtle">SKU {p.sku}{p.location ? ` · ${p.location}` : ''}</p>
                        </div>
                        {selected && item && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => setQuantity(p.id, item.plannedQuantity - 1)} className="p-1.5 rounded-control border border-edge text-fg-muted hover:text-fg" aria-label="Diminuir quantidade">
                              <Minus size={13} />
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={item.plannedQuantity}
                              onChange={e => setQuantity(p.id, Number(e.target.value))}
                              className="w-14 text-center bg-surface-3 border border-edge rounded-control text-sm py-1"
                            />
                            <button onClick={() => setQuantity(p.id, item.plannedQuantity + 1)} className="p-1.5 rounded-control border border-edge text-fg-muted hover:text-fg" aria-label="Aumentar quantidade">
                              <Plus size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <PanelSection padding="sm" className="flex items-center justify-between text-caption">
                  <span>{items.length} selecionado{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalUnits} unidade{totalUnits !== 1 ? 's' : ''} selecionada{totalUnits !== 1 ? 's' : ''}</span>
                </PanelSection>
              </Panel>
            )}

            {step === 'destination' && (
              <Panel>
                <PanelSection padding="sm"><h2 className="text-title">Definir destino</h2></PanelSection>
                <PanelSection className="space-y-3">
                  <div>
                    <label className="text-label block mb-1">Motivo da retirada</label>
                    <Select value={reason} onChange={e => setReason(e.target.value as FullWithdrawalReason)} className="w-full">
                      <option value="">Selecione um motivo</option>
                      {(Object.keys(FULL_WITHDRAWAL_REASON_LABEL) as FullWithdrawalReason[]).map(r => (
                        <option key={r} value={r}>{FULL_WITHDRAWAL_REASON_LABEL[r]}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label block mb-1">Método</label>
                    <Select value={method} onChange={e => setMethod(e.target.value as FullWithdrawalMethod)} className="w-full">
                      {(Object.keys(FULL_WITHDRAWAL_METHOD_LABEL) as FullWithdrawalMethod[]).map(m => (
                        <option key={m} value={m}>{FULL_WITHDRAWAL_METHOD_LABEL[m]}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="text-label block mb-1">Destino</label>
                    <Input placeholder="Ex.: Centro de distribuição próprio" value={destinationLabel} onChange={e => setDestinationLabel(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-label block mb-1">Endereço de destino</label>
                    <Input placeholder="Endereço completo" value={destinationAddress} onChange={e => setDestinationAddress(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-label block mb-1">Observações (opcional)</label>
                    <Input placeholder="Observações" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </PanelSection>
              </Panel>
            )}

            {step === 'review' && (
              <Panel>
                <PanelSection padding="sm"><h2 className="text-title">Revisar</h2></PanelSection>
                <PanelSection className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-fg-muted">Itens selecionados</span>
                    <button onClick={() => setStep('stock')} className="text-accent text-xs font-medium">Editar</button>
                  </div>
                  {items.map(i => (
                    <div key={i.productId} className="flex items-center justify-between text-fg">
                      <span className="truncate">{i.name} <span className="text-fg-subtle">· SKU {i.sku}</span></span>
                      <span className="tabular-nums flex-shrink-0 ml-2">{i.plannedQuantity} un.</span>
                    </div>
                  ))}
                  <div className="border-t border-edge pt-3 flex items-center justify-between">
                    <span className="text-fg-muted">Destino</span>
                    <button onClick={() => setStep('destination')} className="text-accent text-xs font-medium">Editar</button>
                  </div>
                  <p className="text-fg">{destinationLabel || '—'}</p>
                  <p className="text-fg-subtle">{destinationAddress || '—'}</p>
                  <p className="text-fg-subtle">Motivo: {reason ? FULL_WITHDRAWAL_REASON_LABEL[reason] : '—'} · Método: {FULL_WITHDRAWAL_METHOD_LABEL[method]}</p>
                </PanelSection>
              </Panel>
            )}

            {step === 'confirm' && (
              <Panel>
                <PanelSection padding="sm"><h2 className="text-title">Confirmar no Mercado Livre</h2></PanelSection>
                <PanelSection className="space-y-3">
                  <Notice tone="neutral">
                    <span className="flex items-start gap-2">
                      <Info size={15} className="flex-shrink-0 mt-0.5" />
                      O IB organiza o plano e consulta o estoque Full. A confirmação final da retirada é concluída no Mercado Livre — você será redirecionado para lá em uma nova aba.
                    </span>
                  </Notice>
                  <p className="text-sm text-fg-subtle">
                    O plano ficará como "Aguardando confirmação no ML". Depois de confirmar no painel do Mercado Livre, volte aqui e use "Vincular retirada do ML" para registrar o identificador real.
                  </p>
                  <Button onClick={handleContinueToMl} disabled={busy}>
                    <ExternalLink size={15} /> Continuar no Mercado Livre
                  </Button>
                </PanelSection>
              </Panel>
            )}

            <div className="flex items-center justify-between">
              <Button variant="secondary" disabled={stepIndex === 0} onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}>Voltar</Button>
              {step !== 'confirm' && (
                <Button
                  disabled={(step === 'stock' && !stockValid) || (step === 'destination' && !destinationValid)}
                  onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].key)}
                >
                  Avançar
                </Button>
              )}
            </div>
          </div>

          <Panel>
            <PanelSection padding="sm"><h3 className="text-title">Resumo do plano</h3></PanelSection>
            <PanelSection className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-fg-muted">Produtos (SKUs)</span><span className="font-medium text-fg">{items.length}</span></div>
              <div className="flex items-center justify-between"><span className="text-fg-muted">Unidades a retirar</span><span className="font-medium text-fg">{totalUnits}</span></div>
              <div className="flex items-center justify-between"><span className="text-fg-muted">Motivo</span><span className="font-medium text-fg">{reason ? FULL_WITHDRAWAL_REASON_LABEL[reason] : '—'}</span></div>
              <div className="flex items-center justify-between"><span className="text-fg-muted">Método</span><span className="font-medium text-fg">{FULL_WITHDRAWAL_METHOD_LABEL[method]}</span></div>
              <div className="flex items-center justify-between"><span className="text-fg-muted">Destino</span><span className="font-medium text-fg truncate ml-2">{destinationLabel || '—'}</span></div>
              <div className="flex items-center justify-between"><span className="text-fg-muted">Responsável</span><span className="font-medium text-fg">{profile?.name ?? profile?.email ?? '—'}</span></div>
              <p className="text-caption pt-2 border-t border-edge">O custo final e o prazo serão informados pelo Mercado Livre antes da confirmação.</p>
            </PanelSection>
          </Panel>
        </div>
      </div>
    </div>
  );
}
