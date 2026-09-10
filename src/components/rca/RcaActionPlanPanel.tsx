import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Select, Input } from '../ui';
import { createCaseAction, getCaseActions, getActionTaskSummaries, verifyCaseAction, type ActionTaskSummary } from '../../lib/rcaService';
import { listTeamMembers } from '../../lib/tasks/taskService';
import type { TeamMember } from '../../lib/tasks/types';
import type { RcaCaseAction, RcaActionType } from '../../lib/supabase';

const ACTION_TYPE_LABEL: Record<RcaActionType, string> = {
  contencao: 'Contenção', corretiva: 'Corretiva', preventiva: 'Preventiva', verificacao: 'Verificação',
};
const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'A fazer', in_progress: 'Em execução', paused: 'Pausada', blocked: 'Bloqueada',
  done: 'Concluída', validated: 'Concluída', cancelled: 'Cancelada',
};

interface RcaActionPlanPanelProps {
  caseId: string;
  companyId: string;
  userId: string;
  userEmail: string;
  canManage: boolean;
  onChanged: () => void;
}

function isOverdue(summary: ActionTaskSummary | undefined): boolean {
  if (!summary || !summary.dueDate) return false;
  if (['done', 'validated', 'cancelled'].includes(summary.status)) return false;
  return new Date(summary.dueDate).getTime() < Date.now();
}

/** Plano de ação apoiado no módulo de Tarefas já existente — cada ação aqui é só um fino
 *  wrapper (rca_case_actions) sobre uma Tarefa real (responsável/prazo/status/anexo/
 *  notificação vêm de lá); esta tela só guarda o que Tarefas não modela: critério de
 *  eficácia e o resultado da verificação. Contenção nunca é a ação que fecha o caso. */
export function RcaActionPlanPanel({ caseId, companyId, userId, userEmail, canManage, onChanged }: RcaActionPlanPanelProps) {
  const [actions, setActions] = useState<RcaCaseAction[]>([]);
  const [taskSummaries, setTaskSummaries] = useState<Map<string, ActionTaskSummary>>(new Map());
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [actionType, setActionType] = useState<RcaActionType>('corretiva');
  const [title, setTitle] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [criteria, setCriteria] = useState('');

  const [verifyDraft, setVerifyDraft] = useState<Record<string, { observed: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [actionRows, memberRows] = await Promise.all([getCaseActions(caseId, companyId), listTeamMembers(companyId)]);
    setActions(actionRows);
    setMembers(memberRows);
    setTaskSummaries(await getActionTaskSummaries(actionRows.map(a => a.task_id).filter((id): id is string => !!id)));
    setLoading(false);
  }, [caseId, companyId]);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!title.trim() || !responsibleId) return;
    setSaving(true);
    await createCaseAction(caseId, actionType, {
      title: title.trim(), responsibleUserId: responsibleId, dueDate: dueDate || null,
      effectivenessCriteria: actionType === 'contencao' ? null : (criteria.trim() || null),
    }, companyId, userId, userEmail);
    setTitle(''); setResponsibleId(''); setDueDate(''); setCriteria('');
    await load();
    onChanged();
    setSaving(false);
  };

  const handleVerify = async (actionId: string, result: 'eficaz' | 'ineficaz') => {
    const observed = verifyDraft[actionId]?.observed?.trim();
    if (!observed) return;
    await verifyCaseAction(actionId, companyId, { observedResult: observed, verificationResult: result }, userId, userEmail);
    await load();
    onChanged();
  };

  return (
    <Panel>
      <PanelSection padding="sm"><p className="text-section">Plano de Ação</p></PanelSection>
      <PanelSection padding="md" className="space-y-3">
        {loading ? (
          <p className="text-xs text-fg-subtle">Carregando...</p>
        ) : actions.length === 0 ? (
          <p className="text-xs text-fg-subtle">Nenhuma ação registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {actions.map(a => {
              const summary = a.task_id ? taskSummaries.get(a.task_id) : undefined;
              const overdue = isOverdue(summary);
              return (
                <div key={a.id} className="p-3 border border-edge rounded-container space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="neutral">{ACTION_TYPE_LABEL[a.action_type]}</Badge>
                      {summary && <Badge variant={overdue ? 'danger' : 'neutral'}>{overdue ? 'Vencida' : TASK_STATUS_LABEL[summary.status] ?? summary.status}</Badge>}
                      {a.verification_result && <Badge variant={a.verification_result === 'eficaz' ? 'success' : 'danger'}>{a.verification_result === 'eficaz' ? 'Eficaz' : 'Ineficaz'}</Badge>}
                    </div>
                    <span className="text-xs text-fg-subtle">
                      {summary?.assigneeName ?? '—'} {summary?.dueDate ? `· ${new Date(summary.dueDate).toLocaleDateString('pt-BR')}` : ''}
                    </span>
                  </div>
                  {a.effectiveness_criteria && <p className="text-xs text-fg-muted">Critério de eficácia: {a.effectiveness_criteria}</p>}
                  {a.observed_result && <p className="text-xs text-fg-subtle">Resultado observado: {a.observed_result}</p>}

                  {canManage && a.action_type !== 'contencao' && !a.verification_result && summary && ['done', 'validated'].includes(summary.status) && (
                    <div className="flex gap-2 pt-1">
                      <Input
                        value={verifyDraft[a.id]?.observed ?? ''}
                        onChange={e => setVerifyDraft(prev => ({ ...prev, [a.id]: { observed: e.target.value } }))}
                        placeholder="Resultado observado na verificação..."
                        className="flex-1 text-xs"
                      />
                      <Button variant="secondary" size="sm" onClick={() => handleVerify(a.id, 'eficaz')}>Eficaz</Button>
                      <Button variant="secondary" size="sm" onClick={() => handleVerify(a.id, 'ineficaz')}>Ineficaz</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canManage && (
          <div className="space-y-2 pt-2 border-t border-edge">
            <div className="grid grid-cols-2 gap-2">
              <Select value={actionType} onChange={e => setActionType(e.target.value as RcaActionType)} aria-label="Tipo de ação">
                {(Object.entries(ACTION_TYPE_LABEL) as [RcaActionType, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={responsibleId} onChange={e => setResponsibleId(e.target.value)} aria-label="Responsável">
                <option value="">Responsável...</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
              </Select>
            </div>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Descrição da ação" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} aria-label="Prazo" />
              {actionType !== 'contencao' && (
                <Input value={criteria} onChange={e => setCriteria(e.target.value)} placeholder="Critério de eficácia (ex.: zero recorrências em 14 dias)" />
              )}
            </div>
            <Button onClick={handleAdd} disabled={saving || !title.trim() || !responsibleId} className="w-full justify-center">
              <Plus size={14} /> Adicionar ação
            </Button>
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}
