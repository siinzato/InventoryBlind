import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Button, Badge, Select, Input, Textarea, PhaseRail, type PhaseRailStep } from '../ui';
import {
  getCase, getCaseDivergences, getEvidenceForCase, getCaseActions, getActionTaskSummaries,
  updateCaseProblem, setCaseStatus, closeCase, getCauseTaxonomy, type RcaTaxonomyCategory, type ActionTaskSummary,
} from '../../lib/rcaService';
import { listTeamMembers } from '../../lib/tasks/taskService';
import type { TeamMember } from '../../lib/tasks/types';
import { computeCaseConfidence, canCloseCase, PROCESS_AREA_LABEL, CASE_STATUS_LABEL, SEVERITY_LABEL } from '../../lib/rcaAlgorithm';
import type { RcaCase, RcaRecord, RcaEvidence, RcaCaseAction } from '../../lib/supabase';
import { RcaWhyChainPanel } from './RcaWhyChainPanel';
import { RcaActionPlanPanel } from './RcaActionPlanPanel';
import { RcaEvidenceList } from './RcaEvidenceList';

const STEPS: PhaseRailStep[] = [
  { key: 'problema', label: 'Problema' },
  { key: 'evidencias', label: 'Evidências' },
  { key: 'cadeia', label: 'Cadeia causal' },
  { key: 'plano', label: 'Plano de ação' },
  { key: 'verificacao', label: 'Verificação' },
];

interface RcaCaseDetailPageProps {
  caseId: string;
  companyId: string;
  userId: string;
  userEmail: string;
  role: string;
  onBack: () => void;
}

export function RcaCaseDetailPage({ caseId, companyId, userId, userEmail, role, onBack }: RcaCaseDetailPageProps) {
  const canManage = role === 'owner' || role === 'admin' || role === 'manager';

  const [step, setStep] = useState('problema');
  const [rcaCase, setRcaCase] = useState<RcaCase | null>(null);
  const [divergences, setDivergences] = useState<RcaRecord[]>([]);
  const [evidence, setEvidence] = useState<RcaEvidence[]>([]);
  const [actions, setActions] = useState<RcaCaseAction[]>([]);
  const [taskSummaries, setTaskSummaries] = useState<Map<string, ActionTaskSummary>>(new Map());
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [taxonomy, setTaxonomy] = useState<RcaTaxonomyCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const [problemWhat, setProblemWhat] = useState('');
  const [problemWhere, setProblemWhere] = useState('');
  const [problemExpected, setProblemExpected] = useState('');
  const [problemObserved, setProblemObserved] = useState('');
  const [problemImpactQty, setProblemImpactQty] = useState('');
  const [financialImpact, setFinancialImpact] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, divs, ev, actionRows, memberRows, taxonomyRows] = await Promise.all([
      getCase(caseId, companyId), getCaseDivergences(caseId, companyId), getEvidenceForCase(caseId, companyId),
      getCaseActions(caseId, companyId), listTeamMembers(companyId), getCauseTaxonomy(companyId),
    ]);
    setRcaCase(c);
    setDivergences(divs);
    setEvidence(ev);
    setActions(actionRows);
    setTaskSummaries(await getActionTaskSummaries(actionRows.map(a => a.task_id).filter((id): id is string => !!id)));
    setMembers(memberRows);
    setTaxonomy(taxonomyRows);
    if (c) {
      setProblemWhat(c.problem_what);
      setProblemWhere(c.problem_where ?? '');
      setProblemExpected(c.problem_expected_pattern ?? '');
      setProblemObserved(c.problem_observed_result ?? '');
      setProblemImpactQty(c.problem_impact_qty != null ? String(c.problem_impact_qty) : '');
      setFinancialImpact(c.financial_impact != null ? String(c.financial_impact) : '');
      setOwnerId(c.owner_id ?? '');
      setDueAt(c.due_at ? c.due_at.slice(0, 10) : '');
    }
    setLoading(false);
  }, [caseId, companyId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    await updateCaseProblem(caseId, companyId, {
      problemWhat: problemWhat.trim(), problemWhere: problemWhere.trim() || null,
      problemWhen: rcaCase?.problem_when ?? null,
      problemImpactQty: problemImpactQty ? Number(problemImpactQty) : null,
      problemExpectedPattern: problemExpected.trim() || null,
      problemObservedResult: problemObserved.trim() || null,
      financialImpact: financialImpact ? Number(financialImpact) : null,
      ownerId: ownerId || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    }, userId);
    if (rcaCase?.status === 'rascunho') await setCaseStatus(caseId, companyId, 'em_investigacao', userId, userEmail);
    await load();
    setSaving(false);
  };

  if (loading || !rcaCase) {
    return <Page><PageHeader title="Caso de RCA" description="Carregando..." /></Page>;
  }

  const evidenceCount = evidence.length;
  const confidence = computeCaseConfidence({
    hasProblemDefined: !!(rcaCase.problem_where && rcaCase.problem_expected_pattern && rcaCase.problem_observed_result),
    evidenceCount,
    hasSustainedCause: rcaCase.root_cause_status === 'confirmada',
    hasActionPlan: actions.length > 0,
    hasEffectivenessCriteria: actions.some(a => !!a.effectiveness_criteria),
  });

  const closeCheck = canCloseCase(rcaCase.root_cause_status, actions.map(a => {
    const summary = a.task_id ? taskSummaries.get(a.task_id) : undefined;
    return {
      actionType: a.action_type,
      taskDone: summary ? ['done', 'validated'].includes(summary.status) : false,
      taskBlocked: summary?.status === 'blocked',
      verificationResult: a.verification_result,
    };
  }));

  const lastOccurrence = divergences.length > 0 ? divergences.map(d => d.occurred_at).sort().slice(-1)[0] : rcaCase.problem_when;
  const caseCode = `RCA-${rcaCase.case_year}-${String(rcaCase.case_number).padStart(3, '0')}`;

  return (
    <Page>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-1">
        <ArrowLeft size={14} /> Voltar para Root Cause Analysis
      </button>

      <PageHeader
        title={`Caso ${caseCode}`}
        description={rcaCase.problem_what}
      />

      <Panel>
        <PanelSection padding="md" className="flex flex-wrap items-center gap-3">
          <Badge variant="neutral">{PROCESS_AREA_LABEL[rcaCase.process_area]}</Badge>
          {rcaCase.problem_where && <Badge variant="neutral">{rcaCase.problem_where}</Badge>}
          <Badge variant={rcaCase.severity === 'critica' || rcaCase.severity === 'alta' ? 'danger' : 'neutral'}>{SEVERITY_LABEL[rcaCase.severity]}</Badge>
          <span className="text-xs text-fg-subtle">Aberto em {new Date(rcaCase.opened_at).toLocaleDateString('pt-BR')}</span>
          <span className="ml-auto flex items-center gap-2">
            <Badge variant="accent">{CASE_STATUS_LABEL[rcaCase.status]}</Badge>
            {canManage && (
              <Button onClick={handleSave} disabled={saving} size="sm">
                <Save size={13} /> Salvar análise
              </Button>
            )}
          </span>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
            <Stat label="Impacto" value={rcaCase.problem_impact_qty != null ? String(rcaCase.problem_impact_qty) : '—'} />
            <Stat label="Recorrências" value={String(divergences.length)} />
            <Stat label="Valor estimado" value={rcaCase.financial_impact != null ? rcaCase.financial_impact.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Indisponível'} />
            <Stat label="Última ocorrência" value={lastOccurrence ? new Date(lastOccurrence).toLocaleDateString('pt-BR') : '—'} />
            <Stat label="Confiança da análise" value={`${confidence}%`} title="Cobertura determinística: problema definido, evidência vinculada, causa sustentada, plano definido e critério de eficácia definido." />
          </div>
        </PanelSection>
      </Panel>

      <PhaseRail steps={STEPS} currentKey={step} label="Etapas do caso de RCA" />

      {step === 'problema' && (
        <Panel>
          <PanelSection padding="md" className="space-y-3">
            <Textarea value={problemWhat} onChange={e => setProblemWhat(e.target.value)} placeholder="O que ocorreu" rows={2} disabled={!canManage} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={problemWhere} onChange={e => setProblemWhere(e.target.value)} placeholder="Onde" disabled={!canManage} />
              <Input type="number" value={problemImpactQty} onChange={e => setProblemImpactQty(e.target.value)} placeholder="Quantidade/impacto" disabled={!canManage} />
            </div>
            <Textarea value={problemExpected} onChange={e => setProblemExpected(e.target.value)} placeholder="Padrão esperado" rows={2} disabled={!canManage} />
            <Textarea value={problemObserved} onChange={e => setProblemObserved(e.target.value)} placeholder="Resultado observado" rows={2} disabled={!canManage} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" value={financialImpact} onChange={e => setFinancialImpact(e.target.value)} placeholder="Impacto financeiro (opcional)" disabled={!canManage} />
              <Input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} aria-label="Prazo do caso" disabled={!canManage} />
            </div>
            <Select value={ownerId} onChange={e => setOwnerId(e.target.value)} aria-label="Responsável pelo caso" disabled={!canManage}>
              <option value="">Responsável pelo caso...</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
            </Select>
          </PanelSection>
        </Panel>
      )}

      {step === 'evidencias' && (
        <RcaEvidenceList caseId={caseId} companyId={companyId} userId={userId} evidence={evidence} divergences={divergences} onChanged={load} />
      )}

      {step === 'cadeia' && (
        <RcaWhyChainPanel
          caseId={caseId} companyId={companyId} userId={userId} userEmail={userEmail} canManage={canManage}
          rootCauseStatus={rcaCase.root_cause_status} evidenceCount={evidenceCount} causeCategories={taxonomy}
          onRootCauseConfirmed={load}
        />
      )}

      {step === 'plano' && (
        <RcaActionPlanPanel caseId={caseId} companyId={companyId} userId={userId} userEmail={userEmail} canManage={canManage} onChanged={load} />
      )}

      {step === 'verificacao' && (
        <Panel>
          <PanelSection padding="md" className="space-y-3">
            {rcaCase.status === 'encerrado' ? (
              <p className="text-sm text-fg-muted">Caso encerrado em {rcaCase.closed_at ? new Date(rcaCase.closed_at).toLocaleDateString('pt-BR') : '—'}.</p>
            ) : closeCheck.canClose ? (
              <>
                <p className="text-sm text-fg-muted">Todos os critérios de encerramento foram atendidos.</p>
                {canManage && (
                  <Button onClick={async () => { await closeCase(caseId, companyId, userId, userEmail); await load(); }} className="w-full justify-center">
                    Encerrar caso
                  </Button>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm text-fg-muted">O caso ainda não pode ser encerrado:</p>
                <ul className="list-disc list-inside text-xs text-fg-subtle space-y-0.5">
                  {closeCheck.blockers.includes('causa_raiz_nao_confirmada') && <li>Causa raiz ainda não confirmada.</li>}
                  {closeCheck.blockers.includes('sem_acao_corretiva') && <li>Nenhuma ação corretiva registrada.</li>}
                  {closeCheck.blockers.includes('acoes_pendentes') && <li>Há ações (não-contenção) ainda não concluídas.</li>}
                  {closeCheck.blockers.includes('eficacia_nao_verificada') && <li>Eficácia das ações corretivas ainda não verificada.</li>}
                  {closeCheck.blockers.includes('bloqueio_ativo') && <li>Há uma ação bloqueada.</li>}
                </ul>
              </div>
            )}
          </PanelSection>
        </Panel>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setStep(STEPS[Math.max(0, STEPS.findIndex(s => s.key === step) - 1)].key)} disabled={step === STEPS[0].key}>
          Anterior
        </Button>
        <Button variant="secondary" onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex(s => s.key === step) + 1)].key)} disabled={step === STEPS[STEPS.length - 1].key}>
          Próxima
        </Button>
      </div>
    </Page>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-sm font-semibold text-fg">{value}</p>
    </div>
  );
}
