import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { Modal, Button, Badge } from '../ui';
import { supabase, UserProductivityStats } from '../../lib/supabase';
import { getRoleLabel } from '../../lib/permissionService';
import { computeCompetencyLevels } from '../../lib/productivityService';
import { getAchievementProgress } from '../../lib/achievementService';
import { ProductivityCards } from './ProductivityCards';
import { CompetencyLevels } from './CompetencyLevels';
import { AchievementGrid } from './AchievementGrid';
import { ProductivityReportExport } from './ProductivityReportExport';
import { EmployeeIncentiveModal } from './EmployeeIncentiveModal';
import { AchievementDefinition, UserAchievement } from '../../lib/supabase';

interface EmployeeProfileProps {
  stats: UserProductivityStats;
  rank: number;
  totalPeers: number;
  companyId: string;
  currentUserId: string;
  currentUserEmail: string;
  onClose: () => void;
}

export function EmployeeProfile({ stats, rank, totalPeers, companyId, currentUserId, currentUserEmail, onClose }: EmployeeProfileProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<AchievementDefinition[]>([]);
  const [progress, setProgress] = useState<UserAchievement[]>([]);
  const [showIncentiveModal, setShowIncentiveModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.from('profiles').select('email').eq('id', stats.user_id).maybeSingle().then(({ data }) => {
      if (!cancelled) setEmail(data?.email ?? null);
    });
    getAchievementProgress(stats.user_id, companyId).then(({ definitions: defs, progress: prog }) => {
      if (!cancelled) { setDefinitions(defs); setProgress(prog); }
    });
    return () => { cancelled = true; };
  }, [stats.user_id, companyId]);

  const competencies = computeCompetencyLevels(stats);

  return (
    <Modal open onClose={onClose} title={stats.name ?? 'Colaborador'} maxWidth="max-w-4xl">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Badge variant="neutral">{getRoleLabel(stats.role)}</Badge>
          <Button size="sm" onClick={() => setShowIncentiveModal(true)}>
            <Gift size={14} /> Enviar Incentivo
          </Button>
        </div>

        <ProductivityCards stats={stats} rank={rank} totalPeers={totalPeers} />
        <CompetencyLevels levels={competencies} />
        <AchievementGrid definitions={definitions} progress={progress} />
        <ProductivityReportExport
          employeeName={stats.name ?? 'Colaborador'}
          userId={stats.user_id}
          companyId={companyId}
          userEmail={currentUserEmail}
          stats={stats}
          rank={rank}
        />
      </div>

      {showIncentiveModal && (
        <EmployeeIncentiveModal
          employeeUserId={stats.user_id}
          employeeName={stats.name ?? 'Colaborador'}
          employeeEmail={email}
          companyId={companyId}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          unlockedLevels={progress.filter(p => p.unlocked).map(p => definitions.find(d => d.id === p.achievement_definition_id)?.level).filter((l): l is NonNullable<typeof l> => !!l)}
          onClose={() => setShowIncentiveModal(false)}
        />
      )}
    </Modal>
  );
}
