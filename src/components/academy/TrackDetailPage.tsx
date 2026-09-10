import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Lock, PlayCircle, Award } from 'lucide-react';
import { Panel, PanelSection, Button, Badge } from '../ui';
import { getTrackWithCourses, enrollInTrack, canAccessCourse, getMyTrackProgress } from '../../lib/academyService';
import { hasEarnedCertificate, issueCertificateIfEligible } from '../../lib/certificateService';
import { CertificateModal } from './CertificateModal';
import { supabase } from '../../lib/supabase';
import type { AcademyTrack, AcademyCourse, AcademyCourseProgress, AcademyTrackProgressRow } from '../../lib/supabase';

interface TrackDetailPageProps {
  trackId: string;
  userId: string;
  userEmail: string;
  userName: string;
  companyId: string;
  onBack: () => void;
  onSelectCourse: (courseId: string) => void;
}

export function TrackDetailPage({ trackId, userId, userEmail, userName, companyId, onBack, onSelectCourse }: TrackDetailPageProps) {
  const [track, setTrack] = useState<AcademyTrack | null>(null);
  const [courses, setCourses] = useState<AcademyCourse[]>([]);
  const [progressByCourse, setProgressByCourse] = useState<Map<string, AcademyCourseProgress>>(new Map());
  const [accessByCourse, setAccessByCourse] = useState<Map<string, boolean>>(new Map());
  const [trackProgress, setTrackProgress] = useState<AcademyTrackProgressRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCertificate, setShowCertificate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { track: t, courses: c } = await getTrackWithCourses(trackId);
      if (cancelled) return;
      setTrack(t);
      setCourses(c);

      if (c.length > 0) {
        const { data: progressRows } = await supabase
          .from('academy_course_progress').select('*').eq('user_id', userId).in('course_id', c.map(x => x.id));
        const pMap = new Map((progressRows ?? []).map((r: AcademyCourseProgress) => [r.course_id, r]));
        if (!cancelled) setProgressByCourse(pMap);
      }

      const accessEntries = await Promise.all(
        c.map(async course => [course.id, await canAccessCourse(userId, trackId, course.id)] as const)
      );
      if (!cancelled) setAccessByCourse(new Map(accessEntries));

      const myProgress = await getMyTrackProgress(userId);
      const tp = myProgress.find(p => p.track_id === trackId) ?? null;
      if (!cancelled) setTrackProgress(tp);

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [trackId, userId]);

  const handleEnroll = async () => {
    await enrollInTrack(userId, companyId, trackId);
    const myProgress = await getMyTrackProgress(userId);
    setTrackProgress(myProgress.find(p => p.track_id === trackId) ?? null);
  };

  const handleGenerateCertificate = async () => {
    if (!track || !trackProgress) return;
    await issueCertificateIfEligible(userId, userEmail, companyId, trackId, userName, trackProgress.hours_studied);
    setShowCertificate(true);
  };

  if (loading || !track) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando trilha...</PanelSection></Panel>;
  }

  const earnedCertificate = trackProgress ? hasEarnedCertificate(trackProgress) : false;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar às Trilhas</Button>

      <Panel>
        <PanelSection padding="lg" className="space-y-3">
          <h2 className="text-xl font-bold text-fg">{track.title}</h2>
          <p className="text-sm text-fg-muted">{track.description}</p>
          <div className="flex gap-2">
            {!trackProgress && <Button onClick={handleEnroll}>Iniciar Trilha</Button>}
            {earnedCertificate && (
              <Button variant="secondary" onClick={handleGenerateCertificate}>
                <Award size={16} /> Ver Certificado
              </Button>
            )}
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        {courses.map((course, i) => {
          const progress = progressByCourse.get(course.id);
          const accessible = accessByCourse.get(course.id) ?? i === 0;
          const status = progress?.status ?? 'not_started';
          return (
            <PanelSection key={course.id} padding="md">
              <button
                disabled={!accessible}
                onClick={() => accessible && onSelectCourse(course.id)}
                className={`w-full flex items-center gap-3 text-left ${accessible ? '' : 'opacity-50 cursor-not-allowed'}`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-3">
                  {status === 'completed' ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : accessible ? (
                    <PlayCircle size={16} className="text-accent" />
                  ) : (
                    <Lock size={14} className="text-fg-subtle" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg text-sm">{course.title}</p>
                  <p className="text-xs text-fg-muted line-clamp-1">{course.objectives}</p>
                </div>
                {course.is_placeholder && <Badge variant="neutral">Em breve</Badge>}
              </button>
            </PanelSection>
          );
        })}
      </Panel>

      {trackProgress && (
        <CertificateModal
          open={showCertificate}
          onClose={() => setShowCertificate(false)}
          learnerName={userName}
          trackTitle={track.title}
          totalHours={trackProgress.hours_studied}
        />
      )}
    </div>
  );
}
