import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Modal, Button, Notice, Select, Input, Textarea } from '../ui';
import { CAUSE_CATEGORIES } from '../../lib/rcaAlgorithm';
import { createRcaRecord, uploadEvidence } from '../../lib/rcaService';
import type { RcaCauseCategory, RcaSourceModule } from '../../lib/supabase';
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

interface DraftClassification {
  causeCategory: RcaCauseCategory | '';
  customCauseLabel: string;
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

/** Passo obrigatório ao fechar uma divergência: cada item da lista precisa de uma causa
 *  antes de "Concluir Classificação" ficar habilitado. Reaproveitado pelos 3 fluxos que
 *  hoje geram divergência (import de contagem, conferência Full, recebimento NF-e) — cada
 *  um só monta a lista de PendingRcaItem a partir do que já tem e abre este modal. */
export function RcaClassificationModal({ open, sourceModule, items, companyId, userId, userEmail, onDone }: RcaClassificationModalProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftClassification>>({});
  const [saving, setSaving] = useState(false);

  const draftFor = (id: string): DraftClassification =>
    drafts[id] ?? { causeCategory: '', customCauseLabel: '', notes: '', evidenceFiles: [] };

  const updateDraft = (id: string, patch: Partial<DraftClassification>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...draftFor(id), ...patch } }));
  };

  const allClassified = items.length > 0 && items.every(item => {
    const d = draftFor(item.sourceItemId);
    return d.causeCategory !== '' && (d.causeCategory !== 'outro' || d.customCauseLabel.trim() !== '');
  });

  const handleSubmit = async () => {
    setSaving(true);
    for (const item of items) {
      const d = draftFor(item.sourceItemId);
      if (d.causeCategory === '') continue;
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
          causeCategory: d.causeCategory,
          customCauseLabel: d.customCauseLabel || null,
          notes: d.notes || null,
          occurredAt: item.occurredAt,
        },
        companyId, userId, userEmail
      );
      if (record && d.evidenceFiles.length > 0) {
        await uploadEvidence(record.id, companyId, d.evidenceFiles, userId);
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
            <p>É necessário classificar a causa de cada divergência abaixo antes de continuar. Isso vira conhecimento operacional no dashboard de Root Cause Analysis.</p>
          </div>
        </Notice>

        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
          {items.map(item => {
            const d = draftFor(item.sourceItemId);
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

                <Select
                  value={d.causeCategory}
                  onChange={e => updateDraft(item.sourceItemId, { causeCategory: e.target.value as RcaCauseCategory })}
                  className="w-full"
                >
                  <option value="">Selecione a causa...</option>
                  {CAUSE_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>

                {d.causeCategory === 'outro' && (
                  <Input
                    value={d.customCauseLabel}
                    onChange={e => updateDraft(item.sourceItemId, { customCauseLabel: e.target.value })}
                    placeholder="Descreva a causa..."
                  />
                )}

                <Textarea
                  value={d.notes}
                  onChange={e => updateDraft(item.sourceItemId, { notes: e.target.value })}
                  placeholder="Observações (opcional)"
                  rows={2}
                />

                <RcaEvidenceUpload files={d.evidenceFiles} onChange={files => updateDraft(item.sourceItemId, { evidenceFiles: files })} />
              </div>
            );
          })}
        </div>

        <Button onClick={handleSubmit} disabled={!allClassified || saving} className="w-full justify-center">
          {saving ? 'Salvando...' : <><Check size={14} /> Concluir Classificação</>}
        </Button>
      </div>
    </Modal>
  );
}
