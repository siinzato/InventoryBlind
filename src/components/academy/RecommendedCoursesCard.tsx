import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { getMyProductivity } from '../../lib/productivityService';
import { getRecommendationsForUser, RecommendedCourse } from '../../lib/academyRecommendationService';

interface RecommendedCoursesCardProps {
  userId: string;
  companyId: string;
}

/** Renders academyRecommendationService's rule-based output — explicitly not AI, see that
 *  file's header comment. Silently renders nothing when there are no signals/matching
 *  courses yet (most tenants, most of the time, in this content phase). */
export function RecommendedCoursesCard({ userId, companyId }: RecommendedCoursesCardProps) {
  const [recs, setRecs] = useState<RecommendedCourse[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMyProductivity(userId).then(stats => {
      if (!stats) return;
      getRecommendationsForUser(stats).then(r => { if (!cancelled) setRecs(r); });
    });
    return () => { cancelled = true; };
  }, [userId, companyId]);

  if (recs.length === 0) return null;

  return (
    <Panel>
      <PanelSection padding="md">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={16} className="text-accent" />
          <p className="text-section">Recomendado para você</p>
        </div>
        <div className="space-y-2">
          {recs.map(r => (
            <div key={r.course.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-surface-3/50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{r.course.title}</p>
                <p className="text-xs text-fg-muted mt-0.5">{r.reason}</p>
              </div>
              <Badge variant="accent">Sugestão</Badge>
            </div>
          ))}
        </div>
      </PanelSection>
    </Panel>
  );
}
