import { useEffect, useState } from 'react';
import { Target, CheckSquare, Square } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { getMyPDI, toggleStepComplete, computePDIProgressPct, PdiPlanWithSteps } from '../../lib/pdiService';

interface PDIPageProps {
  userId: string;
  companyId: string;
  role: string | undefined;
}

export function PDIPage({ userId, companyId }: PDIPageProps) {
  const [plans, setPlans] = useState<PdiPlanWithSteps[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMyPDI(userId, companyId).then(p => {
      if (cancelled) return;
      setPlans(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, companyId]);

  const toggle = async (planIndex: number, stepId: string, completed: boolean) => {
    setPlans(prev => prev.map((p, i) => (
      i === planIndex ? { ...p, steps: p.steps.map(s => (s.id === stepId ? { ...s, completed } : s)) } : p
    )));
    await toggleStepComplete(stepId, completed);
  };

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando PDI...</PanelSection></Panel>;
  }

  if (plans.length === 0) {
    return (
      <Panel>
        <PanelSection padding="lg" className="text-center text-fg-subtle">
          Você ainda não tem um Plano de Desenvolvimento Individual. Fale com seu gestor.
        </PanelSection>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {plans.map((plan, planIndex) => {
        const pct = computePDIProgressPct(plan.steps);
        return (
          <Panel key={plan.id}>
            <PanelSection padding="lg" className="space-y-3">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-accent" />
                <p className="font-semibold text-fg">Objetivo: {plan.goal_title}</p>
              </div>
              {plan.goal_description && <p className="text-sm text-fg-muted">{plan.goal_description}</p>}
              <div>
                <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
                  <span>Progresso</span><span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="space-y-1.5">
                {plan.steps.map(step => (
                  <button
                    key={step.id}
                    onClick={() => toggle(planIndex, step.id, !step.completed)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      step.completed ? 'bg-accent/10 text-fg' : 'hover:bg-surface-3 text-fg-muted'
                    }`}
                  >
                    {step.completed ? <CheckSquare size={16} className="text-accent flex-shrink-0" /> : <Square size={16} className="flex-shrink-0" />}
                    {step.title}
                  </button>
                ))}
              </div>
            </PanelSection>
          </Panel>
        );
      })}
    </div>
  );
}
