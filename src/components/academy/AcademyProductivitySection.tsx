import { useEffect, useState } from 'react';
import { GraduationCap, Award } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { getMyTrackProgress } from '../../lib/academyService';
import { getMyCertificates } from '../../lib/certificateService';
import type { AcademyTrackProgressRow, AcademyCertificate } from '../../lib/supabase';

interface AcademyProductivitySectionProps {
  userId: string;
  companyId: string;
}

/** Embedded in ProductivityTab's 'mine' mode — self-contained, self-fetching, so
 *  ProductivityTab.tsx itself needs no structural change beyond one extra JSX line. */
export function AcademyProductivitySection({ userId, companyId }: AcademyProductivitySectionProps) {
  const [tracks, setTracks] = useState<AcademyTrackProgressRow[]>([]);
  const [certificates, setCertificates] = useState<AcademyCertificate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyTrackProgress(userId), getMyCertificates(userId, companyId)]).then(([t, c]) => {
      if (cancelled) return;
      setTracks(t);
      setCertificates(c);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, companyId]);

  if (loading || tracks.length === 0) return null;

  const totalHours = tracks.reduce((s, t) => s + t.hours_studied, 0);
  const totalCourses = tracks.reduce((s, t) => s + t.courses_completed, 0);

  return (
    <Panel>
      <PanelSection padding="md">
        <div className="flex items-center gap-2 mb-3">
          <GraduationCap size={16} className="text-accent" />
          <p className="text-section">I.B Academy</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-edge mb-4">
          <div className="text-center">
            <p className="text-lg font-bold text-fg">{totalCourses}</p>
            <p className="text-xs text-fg-subtle">Cursos concluídos</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-fg">{certificates.length}</p>
            <p className="text-xs text-fg-subtle">Certificados</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-fg">{totalHours}h</p>
            <p className="text-xs text-fg-subtle">Horas estudadas</p>
          </div>
        </div>
        <div className="space-y-2">
          {tracks.map(t => (
            <div key={t.track_id} className="flex items-center justify-between gap-3">
              <p className="text-sm text-fg-muted truncate">{t.track_title}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-24 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${t.pct_complete}%` }} />
                </div>
                <span className="text-xs text-fg-subtle w-8 text-right">{t.pct_complete}%</span>
                {t.has_certificate && <Award size={14} className="text-amber-500" />}
              </div>
            </div>
          ))}
        </div>
      </PanelSection>
    </Panel>
  );
}
