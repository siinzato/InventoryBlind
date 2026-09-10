import type { ComponentType } from 'react';
import * as Icons from 'lucide-react';
import { Award, Lock } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { AchievementDefinition, UserAchievement, AchievementLevel } from '../../lib/supabase';

interface AchievementGridProps {
  definitions: AchievementDefinition[];
  progress: UserAchievement[];
}

const LEVEL_BADGE: Record<AchievementLevel, 'neutral' | 'accent' | 'warning' | 'success'> = {
  bronze: 'neutral',
  prata: 'neutral',
  ouro: 'warning',
  diamante: 'accent',
};

function AchievementIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name] ?? Award;
  return <Icon className={className} />;
}

export function AchievementGrid({ definitions, progress }: AchievementGridProps) {
  const progressByDefId = new Map(progress.map(p => [p.achievement_definition_id, p]));
  const categories = Array.from(new Set(definitions.map(d => d.category)));

  return (
    <Panel>
      {categories.map(category => (
        <PanelSection key={category} padding="md">
          <p className="text-section mb-3">{category}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {definitions.filter(d => d.category === category).map(def => {
              const p = progressByDefId.get(def.id);
              const unlocked = p?.unlocked ?? false;
              const pct = Math.min(100, Math.round(((p?.progress_value ?? 0) / def.goal_value) * 100));

              return (
                <div
                  key={def.id}
                  className={`rounded-xl border p-3 flex flex-col items-center text-center gap-1.5 ${
                    unlocked ? 'border-edge bg-surface-3/40' : 'border-edge/60 opacity-60 grayscale'
                  }`}
                  title={def.description}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${unlocked ? 'bg-accent/10 text-accent' : 'bg-surface-3 text-fg-subtle'}`}>
                    {unlocked ? <AchievementIcon name={def.icon} className="w-5 h-5" /> : <Lock size={16} />}
                  </div>
                  <p className="text-xs font-semibold text-fg leading-tight">{def.title}</p>
                  <Badge variant={LEVEL_BADGE[def.level]} className="capitalize">{def.level}</Badge>
                  {!unlocked && (
                    <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden mt-1">
                      <div className="h-full bg-accent/60" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </Panel>
  );
}
