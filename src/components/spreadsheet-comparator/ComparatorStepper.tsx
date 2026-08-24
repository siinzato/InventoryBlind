import React from 'react';

const STEP_LABELS = ['Tipo', 'Planilhas', 'Mapeamento', 'Regras', 'Revisão', 'Processar', 'Resultados'];

interface ComparatorStepperProps {
  currentStep: number; // 1-based
}

/** Mesmo padrão visual (círculos numerados + linha) do stepper do Importador de Produtos. */
export const ComparatorStepper: React.FC<ComparatorStepperProps> = ({ currentStep }) => (
  <div className="flex items-center justify-center mb-8 flex-wrap gap-y-2">
    {STEP_LABELS.map((label, idx) => {
      const stepNumber = idx + 1;
      const isComplete = currentStep > stepNumber;
      const isCurrent = currentStep === stepNumber;
      return (
        <React.Fragment key={label}>
          {idx > 0 && <div className={`w-6 sm:w-10 h-0.5 mx-1 ${isComplete || isCurrent ? 'bg-accent' : 'bg-surface-3'}`} />}
          <div className="flex flex-col items-center gap-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              isComplete ? 'bg-accent text-white' : isCurrent ? 'bg-accent-strong text-white' : 'bg-surface-3 text-fg-subtle'
            }`}>
              {isComplete ? '✓' : stepNumber}
            </div>
            <span className={`text-[10px] font-medium hidden sm:block ${isCurrent ? 'text-fg' : 'text-fg-subtle'}`}>{label}</span>
          </div>
        </React.Fragment>
      );
    })}
  </div>
);

export default ComparatorStepper;
