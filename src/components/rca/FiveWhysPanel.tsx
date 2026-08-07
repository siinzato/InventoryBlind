import { useEffect, useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Panel, PanelSection, Button, Badge } from '../ui';
import {
  getOpenFiveWhysSessions, getFiveWhysAnswers, answerFiveWhys, completeFiveWhysSession,
} from '../../lib/rcaService';
import type { RcaFiveWhysSession, RcaFiveWhysAnswer } from '../../lib/supabase';

interface FiveWhysPanelProps {
  companyId: string;
  userId: string;
  userEmail: string;
  canManage: boolean;
}

function SessionCard({ session, companyId, userId, userEmail, canManage, onChanged }: {
  session: RcaFiveWhysSession; companyId: string; userId: string; userEmail: string; canManage: boolean; onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [answers, setAnswers] = useState<RcaFiveWhysAnswer[]>([]);
  const [draft, setDraft] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expanded) getFiveWhysAnswers(session.id, companyId).then(setAnswers);
  }, [expanded, session.id, companyId]);

  const nextLevel = answers.length + 1;

  const handleAnswer = async () => {
    if (!draft.trim() || nextLevel > 5) return;
    setSaving(true);
    await answerFiveWhys(session.id, companyId, nextLevel, draft.trim(), userId, userEmail);
    setDraft('');
    setAnswers(await getFiveWhysAnswers(session.id, companyId));
    setSaving(false);
  };

  const handleComplete = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    await completeFiveWhysSession(session.id, companyId, summary.trim(), userId, userEmail);
    setSaving(false);
    onChanged();
  };

  return (
    <div className="border border-edge rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-surface-3/50 transition-colors text-left">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">
            {session.trigger_type === 'sku' ? `SKU ${session.trigger_key}` : `Causa: ${session.trigger_key}`} recorrente
          </p>
          <p className="text-xs text-fg-subtle">{session.occurrence_count} ocorrências nos últimos {session.window_days} dias</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-fg-subtle flex-shrink-0" /> : <ChevronDown size={16} className="text-fg-subtle flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="p-3.5 border-t border-edge space-y-3">
          {answers.map(a => (
            <div key={a.id} className="flex gap-2 text-sm">
              <span className="font-bold text-accent flex-shrink-0">{a.level}º Por quê?</span>
              <span className="text-fg-muted">{a.answer}</span>
            </div>
          ))}

          {canManage && nextLevel <= 5 && (
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={`${nextLevel}º Por quê?`}
                className="flex-1 p-2 border border-edge rounded-lg bg-surface text-sm text-fg"
              />
              <Button size="sm" onClick={handleAnswer} disabled={saving || !draft.trim()}>Responder</Button>
            </div>
          )}

          {canManage && nextLevel > 4 && (
            <div className="pt-2 border-t border-edge space-y-2">
              <label className="block text-xs font-semibold text-fg-subtle uppercase">Causa raiz identificada</label>
              <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} className="w-full p-2 border border-edge rounded-lg bg-surface text-sm text-fg resize-none" />
              <Button size="sm" onClick={handleComplete} disabled={saving || !summary.trim()}>Concluir análise</Button>
            </div>
          )}

          {!canManage && <p className="text-xs text-fg-subtle">Apenas owner/admin/manager podem conduzir a análise de 5 Porquês.</p>}
        </div>
      )}
    </div>
  );
}

/** Fila de investigações "5 Porquês" abertas automaticamente por recorrência
 *  (rcaService.createRcaRecord → checkAndOpenFiveWhys). Cada sessão trava o próximo
 *  nível até o anterior ser respondido, até um máximo de 5. */
export function FiveWhysPanel({ companyId, userId, userEmail, canManage }: FiveWhysPanelProps) {
  const [sessions, setSessions] = useState<RcaFiveWhysSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); getOpenFiveWhysSessions(companyId).then(s => { setSessions(s); setLoading(false); }); };
  useEffect(load, [companyId]);

  return (
    <Panel>
      <PanelSection padding="md" className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-section flex items-center gap-1.5"><HelpCircle size={14} /> Análises "5 Porquês" abertas</p>
          {sessions.length > 0 && <Badge variant="warning">{sessions.length} pendente{sessions.length > 1 ? 's' : ''}</Badge>}
        </div>
        {loading ? (
          <p className="text-xs text-fg-subtle">Carregando...</p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-fg-subtle">Nenhuma recorrência detectada no momento.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <SessionCard key={s.id} session={s} companyId={companyId} userId={userId} userEmail={userEmail} canManage={canManage} onChanged={load} />
            ))}
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}
