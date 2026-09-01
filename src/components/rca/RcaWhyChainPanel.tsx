import { useEffect, useState } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Select, Textarea } from '../ui';
import { getWhySteps, addWhyStep, removeWhyStep, confirmRootCause } from '../../lib/rcaService';
import { canConfirmRootCause } from '../../lib/rcaAlgorithm';
import type { RcaCaseWhyStep, RcaWhyStepRole, RcaRootCauseStatus } from '../../lib/supabase';
import type { RcaTaxonomyCategory } from '../../lib/rcaService';

const ROLE_LABEL: Record<RcaWhyStepRole, string> = {
  sintoma: 'Sintoma',
  causa_direta: 'Causa direta',
  causa_contribuinte: 'Causa contribuinte',
  causa_raiz_proposta: 'Causa raiz proposta',
};
const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [RcaWhyStepRole, string][];

interface RcaWhyChainPanelProps {
  caseId: string;
  companyId: string;
  userId: string;
  userEmail: string;
  canManage: boolean;
  rootCauseStatus: RcaRootCauseStatus | null;
  evidenceCount: number;
  causeCategories: RcaTaxonomyCategory[];
  onRootCauseConfirmed: () => void;
}

/** Cadeia dos Porquês de profundidade variável — nunca fixa em 5 níveis. Cada etapa tem
 *  pergunta/resposta/autor/data/ordem e pode ramificar (parentStepId). A causa raiz só pode
 *  ser confirmada com pelo menos uma evidência vinculada ao caso (canConfirmRootCause). */
export function RcaWhyChainPanel({ caseId, companyId, userId, userEmail, canManage, rootCauseStatus, evidenceCount, causeCategories, onRootCauseConfirmed }: RcaWhyChainPanelProps) {
  const [steps, setSteps] = useState<RcaCaseWhyStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [draftRole, setDraftRole] = useState<RcaWhyStepRole>('causa_direta');
  const [draftParent, setDraftParent] = useState('');
  const [saving, setSaving] = useState(false);

  const [rootCauseText, setRootCauseText] = useState('');
  const [justification, setJustification] = useState('');
  const [finalCategory, setFinalCategory] = useState('');
  const [finalSubcause, setFinalSubcause] = useState('');

  const load = () => { setLoading(true); getWhySteps(caseId, companyId).then(s => { setSteps(s); setLoading(false); }); };
  useEffect(load, [caseId, companyId]);

  const isConfirmed = rootCauseStatus === 'confirmada';
  const category = causeCategories.find(c => c.code === finalCategory);

  const handleAdd = async () => {
    if (!draftAnswer.trim()) return;
    setSaving(true);
    await addWhyStep(caseId, companyId, { parentStepId: draftParent || null, orderIndex: steps.length + 1, answer: draftAnswer.trim(), role: draftRole }, userId, userEmail);
    setDraftAnswer(''); setDraftParent('');
    load();
    setSaving(false);
  };

  const handleRemove = async (stepId: string) => {
    if (isConfirmed) return;
    await removeWhyStep(stepId, caseId, companyId, userId, userEmail);
    load();
  };

  const handleConfirm = async () => {
    if (!canConfirmRootCause(rootCauseText, evidenceCount) || !finalCategory) return;
    setSaving(true);
    await confirmRootCause(caseId, companyId, { rootCauseText: rootCauseText.trim(), justification: justification.trim(), causeCategory: finalCategory, subcauseCode: finalSubcause || null }, userId, userEmail);
    setSaving(false);
    onRootCauseConfirmed();
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection padding="sm"><p className="text-section">Cadeia dos Porquês</p></PanelSection>
        <PanelSection padding="md" className="space-y-3">
          <p className="text-xs text-fg-subtle">A quantidade de porquês pode variar; encerre quando houver causa tratável sustentada por evidência.</p>

          {loading ? (
            <p className="text-xs text-fg-subtle">Carregando...</p>
          ) : steps.length === 0 ? (
            <p className="text-xs text-fg-subtle">Nenhuma etapa registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={s.id} className="flex items-start gap-2 p-2.5 border border-edge rounded-container">
                  <span className="font-bold text-accent text-sm flex-shrink-0">{i + 1}º</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={s.role === 'causa_raiz_proposta' ? 'accent' : 'neutral'}>{ROLE_LABEL[s.role]}</Badge>
                      {s.parent_step_id && <span className="text-[10px] text-fg-subtle">ramificação</span>}
                    </div>
                    <p className="text-sm text-fg-muted">{s.answer}</p>
                    <p className="text-[10px] text-fg-subtle">{s.author_email ?? 'Autor não informado'} · {new Date(s.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                  {canManage && !isConfirmed && (
                    <button type="button" onClick={() => handleRemove(s.id)} className="text-fg-subtle hover:text-red-500 flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canManage && !isConfirmed && (
            <div className="space-y-2 pt-2 border-t border-edge">
              <div className="grid grid-cols-2 gap-2">
                <Select value={draftParent} onChange={e => setDraftParent(e.target.value)} aria-label="Ramificar a partir de">
                  <option value="">Próxima etapa (sequencial)</option>
                  {steps.map((s, i) => <option key={s.id} value={s.id}>Ramificar de #{i + 1}</option>)}
                </Select>
                <Select value={draftRole} onChange={e => setDraftRole(e.target.value as RcaWhyStepRole)} aria-label="Papel da etapa">
                  {ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </div>
              <div className="flex gap-2">
                <Textarea value={draftAnswer} onChange={e => setDraftAnswer(e.target.value)} placeholder="Por quê?" rows={2} className="flex-1" />
                <Button onClick={handleAdd} disabled={saving || !draftAnswer.trim()}><Plus size={14} /></Button>
              </div>
            </div>
          )}
        </PanelSection>
      </Panel>

      {canManage && (
        <Panel>
          <PanelSection padding="sm"><p className="text-section flex items-center gap-1.5"><ShieldCheck size={14} /> Causa raiz</p></PanelSection>
          <PanelSection padding="md" className="space-y-2.5">
            {isConfirmed ? (
              <p className="text-sm text-fg-muted">Causa raiz confirmada.</p>
            ) : (
              <>
                <Textarea value={rootCauseText} onChange={e => setRootCauseText(e.target.value)} placeholder="Causa raiz proposta" rows={2} />
                <Textarea value={justification} onChange={e => setJustification(e.target.value)} placeholder="Justificativa" rows={2} />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={finalCategory} onChange={e => { setFinalCategory(e.target.value); setFinalSubcause(''); }} aria-label="Categoria final">
                    <option value="">Categoria de causa final...</option>
                    {causeCategories.filter(c => c.isActive).map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </Select>
                  <Select value={finalSubcause} onChange={e => setFinalSubcause(e.target.value)} aria-label="Subcausa final" disabled={!category}>
                    <option value="">Subcausa (opcional)...</option>
                    {category?.subcauses.filter(s => s.isActive).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </Select>
                </div>
                {evidenceCount === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Vincule pelo menos uma evidência na aba Evidências para poder confirmar.</p>}
                <Button onClick={handleConfirm} disabled={saving || !canConfirmRootCause(rootCauseText, evidenceCount) || !finalCategory} className="w-full justify-center">
                  Confirmar causa raiz
                </Button>
              </>
            )}
          </PanelSection>
        </Panel>
      )}
    </div>
  );
}
