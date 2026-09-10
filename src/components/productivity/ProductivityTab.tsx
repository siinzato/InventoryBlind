import { useEffect, useState } from 'react';
import { User, Users } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, SegmentedControl } from '../ui';
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
    <Page>
      <PageHeader title="Produtividade" description="Acompanhe sua evolução, conquistas e desempenho." />

      {canViewTeam && (
        <SegmentedControl
          label="Visão de produtividade"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'mine', label: 'Minha Produtividade', icon: User },
            { value: 'team', label: 'Visão de Gestor', icon: Users },
          ]}
        />
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
    </Page>
  );
}
