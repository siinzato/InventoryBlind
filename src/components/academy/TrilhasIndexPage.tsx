import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import * as Icons from 'lucide-react';
import { Route, ArrowRight } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { getTracks, getMyTrackProgress } from '../../lib/academyService';
import type { AcademyTrack, AcademyTrackProgressRow } from '../../lib/supabase';

function TrackIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name] ?? Route;
  return <Icon className={className} />;
}

interface TrilhasIndexPageProps {
  userId: string;
  onSelectTrack: (trackId: string) => void;
}

export function TrilhasIndexPage({ userId, onSelectTrack }: TrilhasIndexPageProps) {
  const [tracks, setTracks] = useState<AcademyTrack[]>([]);
  const [progress, setProgress] = useState<AcademyTrackProgressRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTracks(), getMyTrackProgress(userId)]).then(([t, p]) => {
      if (cancelled) return;
      setTracks(t);
      setProgress(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando trilhas...</PanelSection></Panel>;
  }

  const progressByTrack = new Map(progress.map(p => [p.track_id, p]));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {tracks.map(track => {
        const p = progressByTrack.get(track.id);
        const pct = p?.pct_complete ?? 0;
        return (
          <button key={track.id} onClick={() => onSelectTrack(track.id)} className="text-left">
            <Panel className="h-full hover:border-accent/50 transition-colors">
              <PanelSection padding="md" className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                    <TrackIcon name={track.icon} className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-fg">{track.title}</p>
                    <p className="text-xs text-fg-muted line-clamp-2">{track.description}</p>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
                    <span>{p ? `${p.courses_completed}/${p.courses_total} cursos` : 'Não iniciada'}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  {p ? 'Continuar' : 'Iniciar Trilha'} <ArrowRight size={12} />
                </span>
              </PanelSection>
            </Panel>
          </button>
        );
      })}
    </div>
  );
}
