import { RISK_LEVEL_LABEL } from '../../lib/cbcAlgorithm';
import type { RiskLevel } from '../../lib/supabase';

interface ConfidenceBadgeProps {
  riskLevel: RiskLevel | null;
  score?: number | null;
  className?: string;
}

/** Só a faixa Crítica usa vermelho — as demais são texto grafite/azul contido,
 *  sem pill colorido (pedido explícito: "sem badge laranja/colorido para todas
 *  as faixas"). */
export function ConfidenceBadge({ riskLevel, score, className = '' }: ConfidenceBadgeProps) {
  if (!riskLevel) {
    return <span className={`text-sm text-fg-subtle ${className}`}>Sem dados suficientes</span>;
  }
  const tone = riskLevel === 'critico' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-fg-muted';
  return (
    <span className={`text-sm ${tone} ${className}`}>
      {RISK_LEVEL_LABEL[riskLevel]}{score != null ? ` · ${score}/100` : ''}
    </span>
  );
}
