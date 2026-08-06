import { useEffect, useState } from 'react';
import { GraduationCap, Award, Clock, AlertTriangle } from 'lucide-react';
import { Panel, PanelSection, Badge, Button } from '../ui';
import { getTeamAcademySummary } from '../../lib/academyService';
import { PDIManagerModal } from './PDIManagerModal';
import type { AcademyTeamSummaryRow } from '../../lib/supabase';

interface AcademyManagerViewProps {
  companyId: string;
  currentUserId: string;
  currentUserEmail: string;
}

export function AcademyManagerView({ companyId, currentUserId, currentUserEmail }: AcademyManagerViewProps) {
  const [team, setTeam] = useState<AcademyTeamSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdiTarget, setPdiTarget] = useState<AcademyTeamSummaryRow | null>(null);

  const load = () => {
    setLoading(true);
    getTeamAcademySummary(companyId).then(t => { setTeam(t); setLoading(false); });
  };

  useEffect(load, [companyId]);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando dados da Academy...</PanelSection></Panel>;
  }

  const neverAccessed = team.filter(t => t.never_accessed);
  const totalCertificates = team.reduce((s, t) => s + t.certificates_count, 0);
  const avgProgress = team.length > 0 ? Math.round(team.reduce((s, t) => s + t.courses_completed, 0) / team.length) : 0;
  const ranked = [...team].sort((a, b) => b.courses_completed - a.courses_completed || b.hours_studied - a.hours_studied);

  const cards = [
    { label: 'Colaboradores', value: team.length, icon: GraduationCap },
    { label: 'Certificados Emitidos', value: totalCertificates, icon: Award },
    { label: 'Média de Cursos Concluídos', value: avgProgress, icon: Clock },
    { label: 'Nunca Acessaram', value: neverAccessed.length, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="md" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map(card => (
            <div key={card.label} className="flex items-start gap-2.5">
              <card.icon size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-fg-subtle truncate">{card.label}</p>
                <p className="text-sm font-semibold text-fg truncate">{card.value}</p>
              </div>
            </div>
          ))}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Ranking de Aprendizagem</p>
          <div className="space-y-1">
            {ranked.map((t, i) => (
              <div key={t.user_id} className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-fg-subtle w-5 flex-shrink-0">{i + 1}º</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{t.name ?? '—'}</p>
                    <p className="text-xs text-fg-subtle">
                      {t.courses_completed} cursos · {t.hours_studied}h · {t.certificates_count} certificado(s)
                      {t.never_accessed && ' · nunca acessou'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {t.never_accessed && <Badge variant="warning">Nunca acessou</Badge>}
                  <Button variant="secondary" size="sm" onClick={() => setPdiTarget(t)}>PDI</Button>
                </div>
              </div>
            ))}
          </div>
        </PanelSection>
      </Panel>

      {pdiTarget && (
        <PDIManagerModal
          open={!!pdiTarget}
          onClose={() => setPdiTarget(null)}
          companyId={companyId}
          creatorUserId={currentUserId}
          creatorEmail={currentUserEmail}
          employeeUserId={pdiTarget.user_id}
          employeeName={pdiTarget.name ?? '—'}
          onCreated={load}
        />
      )}
    </div>
  );
}
