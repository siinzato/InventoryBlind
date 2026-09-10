// Conquistas — compara user_productivity_stats_v com achievement_definitions e faz upsert em user_achievements

import { supabase, AchievementDefinition, UserAchievement, UserProductivityStats } from './supabase';
import { getMyProductivity } from './productivityService';

const NUMERIC_METRICS: Record<string, keyof UserProductivityStats> = {
  skus_contados: 'skus_contados',
  contagens: 'contagens',
  recontagens: 'recontagens',
  fulls_realizados: 'fulls_realizados',
  etiquetas_geradas: 'etiquetas_geradas',
  acuracidade_media: 'acuracidade_media',
};

function computeProgress(def: AchievementDefinition, stats: UserProductivityStats): number {
  if (def.goal_metric === 'composite') {
    // 'estoquista_blind' — high volume + high accuracy combined
    const meets = stats.skus_contados >= 10000 && (stats.acuracidade_media ?? 0) >= 97;
    return meets ? 1 : 0;
  }

  const field = NUMERIC_METRICS[def.goal_metric];
  if (!field) return 0;
  return Number(stats[field] ?? 0);
}

export async function getTeamUnlockedCounts(companyId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('unlocked', true);

  if (error || !data) {
    console.error('Error loading team achievement counts:', error);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  return counts;
}

export async function getAchievementProgress(userId: string, companyId: string): Promise<{
  definitions: AchievementDefinition[];
  progress: UserAchievement[];
}> {
  const [{ data: definitions, error: defError }, { data: progress, error: progError }] = await Promise.all([
    supabase.from('achievement_definitions').select('*').order('order_index'),
    supabase.from('user_achievements').select('*').eq('user_id', userId).eq('company_id', companyId),
  ]);

  if (defError) console.error('Error loading achievement definitions:', defError);
  if (progError) console.error('Error loading user achievements:', progError);

  return {
    definitions: (definitions ?? []) as AchievementDefinition[],
    progress: (progress ?? []) as UserAchievement[],
  };
}

/** Recomputes progress for every achievement definition and upserts unlocked state. Call after a
 *  count/full/label action is saved (same idea as a DB trigger, but kept client-side since the
 *  source view already aggregates live — no need for a background job). */
export async function checkAndUnlockAchievements(userId: string, companyId: string): Promise<UserAchievement[]> {
  const stats = await getMyProductivity(userId);
  if (!stats) return [];

  const { data: definitions, error: defError } = await supabase.from('achievement_definitions').select('*');
  if (defError || !definitions) {
    console.error('Error loading achievement definitions:', defError);
    return [];
  }

  const { data: existing } = await supabase
    .from('user_achievements')
    .select('achievement_definition_id, unlocked, unlocked_at')
    .eq('user_id', userId)
    .eq('company_id', companyId);

  const existingByDefId = new Map((existing ?? []).map(r => [r.achievement_definition_id as string, r]));

  const rows = (definitions as AchievementDefinition[]).map(def => {
    const progressValue = computeProgress(def, stats);
    const unlocked = progressValue >= def.goal_value;
    const prior = existingByDefId.get(def.id);
    return {
      user_id: userId,
      company_id: companyId,
      achievement_definition_id: def.id,
      progress_value: progressValue,
      unlocked,
      unlocked_at: unlocked ? (prior?.unlocked_at ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
  });

  const { data: upserted, error } = await supabase
    .from('user_achievements')
    .upsert(rows, { onConflict: 'user_id,achievement_definition_id' })
    .select();

  if (error) {
    console.error('Error upserting achievements:', error);
    return [];
  }

  return (upserted ?? []) as UserAchievement[];
}
