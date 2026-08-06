import { useEffect, useState } from 'react';
import { FileText, Download, Lock } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { getLibraryResources } from '../../lib/academyService';
import type { LibraryResource } from '../../lib/supabase';

const CATEGORY_LABEL: Record<LibraryResource['category'], string> = {
  pdf: 'PDF',
  checklist: 'Checklist',
  pop: 'POP',
  template: 'Template',
};

export function BibliotecaPage() {
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getLibraryResources().then(r => {
      if (cancelled) return;
      setResources(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando biblioteca...</PanelSection></Panel>;
  }

  return (
    <Panel>
      {resources.map(r => (
        <PanelSection key={r.id} padding="md" className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
              <FileText size={16} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-fg text-sm">{r.title}</p>
              <p className="text-xs text-fg-muted">{r.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="neutral">{CATEGORY_LABEL[r.category]}</Badge>
            {r.external_url ? (
              <a href={r.external_url} target="_blank" rel="noreferrer" className="text-accent hover:text-accent-strong">
                <Download size={16} />
              </a>
            ) : (
              <span title="Em breve" className="text-fg-subtle"><Lock size={14} /></span>
            )}
          </div>
        </PanelSection>
      ))}
    </Panel>
  );
}
