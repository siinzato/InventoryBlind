import { useEffect, useState } from 'react';
import { Users, Target, TrendingUp, Package, Zap, Star, AlertTriangle, Award } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { UserProductivityStats } from '../../lib/supabase';
import { getTeamProductivity, rankTeam } from '../../lib/productivityService';
import { getTeamUnlockedCounts } from '../../lib/achievementService';
import { EmployeeProductivityTable } from './EmployeeProductivityTable';
import { EmployeeProfile } from './EmployeeProfile';
import { TeamProductivityReport } from './TeamProductivityReport';

interface ManagerProductivityViewProps {
  companyId: string;
  currentUserId: string;
  currentUserEmail: string;
}

export function ManagerProductivityView({ companyId, currentUserId, currentUserEmail }: ManagerProductivityViewProps) {
  const [team, setTeam] = useState<UserProductivityStats[]>([]);
  const [achievementCounts, setAchievementCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getTeamProductivity(companyId), getTeamUnlockedCounts(companyId)]).then(([stats, counts]) => {
      if (cancelled) return;
      setTeam(stats);
      setAchievementCounts(counts);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando dados da equipe...</PanelSection></Panel>;
  }

  const ranked = rankTeam(team);
  const active = team.filter(t => t.contagens > 0 || t.fulls_realizados > 0 || t.etiquetas_geradas > 0);
  const bestAccuracy = [...team].filter(t => t.acuracidade_media !== null).sort((a, b) => (b.acuracidade_media ?? 0) - (a.acuracidade_media ?? 0))[0];
  const mostProductive = [...team].sort((a, b) => b.skus_contados - a.skus_contados)[0];
  const mostSkus = mostProductive;
  const mostFulls = [...team].sort((a, b) => b.fulls_realizados - a.fulls_realizados)[0];
  const destaques = ranked.slice(0, 3).filter(t => t.contagens > 0);
  const baixaProdutividade = team.filter(t => t.contagens > 0 && t.skus_contados < 500);
  const totalAchievementsThisPeriod = Array.from(achievementCounts.values()).reduce((a, b) => a + b, 0);

  const cards = [
    { label: 'Colaboradores Ativos', value: active.length, icon: Users },
    { label: 'Melhor Acuracidade', value: bestAccuracy ? `${(bestAccuracy.acuracidade_media ?? 0).toFixed(1)}% (${bestAccuracy.name ?? '—'})` : '—', icon: Target },
    { label: 'Maior Produtividade', value: mostProductive?.name ?? '—', icon: TrendingUp },
    { label: 'Mais SKUs Contados', value: mostSkus ? mostSkus.skus_contados.toLocaleString('pt-BR') : '0', icon: Package },
    { label: 'Mais Fulls', value: mostFulls ? `${mostFulls.fulls_realizados} (${mostFulls.name ?? '—'})` : '—', icon: Zap },
    { label: 'Colaboradores em Destaque', value: destaques.length, icon: Star },
    { label: 'Baixa Produtividade', value: baixaProdutividade.length, icon: AlertTriangle },
    { label: 'Conquistas do Período', value: totalAchievementsThisPeriod, icon: Award },
  ];

  const selectedEmployee = selectedEmployeeId ? team.find(t => t.user_id === selectedEmployeeId) ?? null : null;

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
        <TeamProductivityReport companyId={companyId} team={ranked} userId={currentUserId} userEmail={currentUserEmail} />
      </Panel>

      <EmployeeProductivityTable team={ranked} achievementCounts={achievementCounts} onSelectEmployee={setSelectedEmployeeId} />

      {selectedEmployee && (
        <EmployeeProfile
          stats={selectedEmployee}
          rank={ranked.findIndex(t => t.user_id === selectedEmployee.user_id) + 1}
          totalPeers={ranked.length}
          companyId={companyId}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          onClose={() => setSelectedEmployeeId(null)}
        />
      )}
    </div>
  );
}
