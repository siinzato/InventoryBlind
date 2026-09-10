import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { Modal, Button, Notice, Select, Input, Textarea } from '../ui';
import { PROCESS_AREAS, SEVERITY_OPTIONS } from '../../lib/rcaAlgorithm';
import { createRcaRecord, createPendingClassification, uploadEvidence, getCauseTaxonomy, type RcaTaxonomyCategory } from '../../lib/rcaService';
import type { RcaCauseCategory, RcaProcessArea, RcaSeverity, RcaSourceModule } from '../../lib/supabase';
import { RcaEvidenceUpload } from './RcaEvidenceUpload';

/** Forma polimórfica de uma divergência ainda não classificada — preenchida pelo
 *  chamador (ImportCountTab / FullChecking / NFeCountingView) a partir do item que
 *  cada um já tem, sem precisar de uma tabela unificada de divergências. */
export interface PendingRcaItem {
  sourceItemId: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  location: string | null;
  operatorUserId: string | null;
  operatorName: string | null;
  supplierName?: string | null;
  supplierCnpj?: string | null;
  divergenceQty: number;
  occurredAt?: string;
}

type DraftMode = 'classify' | 'pending';

interface DraftClassification {
  mode: DraftMode;
  processArea: RcaProcessArea | '';
  causeCategory: RcaCauseCategory | '';
  subcauseCode: string;
  customCauseLabel: string;
  severity: RcaSeverity;
  containmentNeeded: boolean;
  knownRecurrence: boolean;
  notes: string;
  evidenceFiles: File[];
}

interface RcaClassificationModalProps {
  open: boolean;
  sourceModule: RcaSourceModule;
  items: PendingRcaItem[];
  companyId: string;
  userId: string;
  userEmail: string;
  onDone: () => void;
}

const emptyDraft = (): DraftClassification => ({
  mode: 'classify', processArea: '', causeCategory: '', subcauseCode: '', customCauseLabel: '',
  severity: 'baixa', containmentNeeded: false, knownRecurrence: false, notes: '', evidenceFiles: [],
});

/** Passo ao fechar uma divergência: classificação inicial leve (processo + categoria +
 *  subcausa + severidade) para cada item — nunca exige a cadeia completa dos Porquês aqui,
 *  isso só acontece se o caso for escalonado para RCA completo (rcaService.createRcaRecord
 *  decide isso sozinho a partir dos critérios do workspace). Reaproveitado pelos 3 fluxos
 *  que hoje geram divergência (import de contagem, conferência Full, recebimento NF-e). */
export function RcaClassificationModal({ open, sourceModule, items, companyId, userId, userEmail, onDone }: RcaClassificationModalProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftClassification>>({});
  const [taxonomy, setTaxonomy] = useState<RcaTaxonomyCategory[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) getCauseTaxonomy(companyId).then(setTaxonomy);
  }, [open, companyId]);

  const activeCategories = taxonomy.filter(c => c.isActive);

  const draftFor = (id: string): DraftClassification => drafts[id] ?? emptyDraft();

  const updateDraft = (id: string, patch: Partial<DraftClassification>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));
  };

  const allResolved = items.length > 0 && items.every(item => {
    const d = draftFor(item.sourceItemId);
    if (d.mode === 'pending') return true;
    return d.processArea !== '' && d.causeCategory !== '' && (d.causeCategory !== 'outro' || d.customCauseLabel.trim() !== '');
  });

  const handleSubmit = async () => {
    setSaving(true);
    for (const item of items) {
      const d = draftFor(item.sourceItemId);

      if (d.mode === 'pending') {
        await createPendingClassification(sourceModule, item, companyId, userId, userEmail);
        continue;
      }
      if (d.processArea === '' || d.causeCategory === '') continue;

      const record = await createRcaRecord(
        {
          sourceModule,
          sourceItemId: item.sourceItemId,
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          location: item.location,
          operatorUserId: item.operatorUserId,
          operatorName: item.operatorName,
          supplierName: item.supplierName,
          supplierCnpj: item.supplierCnpj,
          divergenceQty: item.divergenceQty,
          processArea: d.processArea,
          causeCategory: d.causeCategory,
          subcauseCode: d.subcauseCode || null,
          customCauseLabel: d.customCauseLabel || null,
          severity: d.severity,
          containmentNeeded: d.containmentNeeded,
          knownRecurrence: d.knownRecurrence,
          notes: d.notes || null,
          occurredAt: item.occurredAt,
        },
        companyId, userId, userEmail
      );
      if (record && d.evidenceFiles.length > 0) {
        await uploadEvidence(record.id, null, companyId, d.evidenceFiles, userId);
      }
    }
    setSaving(false);
    setDrafts({});
    onDone();
  };

  if (!open || items.length === 0) return null;

  return (
    <Modal open={open} onClose={() => {}} title="Classificar Causa da Divergência" maxWidth="max-w-2xl">
      <div className="space-y-5">
        <Notice tone="warning">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <p>Classifique o processo e a causa de cada divergência abaixo, ou marque "Classificar depois" — o item entra na fila de regularização e você pode continuar.</p>
          </div>
        </Notice>

        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          {items.map(item => {
            const d = draftFor(item.sourceItemId);
            const category = activeCategories.find(c => c.code === d.causeCategory);
            const isPending = d.mode === 'pending';
            return (
              <div key={item.sourceItemId} className="p-3.5 border border-edge rounded-container space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{item.productName ?? item.sku ?? 'Item sem identificação'}</p>
                    <p className="text-xs text-fg-subtle">{item.sku ?? '—'} {item.location ? `· ${item.location}` : ''}</p>
                  </div>
                  <span className={`text-xs font-mono font-bold ${item.divergenceQty < 0 ? 'text-red-500' : 'text-amber-500'}`}>
                    {item.divergenceQty > 0 ? '+' : ''}{item.divergenceQty}
                  </span>
                </div>

                {isPending ? (
                  <div className="flex items-center justify-between gap-2 rounded-control bg-surface-3 px-3 py-2 text-xs text-fg-muted">
                    <span className="flex items-center gap-1.5"><Clock size={12} /> Ficará marcada como "Resolvida — classificação pendente" na fila.</span>
                    <button type="button" className="text-accent hover:underline" onClick={() => updateDraft(item.sourceItemId, { mode: 'classify' })}>Classificar agora</button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        value={d.processArea}
                        onChange={e => updateDraft(item.sourceItemId, { processArea: e.target.value as RcaProcessArea })}
                        aria-label="Processo afetado"
                      >
                        <option value="">Processo afetado...</option>
                        {PROCESS_AREAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </Select>
                      <Select
                        value={d.severity}
                        onChange={e => updateDraft(item.sourceItemId, { severity: e.target.value as RcaSeverity })}
                        aria-label="Severidade"
                      >
                        {SEVERITY_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Select
                        value={d.causeCategory}
                        onChange={e => updateDraft(item.sourceItemId, { causeCategory: e.target.value, subcauseCode: '' })}
                        aria-label="Categoria de causa"
                      >
                        <option value="">Categoria de causa...</option>
                        {activeCategories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                      </Select>
                      <Select
                        value={d.subcauseCode}
                        onChange={e => updateDraft(item.sourceItemId, { subcauseCode: e.target.value })}
                        aria-label="Subcausa"
                        disabled={!category}
                      >
                        <option value="">Subcausa (opcional)...</option>
                        {category?.subcauses.filter(s => s.isActive).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                      </Select>
                    </div>

                    {d.causeCategory === 'outro' && (
                      <Input
                        value={d.customCauseLabel}
                        onChange={e => updateDraft(item.sourceItemId, { customCauseLabel: e.target.value })}
                        placeholder="Descreva a causa..."
                      />
                    )}

                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <input type="checkbox" className="h-4 w-4 accent-accent" checked={d.containmentNeeded} onChange={e => updateDraft(item.sourceItemId, { containmentNeeded: e.target.checked })} />
                        Precisa de contenção imediata
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <input type="checkbox" className="h-4 w-4 accent-accent" checked={d.knownRecurrence} onChange={e => updateDraft(item.sourceItemId, { knownRecurrence: e.target.checked })} />
                        Recorrência conhecida
                      </label>
                    </div>

                    <Textarea
                      value={d.notes}
                      onChange={e => updateDraft(item.sourceItemId, { notes: e.target.value })}
                      placeholder="Observações / evidência (opcional)"
                      rows={2}
                    />

                    <RcaEvidenceUpload files={d.evidenceFiles} onChange={files => updateDraft(item.sourceItemId, { evidenceFiles: files })} />

                    <button type="button" className="text-xs text-fg-subtle hover:text-fg hover:underline" onClick={() => updateDraft(item.sourceItemId, { mode: 'pending' })}>
                      Classificar depois
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <Button onClick={handleSubmit} disabled={!allResolved || saving} className="w-full justify-center">
          {saving ? 'Salvando...' : <><Check size={14} /> Concluir</>}
        </Button>
      </div>
    </Modal>
  );
}
