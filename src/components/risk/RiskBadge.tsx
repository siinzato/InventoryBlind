import { Badge } from '../ui';
import { RISK_BAND_LABEL } from '../../lib/riskAlgorithm';
import type { RiskBand } from '../../lib/supabase';

const VARIANT: Record<RiskBand, 'danger' | 'warning' | 'accent' | 'success'> = {
  critico: 'danger',
  alto: 'warning',
  medio: 'accent',
  baixo: 'success',
};

interface RiskBadgeProps {
  riskLevel: RiskBand;
  score?: number;
  className?: string;
}

export function RiskBadge({ riskLevel, score, className = '' }: RiskBadgeProps) {
  return (
    <Badge variant={VARIANT[riskLevel]} className={className}>
      {RISK_BAND_LABEL[riskLevel]}{score !== undefined ? ` · ${score}` : ''}
    </Badge>
  );
}
