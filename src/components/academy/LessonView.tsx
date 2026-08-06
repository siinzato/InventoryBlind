import { CheckCircle2, FileText, Image as ImageIcon, Video } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import type { AcademyLesson } from '../../lib/supabase';

interface LessonViewProps {
  lesson: AcademyLesson;
  completed: boolean;
  onComplete: () => void;
}

export function LessonView({ lesson, completed, onComplete }: LessonViewProps) {
  return (
    <Panel>
      <PanelSection padding="lg" className="space-y-4">
        <h3 className="text-lg font-semibold text-fg">{lesson.title}</h3>
        <p className="text-sm text-fg-muted whitespace-pre-line leading-relaxed">{lesson.body_richtext}</p>

        {lesson.video_url && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-3/50 text-sm text-fg-muted">
            <Video size={16} /> Vídeo desta aula: {lesson.video_url}
          </div>
        )}

        {lesson.attachments.length > 0 && (
          <div className="space-y-1.5">
            {lesson.attachments.map(a => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-accent hover:underline">
                {a.type === 'pdf' ? <FileText size={14} /> : <ImageIcon size={14} />} {a.name}
              </a>
            ))}
          </div>
        )}

        <Button onClick={onComplete} disabled={completed} variant={completed ? 'secondary' : 'primary'}>
          <CheckCircle2 size={16} /> {completed ? 'Aula Concluída' : 'Concluir Aula'}
        </Button>
      </PanelSection>
    </Panel>
  );
}
