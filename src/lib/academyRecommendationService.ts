// I.B Academy — recomendação de cursos.
//
// Isto é um motor de REGRAS FIXAS (heurística baseada em limiares), não é IA/LLM — compara
// UserProductivityStats a thresholds definidos no código, no mesmo espírito de
// rewardSuggestionService.ts (que também não processa nada de verdade, só sugere texto).
// Nenhuma chamada a modelo de linguagem acontece aqui.

import { supabase, UserProductivityStats, AcademyCourse } from './supabase';

export interface CourseRecommendation {
  pilarTag: string;
  reason: string;
}

/** Pure rules function — no I/O, easy to unit-reason-about and to recalibrate thresholds. */
export function recommendCourses(stats: UserProductivityStats): CourseRecommendation[] {
  const recs: CourseRecommendation[] = [];

  if ((stats.acuracidade_media ?? 100) < 90) {
    recs.push({ pilarTag: 'organizacao', reason: 'Acuracidade abaixo de 90% — o Pilar Organização costuma reduzir divergências antes da contagem.' });
  }

  const divergenceRate = stats.contagens > 0 ? stats.divergencias_reais / stats.contagens : 0;
  if (divergenceRate > 0.15) {
    recs.push({ pilarTag: 'preparacao', reason: 'Muitas divergências reais por contagem — reforçar a Preparação (Pilar 4) antes do próximo inventário.' });
  }

  if ((stats.acuracidade_media ?? 0) >= 98 && stats.skus_contados >= 5000) {
    recs.push({ pilarTag: 'lideranca', reason: 'Estatísticas excelentes — pronto para a trilha de Liderança Operacional.' });
  }

  return recs;
}

export interface RecommendedCourse {
  course: AcademyCourse;
  reason: string;
}

/** Resolves recommendCourses()'s pilarTag output into real academy_courses rows (falls back
 *  gracefully — a recommended pilar may not have a real, non-placeholder course yet in this
 *  content phase). */
export async function getRecommendationsForUser(stats: UserProductivityStats): Promise<RecommendedCourse[]> {
  const ruleOutput = recommendCourses(stats);
  if (ruleOutput.length === 0) return [];

  const { data: courses, error } = await supabase
    .from('academy_courses')
    .select('*')
    .in('pilar_tag', ruleOutput.map(r => r.pilarTag))
    .eq('is_placeholder', false);

  if (error) { console.error('Error resolving academy recommendations:', error); return []; }

  const byTag = new Map((courses ?? []).map(c => [(c as AcademyCourse).pilar_tag, c as AcademyCourse]));
  const resolved: RecommendedCourse[] = [];
  for (const rec of ruleOutput) {
    const course = byTag.get(rec.pilarTag);
    if (course) resolved.push({ course, reason: rec.reason });
  }
  return resolved;
}
