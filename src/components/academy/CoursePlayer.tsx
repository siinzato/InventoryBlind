import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Circle, HelpCircle } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import { getCourseWithLessons, startCourse, markLessonComplete, CourseWithQuiz } from '../../lib/academyService';
import { supabase } from '../../lib/supabase';
import { LessonView } from './LessonView';
import { QuizView } from './QuizView';
import type { AcademyCourse, AcademyLesson, AcademyLessonProgress } from '../../lib/supabase';

interface CoursePlayerProps {
  courseId: string;
  trackId: string;
  userId: string;
  userEmail: string;
  companyId: string;
  onBack: () => void;
}

type Selection = { type: 'lesson'; id: string } | { type: 'quiz' };

export function CoursePlayer({ courseId, userId, userEmail, companyId, onBack }: CoursePlayerProps) {
  const [course, setCourse] = useState<AcademyCourse | null>(null);
  const [lessons, setLessons] = useState<AcademyLesson[]>([]);
  const [quiz, setQuiz] = useState<CourseWithQuiz | null>(null);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await startCourse(userId, userEmail, companyId, courseId);
      const { course: c, lessons: l, quiz: q } = await getCourseWithLessons(courseId);
      if (cancelled) return;
      setCourse(c);
      setLessons(l);
      setQuiz(q);
      setSelection(l.length > 0 ? { type: 'lesson', id: l[0].id } : q ? { type: 'quiz' } : null);

      if (l.length > 0) {
        const { data: lp } = await supabase
          .from('academy_lesson_progress').select('*').eq('user_id', userId).in('lesson_id', l.map(x => x.id));
        if (!cancelled) {
          setCompletedLessons(new Set(
            (lp ?? []).filter((r: AcademyLessonProgress) => r.completed).map((r: AcademyLessonProgress) => r.lesson_id)
          ));
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [courseId, userId, userEmail, companyId]);

  const handleLessonComplete = async (lessonId: string) => {
    await markLessonComplete(userId, companyId, lessonId);
    setCompletedLessons(prev => new Set(prev).add(lessonId));
  };

  if (loading || !course) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando curso...</PanelSection></Panel>;
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar à Trilha</Button>

      <Panel>
        <PanelSection padding="lg">
          <h2 className="text-xl font-bold text-fg">{course.title}</h2>
          <p className="text-sm text-fg-muted mt-1">{course.objectives}</p>
        </PanelSection>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <Panel className="h-fit">
          <PanelSection padding="sm">
            <div className="space-y-1">
              {lessons.map(lesson => (
                <button
                  key={lesson.id}
                  onClick={() => setSelection({ type: 'lesson', id: lesson.id })}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                    selection?.type === 'lesson' && selection.id === lesson.id
                      ? 'bg-accent/10 text-fg font-medium'
                      : 'text-fg-muted hover:bg-surface-3'
                  }`}
                >
                  {completedLessons.has(lesson.id) ? (
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                  ) : (
                    <Circle size={14} className="flex-shrink-0" />
                  )}
                  <span className="truncate">{lesson.title}</span>
                </button>
              ))}
              {quiz && (
                <button
                  onClick={() => setSelection({ type: 'quiz' })}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                    selection?.type === 'quiz' ? 'bg-accent/10 text-fg font-medium' : 'text-fg-muted hover:bg-surface-3'
                  }`}
                >
                  <HelpCircle size={14} className="flex-shrink-0" /> Quiz Final
                </button>
              )}
            </div>
          </PanelSection>
        </Panel>

        <div>
          {selection?.type === 'lesson' && (
            <LessonView
              lesson={lessons.find(l => l.id === selection.id)!}
              completed={completedLessons.has(selection.id)}
              onComplete={() => handleLessonComplete(selection.id)}
            />
          )}
          {selection?.type === 'quiz' && quiz && (
            <QuizView quiz={quiz} userId={userId} userEmail={userEmail} companyId={companyId} />
          )}
          {!selection && (
            <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Este curso ainda não tem conteúdo publicado.</PanelSection></Panel>
          )}
        </div>
      </div>
    </div>
  );
}
