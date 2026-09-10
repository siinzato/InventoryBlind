import type { ComponentType } from 'react';
import * as Icons from 'lucide-react';
import { LayoutGrid, Lock } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { PILARES, PilarKey } from '../../lib/academyContent';

function PilarIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as unknown as Record<string, ComponentType<{ className?: string }>>)[name] ?? LayoutGrid;
  return <Icon className={className} />;
}

interface PilaresIndexPageProps {
  onSelectPilar: (key: PilarKey) => void;
}

export function PilaresIndexPage({ onSelectPilar }: PilaresIndexPageProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {PILARES.map(pilar => (
        <button key={pilar.key} onClick={() => onSelectPilar(pilar.key)} className="text-left">
          <Panel className="h-full hover:border-accent/50 transition-colors">
            <PanelSection padding="md" className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                  <PilarIcon name={pilar.icon} className="w-4 h-4" />
                </div>
                <Badge variant="neutral">Pilar {pilar.order}</Badge>
              </div>
              <p className="font-semibold text-fg">{pilar.title}</p>
              <p className="text-xs text-fg-muted">{pilar.teaser}</p>
              {pilar.isPlaceholder && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                  <Lock size={10} /> Conteúdo completo em breve
                </span>
              )}
            </PanelSection>
          </Panel>
        </button>
      ))}
    </div>
  );
}
