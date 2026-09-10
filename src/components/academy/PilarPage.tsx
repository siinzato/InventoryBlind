import { ArrowLeft } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import { PILARES, PilarKey } from '../../lib/academyContent';
import { PilarChecklist } from './PilarChecklist';

interface PilarPageProps {
  pilarKey: PilarKey;
  userId: string;
  companyId: string;
  onBack: () => void;
}

export function PilarPage({ pilarKey, userId, companyId, onBack }: PilarPageProps) {
  const pilar = PILARES.find(p => p.key === pilarKey);
  if (!pilar) return null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> Voltar aos Pilares</Button>

      <Panel>
        <PanelSection padding="lg" className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Pilar {pilar.order}</p>
            <h2 className="text-xl font-bold text-fg">{pilar.title}</h2>
          </div>

          {pilar.headings.map(h => (
            <div key={h.h}>
              <p className="font-semibold text-fg mb-2">{h.h}</p>
              <ul className="space-y-1.5">
                {h.bullets.map(b => (
                  <li key={b} className="text-sm text-fg-muted flex items-start gap-2">
                    <span className="text-accent mt-1">•</span> {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {pilar.impactQuotes.map(q => (
            <blockquote key={q} className="border-l-2 border-accent pl-4 italic text-fg-muted">{q}</blockquote>
          ))}
        </PanelSection>
      </Panel>

      {pilarKey === 'preparacao' && <PilarChecklist userId={userId} companyId={companyId} />}
    </div>
  );
}
