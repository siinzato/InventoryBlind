// I.B Academy — trilhas/cursos/aulas/quiz/progresso. Tracks/courses/lessons/quizzes são
// catálogo global (mesmo modelo de achievement_definitions); enrollments/progress/attempts
// são por usuário+empresa, seguindo o shape de RLS de productivityService.ts.

import {
  supabase,
  AcademyTrack,
  AcademyCourse,
  AcademyLesson,
  AcademyQuiz,
  AcademyQuizQuestion,
  AcademyTrackProgressRow,
  AcademyTeamSummaryRow,
  LibraryResource,
  AchievementDefinition,
} from './supabase';
import { logAuditEvent } from './auditLogService';
import { downloadFileName, resolveEbookAccess } from './academy/libraryEbooks';

export async function getTracks(): Promise<AcademyTrack[]> {
  const { data, error } = await supabase.from('academy_tracks').select('*').order('order_index');
  if (error) { console.error('Error loading academy tracks:', error); return []; }
  return (data ?? []) as AcademyTrack[];
}

export async function getTrackWithCourses(trackId: string): Promise<{ track: AcademyTrack | null; courses: AcademyCourse[] }> {
  const [{ data: track, error: trackError }, { data: courses, error: coursesError }] = await Promise.all([
    supabase.from('academy_tracks').select('*').eq('id', trackId).maybeSingle(),
    supabase.from('academy_courses').select('*').eq('track_id', trackId).order('order_index'),
  ]);
  if (trackError) console.error('Error loading academy track:', trackError);
  if (coursesError) console.error('Error loading academy track courses:', coursesError);
  return { track: (track ?? null) as AcademyTrack | null, courses: (courses ?? []) as AcademyCourse[] };
}

export type CourseWithQuiz = AcademyQuiz & { questions: AcademyQuizQuestion[] };

export async function getCourseWithLessons(courseId: string): Promise<{
  course: AcademyCourse | null;
  lessons: AcademyLesson[];
  quiz: CourseWithQuiz | null;
}> {
  const [{ data: course, error: courseError }, { data: lessons, error: lessonsError }, { data: quiz, error: quizError }] = await Promise.all([
    supabase.from('academy_courses').select('*').eq('id', courseId).maybeSingle(),
    supabase.from('academy_lessons').select('*').eq('course_id', courseId).order('order_index'),
    supabase.from('academy_quizzes').select('*').eq('course_id', courseId).maybeSingle(),
  ]);
  if (courseError) console.error('Error loading academy course:', courseError);
  if (lessonsError) console.error('Error loading academy lessons:', lessonsError);
  if (quizError) console.error('Error loading academy quiz:', quizError);

  let fullQuiz: CourseWithQuiz | null = null;
  if (quiz) {
    const { data: questions, error: qError } = await supabase
      .from('academy_quiz_questions').select('*').eq('quiz_id', quiz.id).order('order_index');
    if (qError) console.error('Error loading quiz questions:', qError);
    fullQuiz = { ...(quiz as AcademyQuiz), questions: (questions ?? []) as AcademyQuizQuestion[] };
  }

  return {
    course: (course ?? null) as AcademyCourse | null,
    lessons: (lessons ?? []) as AcademyLesson[],
    quiz: fullQuiz,
  };
}

export async function enrollInTrack(userId: string, companyId: string, trackId: string): Promise<void> {
  const { error } = await supabase
    .from('academy_enrollments')
    .upsert({ user_id: userId, company_id: companyId, track_id: trackId }, { onConflict: 'user_id,track_id', ignoreDuplicates: true });
  if (error) console.error('Error enrolling in academy track:', error);
}

export async function startCourse(userId: string, userEmail: string, companyId: string, courseId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('academy_course_progress').select('id').eq('user_id', userId).eq('course_id', courseId).maybeSingle();
  if (existing) return;

  const { error } = await supabase.from('academy_course_progress').insert({
    user_id: userId, company_id: companyId, course_id: courseId, status: 'in_progress', started_at: new Date().toISOString(),
  });
  if (error) { console.error('Error starting academy course:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'academy.course_started', resourceType: 'academy_course', resourceId: courseId });
}

export async function markLessonComplete(userId: string, companyId: string, lessonId: string): Promise<void> {
  const { error } = await supabase
    .from('academy_lesson_progress')
    .upsert(
      { user_id: userId, company_id: companyId, lesson_id: lessonId, completed: true, completed_at: new Date().toISOString() },
      { onConflict: 'user_id,lesson_id' }
    );
  if (error) console.error('Error marking lesson complete:', error);
}

export async function completeCourseIfEligible(userId: string, userEmail: string, companyId: string, courseId: string): Promise<void> {
  const { error } = await supabase
    .from('academy_course_progress')
    .upsert(
      { user_id: userId, company_id: companyId, course_id: courseId, status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,course_id' }
    );
  if (error) { console.error('Error completing academy course:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'academy.course_completed', resourceType: 'academy_course', resourceId: courseId });
}

/** Gating: a course is accessible if it's the first in its track, or the previous
 *  course (by order_index) has status 'completed' — same "no separate RPC, checked
 *  client-side" trust model already used for quiz-gating elsewhere in this app. */
export async function canAccessCourse(userId: string, trackId: string, courseId: string): Promise<boolean> {
  const { courses } = await getTrackWithCourses(trackId);
  const idx = courses.findIndex(c => c.id === courseId);
  if (idx <= 0) return true;

  const prevCourse = courses[idx - 1];
  const { data, error } = await supabase
    .from('academy_course_progress').select('status').eq('user_id', userId).eq('course_id', prevCourse.id).maybeSingle();
  if (error) { console.error('Error checking academy course access:', error); return true; }
  return data?.status === 'completed';
}

export async function submitQuizAttempt(
  userId: string,
  userEmail: string,
  companyId: string,
  quiz: CourseWithQuiz,
  answers: number[]
): Promise<{ score_pct: number; passed: boolean }> {
  const correct = quiz.questions.filter((q, i) => answers[i] === q.correct_index).length;
  const score_pct = quiz.questions.length > 0 ? Math.round((correct / quiz.questions.length) * 100) : 0;
  const passed = score_pct >= quiz.min_pass_pct;

  const { error } = await supabase.from('academy_quiz_attempts').insert({
    user_id: userId, company_id: companyId, quiz_id: quiz.id, answers, score_pct, passed,
  });
  if (error) console.error('Error submitting quiz attempt:', error);

  await logAuditEvent({
    companyId, userId, userEmail, action: 'academy.quiz_attempted',
    resourceType: 'academy_quiz', resourceId: quiz.id, metadata: { score_pct, passed },
  });

  if (passed) {
    await completeCourseIfEligible(userId, userEmail, companyId, quiz.course_id);
  }

  return { score_pct, passed };
}

export async function getMyTrackProgress(userId: string): Promise<AcademyTrackProgressRow[]> {
  const { data, error } = await supabase.from('academy_track_progress_v').select('*').eq('user_id', userId);
  if (error) { console.error('Error loading academy track progress:', error); return []; }
  return (data ?? []) as AcademyTrackProgressRow[];
}

export async function getTeamAcademySummary(companyId: string): Promise<AcademyTeamSummaryRow[]> {
  const { data, error } = await supabase.from('academy_team_summary_v').select('*').eq('company_id', companyId);
  if (error) { console.error('Error loading team academy summary:', error); return []; }
  return (data ?? []) as AcademyTeamSummaryRow[];
}

export async function getPilarChecklistProgress(userId: string, companyId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from('pilar_checklist_progress').select('item_key, checked').eq('user_id', userId).eq('company_id', companyId);
  if (error) { console.error('Error loading pilar checklist progress:', error); return {}; }
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.item_key] = row.checked;
  return map;
}

export async function togglePilarChecklistItem(userId: string, companyId: string, itemKey: string, checked: boolean): Promise<void> {
  const { error } = await supabase
    .from('pilar_checklist_progress')
    .upsert({ user_id: userId, company_id: companyId, item_key: itemKey, checked, updated_at: new Date().toISOString() }, { onConflict: 'user_id,item_key' });
  if (error) console.error('Error updating pilar checklist item:', error);
}

export async function getLibraryResources(): Promise<LibraryResource[]> {
  const { data, error } = await supabase.from('library_resources').select('*').order('order_index');
  if (error) { console.error('Error loading library resources:', error); return []; }
  return (data ?? []) as LibraryResource[];
}

// ── Biblioteca: leitura e download dos PDFs ──────────────────────────────────────────────
// O bucket academy-library é privado (migration 105), então o arquivo só é acessível por
// signed URL. A URL é resolvida SOB DEMANDA, no clique: assinar os PDFs de todo o catálogo
// durante o carregamento da lista seria uma requisição por material (N+1) e as URLs
// expirariam antes de serem usadas. As regras de qual caminho usar (Storage x arquivo legado)
// ficam em academy/libraryEbooks.ts.

const LIBRARY_BUCKET = 'academy-library';
/** Vida da signed URL: suficiente para abrir/baixar o arquivo, curta o bastante para o link
 *  não circular indefinidamente. */
const SIGNED_URL_TTL_SECONDS = 600;

/** URL para ABRIR o PDF em nova guia. Lança erro com mensagem exibível quando o material não
 *  tem arquivo ou o Storage falha — o chamador mostra o erro, nunca engole a Promise. */
export async function getLibraryResourceReadUrl(resource: LibraryResource): Promise<string> {
  const { file } = resolveEbookAccess(resource);
  if (!file) throw new Error('Este material ainda não tem arquivo disponível.');
  if (file.kind === 'legacy') return file.url;

  const { data, error } = await supabase.storage
    .from(LIBRARY_BUCKET)
    .createSignedUrl(file.path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error('Error signing library resource URL:', error);
    throw new Error('Não foi possível abrir o material agora. Tente novamente.');
  }
  return data.signedUrl;
}

/** Baixa o arquivo de verdade. Para o Storage privado, `download()` traz o blob (um <a download>
 *  apontando para outra origem seria ignorado pelo navegador); para o arquivo legado, busca o
 *  próprio arquivo servido pelo app. */
export async function downloadLibraryResource(resource: LibraryResource): Promise<void> {
  const { file } = resolveEbookAccess(resource);
  if (!file) throw new Error('Este material ainda não tem arquivo disponível.');

  let blob: Blob;
  if (file.kind === 'storage') {
    const { data, error } = await supabase.storage.from(LIBRARY_BUCKET).download(file.path);
    if (error || !data) {
      console.error('Error downloading library resource:', error);
      throw new Error('Não foi possível baixar o material agora. Tente novamente.');
    }
    blob = data;
  } else {
    const response = await fetch(file.url).catch((thrown: unknown) => {
      console.error('Error fetching legacy library file:', thrown);
      throw new Error('Não foi possível baixar o material agora. Tente novamente.');
    });
    if (!response.ok) throw new Error('Não foi possível baixar o material agora. Tente novamente.');
    blob = await response.blob();
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = downloadFileName(resource);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ── Academy achievements — extends the existing achievement_definitions/user_achievements
// tables (see achievementService.ts) with a second, independent computation path so the
// productivity-metric logic there stays untouched. ──────────────────────────────────────

function computeAcademyProgress(
  def: AchievementDefinition,
  summary: AcademyTeamSummaryRow,
  specialists: { organizacao: boolean; inventarioCego: boolean; enderecamento: boolean }
): number {
  switch (def.goal_metric) {
    case 'academy_courses_completed': return summary.courses_completed;
    case 'academy_certificates':
    case 'academy_instructor': return summary.certificates_count;
    case 'academy_hours_studied': return summary.hours_studied;
    case 'academy_organizacao_specialist': return specialists.organizacao ? 1 : 0;
    case 'academy_blind_inventory_master': return specialists.inventarioCego ? 1 : 0;
    case 'academy_enderecamento_specialist': return specialists.enderecamento ? 1 : 0;
    default: return 0;
  }
}

interface CompletedCourseRow {
  course_id: string;
  academy_courses: { key: string; pilar_tag: string | null } | null;
}

export async function checkAndUnlockAcademyAchievements(userId: string, companyId: string): Promise<void> {
  const { data: summaryRow, error: summaryError } = await supabase
    .from('academy_team_summary_v').select('*').eq('user_id', userId).maybeSingle();
  if (summaryError) { console.error('Error loading academy summary:', summaryError); return; }
  if (!summaryRow) return;
  const summary = summaryRow as AcademyTeamSummaryRow;

  const { data: completedCourses, error: coursesError } = await supabase
    .from('academy_course_progress')
    .select('course_id, academy_courses(key, pilar_tag)')
    .eq('user_id', userId)
    .eq('status', 'completed');
  if (coursesError) console.error('Error loading completed academy courses:', coursesError);

  const completed = (completedCourses ?? []) as unknown as CompletedCourseRow[];
  const specialists = {
    organizacao: completed.some(c => c.academy_courses?.key === 'fundamentos_metodo_ib'),
    inventarioCego: completed.some(c => c.academy_courses?.pilar_tag === 'inventario_cego'),
    enderecamento: completed.some(c => c.academy_courses?.pilar_tag === 'enderecamento'),
  };

  const { data: definitions, error: defError } = await supabase
    .from('achievement_definitions').select('*').eq('category', 'I.B Academy');
  if (defError || !definitions) { if (defError) console.error('Error loading academy achievement definitions:', defError); return; }

  const { data: existing } = await supabase
    .from('user_achievements').select('achievement_definition_id, unlocked_at').eq('user_id', userId).eq('company_id', companyId);
  const existingByDefId = new Map((existing ?? []).map(r => [r.achievement_definition_id as string, r]));

  const rows = (definitions as AchievementDefinition[]).map(def => {
    const progressValue = computeAcademyProgress(def, summary, specialists);
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

  const { error } = await supabase.from('user_achievements').upsert(rows, { onConflict: 'user_id,achievement_definition_id' });
  if (error) console.error('Error upserting academy achievements:', error);
}
