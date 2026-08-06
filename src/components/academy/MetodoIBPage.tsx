import { Panel, PanelSection } from '../ui';
import { METODO_IB_INTRO } from '../../lib/academyContent';

export function MetodoIBPage() {
  return (
    <Panel>
      <PanelSection padding="lg" className="space-y-6">
        <div className="text-center space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Método I.B.®</p>
          <h2 className="text-xl font-bold text-fg">{METODO_IB_INTRO.title}</h2>
          <p className="text-base font-semibold text-fg-muted whitespace-pre-line">{METODO_IB_INTRO.philosophyQuote}</p>
        </div>
        <div className="space-y-5">
          {METODO_IB_INTRO.sections.map(s => (
            <div key={s.heading}>
              <p className="font-semibold text-fg mb-1">{s.heading}</p>
              <p className="text-sm text-fg-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </PanelSection>
    </Panel>
  );
}
