import { PhaseRail } from '../ui';
import type { PhaseRailStep } from '../ui';

const STEP_LABELS = ['Tipo', 'Planilhas', 'Mapeamento', 'Regras', 'Revisão', 'Processar', 'Resultados'];
const STEPS: PhaseRailStep[] = STEP_LABELS.map((label, idx) => ({ key: String(idx + 1), label }));

interface ComparatorStepperProps {
  currentStep: number; // 1-based
}

/** Trilho de fases compartilhado (ui/PhaseRail) — mesmo padrão do stepper do Importador de Produtos. */
export function ComparatorStepper({ currentStep }: ComparatorStepperProps) {
  return (
    <PhaseRail
      label="Progresso da comparação"
      steps={STEPS}
      currentKey={String(currentStep)}
      className="mb-8"
    />
  );
}

export default ComparatorStepper;
