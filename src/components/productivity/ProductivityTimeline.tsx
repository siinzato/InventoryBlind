import { Award } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { AchievementDefinition, UserAchievement, AchievementLevel } from '../../lib/supabase';

interface ProductivityTimelineProps {
  definitions: AchievementDefinition[];
  progress: UserAchievement[];
}

const LEVEL_BADGE: Record<AchievementLevel, 'neutral' | 'accent' | 'warning' | 'success'> = {
  bronze: 'neutral', prata: 'neutral', ouro: 'warning', diamante: 'accent',
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function ProductivityTimeline({ definitions, progress }: ProductivityTimelineProps) {
  const defById = new Map(definitions.map(d => [d.id, d]));
  const unlocked = progress
    .filter(p => p.unlocked && p.unlocked_at)
    .sort((a, b) => new Date(b.unlocked_at!).getTime() - new Date(a.unlocked_at!).getTime());

  return (
    <Panel>
      <PanelSection padding="md">
        <p className="text-section mb-3">Timeline de Conquistas</p>
        {unlocked.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhuma conquista desbloqueada ainda.</p>
        ) : (
          <div className="space-y-3">
            {unlocked.map(p => {
              const def = defById.get(p.achievement_definition_id);
              if (!def) return null;
              return (
                <div key={p.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Award size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-fg">{def.title}</p>
                      <Badge variant={LEVEL_BADGE[def.level]} className="capitalize">{def.level}</Badge>
                    </div>
                    <p className="text-xs text-fg-subtle">{formatDate(p.unlocked_at!)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}
