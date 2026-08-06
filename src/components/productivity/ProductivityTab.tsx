import { useEffect, useState } from 'react';
import { User, Users } from 'lucide-react';
import { PageHeader, Panel, PanelSection } from '../ui';
import { UserProductivityStats } from '../../lib/supabase';
import { getMyProductivity, computeCompetencyLevels } from '../../lib/productivityService';
import { getAchievementProgress, checkAndUnlockAchievements } from '../../lib/achievementService';
import { checkAndUnlockAcademyAchievements } from '../../lib/academyService';
import { logAuditEvent } from '../../lib/auditLogService';
import { hasPermission } from '../../lib/permissionService';
import { ProductivityCards } from './ProductivityCards';
import { AchievementGrid } from './AchievementGrid';
import { CompetencyLevels } from './CompetencyLevels';
import { ProductivityTimeline } from './ProductivityTimeline';
import { ProductivityReportExport } from './ProductivityReportExport';
import { ManagerProductivityView } from './ManagerProductivityView';
import { AcademyProductivitySection } from '../academy/AcademyProductivitySection';
import type { AchievementDefinition, UserAchievement } from '../../lib/supabase';

interface ProductivityTabProps {
  userId: string;
  userEmail: string;
  companyId: string;
  role: string | undefined;
}

type Mode = 'mine' | 'team';

export function ProductivityTab({ userId, userEmail, companyId, role }: ProductivityTabProps) {
  const [mode, setMode] = useState<Mode>('mine');
  const [stats, setStats] = useState<UserProductivityStats | null>(null);
  const [definitions, setDefinitions] = useState<AchievementDefinition[]>([]);
  const [progress, setProgress] = useState<UserAchievement[]>([]);
  const [loading, setLoading] = useState(true);

  const canViewTeam = hasPermission(role, 'users.manage') || role === 'manager' || role === 'lead';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([checkAndUnlockAchievements(userId, companyId), checkAndUnlockAcademyAchievements(userId, companyId)]).finally(() => {
      Promise.all([getMyProductivity(userId), getAchievementProgress(userId, companyId)]).then(([s, ach]) => {
        if (cancelled) return;
        setStats(s);
        setDefinitions(ach.definitions);
        setProgress(ach.progress);
        setLoading(false);
      });
    });
    return () => { cancelled = true; };
  }, [userId, companyId]);

  useEffect(() => {
    if (mode === 'team') {
      logAuditEvent({ companyId, userId, userEmail, action: 'productivity.view_team' });
    }
  }, [mode, companyId, userId, userEmail]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader title="Produtividade" description="Acompanhe sua evolução, conquistas e desempenho." />

      {canViewTeam && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('mine')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'mine' ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'}`}
          >
            <User size={16} /> Minha Produtividade
          </button>
          <button
            onClick={() => setMode('team')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'team' ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'}`}
          >
            <Users size={16} /> Visão de Gestor
          </button>
        </div>
      )}

      {mode === 'team' && canViewTeam ? (
        <ManagerProductivityView companyId={companyId} currentUserId={userId} currentUserEmail={userEmail} role={role} />
      ) : loading || !stats ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando produtividade...</PanelSection></Panel>
      ) : (
        <>
          <ProductivityCards stats={stats} />
          <CompetencyLevels levels={computeCompetencyLevels(stats)} />
          <AchievementGrid definitions={definitions} progress={progress} />
          <AcademyProductivitySection userId={userId} companyId={companyId} />
          <ProductivityTimeline definitions={definitions} progress={progress} />
          <Panel>
            <ProductivityReportExport
              employeeName={stats.name ?? 'Você'}
              userId={userId}
              companyId={companyId}
              userEmail={userEmail}
              stats={stats}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
