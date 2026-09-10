import { useEffect, useRef } from 'react';

export interface PhaseRailStep {
  key: string;
  label: string;
}

interface PhaseRailProps {
  steps: PhaseRailStep[];
  currentKey: string;
  /** Accessible name for the nav landmark, e.g. "Progresso da importação". */
  label: string;
  className?: string;
}

const STATE_HINT: Record<'completed' | 'current' | 'upcoming', string> = {
  completed: 'concluída',
  current: 'etapa atual',
  upcoming: 'pendente',
};

/**
 * Trilho de fases segmentado — padrão oficial do InventoryBlind para fluxos
 * lineares de múltiplas etapas, substituindo o antigo stepper de círculos
 * numerados + linha (era duplicado em ProductImportPage, ImportCountTab e
 * ComparatorStepper). Sem círculos, ícones ou cards: cada fase é um trecho
 * de trilho independente com o rótulo abaixo. A fase atual carrega uma
 * pequena ponta neutra ao final do preenchimento azul, como assinatura
 * visual do "em andamento" sem depender só da cor. Aceita qualquer
 * quantidade de fases.
 */
export function PhaseRail({ steps, currentKey, label, className = '' }: PhaseRailProps) {
  const currentIdx = steps.findIndex(s => s.key === currentKey);
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!currentRef.current) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    currentRef.current.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [currentIdx]);

  return (
    <nav aria-label={label} className={`w-full ${className}`}>
      <ol className="flex w-full items-start overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((step, idx) => {
          const state = idx < currentIdx ? 'completed' : idx === currentIdx ? 'current' : 'upcoming';
          return (
            <li
              key={step.key}
              ref={state === 'current' ? currentRef : undefined}
              aria-current={state === 'current' ? 'step' : undefined}
              className="relative min-w-[4.5rem] flex-1 px-1 first:pl-0 last:pr-0"
            >
              <div className="relative flex h-4 items-center">
                {idx > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-edge"
                  />
                )}
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface-3">
                  {state === 'completed' && (
                    <div className="absolute inset-0 rounded-full bg-accent transition-colors duration-200" />
                  )}
                  {state === 'current' && (
                    <div className="absolute inset-y-0 left-0 right-2.5 rounded-l-full bg-accent transition-colors duration-200" />
                  )}
                </div>
              </div>
              <p
                className={`mt-1.5 text-xs leading-tight transition-colors duration-200 ${
                  state === 'current'
                    ? 'font-semibold text-fg'
                    : state === 'completed'
                      ? 'font-medium text-fg-muted'
                      : 'font-medium text-fg-subtle'
                }`}
              >
                {step.label}
                <span className="sr-only"> ({STATE_HINT[state]})</span>
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
