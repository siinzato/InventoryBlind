import { useEffect, useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { PILAR4_CHECKLIST_ITEMS } from '../../lib/academyContent';
import { getPilarChecklistProgress, togglePilarChecklistItem } from '../../lib/academyService';

interface PilarChecklistProps {
  userId: string;
  companyId: string;
}

export function PilarChecklist({ userId, companyId }: PilarChecklistProps) {
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPilarChecklistProgress(userId, companyId).then(p => {
      if (cancelled) return;
      setProgress(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, companyId]);

  const toggle = (itemKey: string) => {
    const next = !progress[itemKey];
    setProgress(p => ({ ...p, [itemKey]: next }));
    togglePilarChecklistItem(userId, companyId, itemKey, next);
  };

  const doneCount = PILAR4_CHECKLIST_ITEMS.filter(i => progress[i.key]).length;

  return (
    <Panel>
      <PanelSection padding="md">
        <div className="flex items-center justify-between mb-3">
          <p className="text-section">Checklist Interativo de Preparação</p>
          <span className="text-xs text-fg-subtle">{doneCount}/{PILAR4_CHECKLIST_ITEMS.length}</span>
        </div>
        {loading ? (
          <p className="text-sm text-fg-subtle">Carregando checklist...</p>
        ) : (
          <div className="space-y-1.5">
            {PILAR4_CHECKLIST_ITEMS.map(item => {
              const checked = !!progress[item.key];
              return (
                <button
                  key={item.key}
                  onClick={() => toggle(item.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                    checked ? 'bg-accent/10 text-fg' : 'hover:bg-surface-3 text-fg-muted'
                  }`}
                >
                  {checked ? <CheckSquare size={16} className="text-accent flex-shrink-0" /> : <Square size={16} className="flex-shrink-0" />}
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </PanelSection>
    </Panel>
  );
}
