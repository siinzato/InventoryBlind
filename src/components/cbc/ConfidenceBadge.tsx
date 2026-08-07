import { Badge } from '../ui';
import { RISK_LEVEL_LABEL } from '../../lib/cbcAlgorithm';
import type { RiskLevel } from '../../lib/supabase';

const VARIANT: Record<RiskLevel, 'success' | 'accent' | 'warning' | 'danger'> = {
  excelente: 'success',
  bom: 'accent',
  medio: 'warning',
  critico: 'danger',
};

interface ConfidenceBadgeProps {
  riskLevel: RiskLevel;
  score?: number;
  className?: string;
}

export function ConfidenceBadge({ riskLevel, score, className = '' }: ConfidenceBadgeProps) {
  return (
    <Badge variant={VARIANT[riskLevel]} className={className}>
      {RISK_LEVEL_LABEL[riskLevel]}{score !== undefined ? ` · ${score}` : ''}
    </Badge>
  );
}
