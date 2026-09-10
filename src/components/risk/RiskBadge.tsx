import { RISK_BAND_LABEL } from '../../lib/riskAlgorithm';
import type { RiskBand } from '../../lib/supabase';

interface RiskBadgeProps {
  riskLevel: RiskBand | null;
  score?: number | null;
  className?: string;
}

const DOT: Record<RiskBand, string> = {
  critico: 'bg-red-500',
  alto: 'bg-fg-muted',
  medio: 'bg-fg-subtle',
  baixo: 'bg-fg-subtle',
};

/** Só a faixa Crítica usa vermelho — as demais são texto grafite com um marcador
 *  discreto, sem pill colorido (pedido explícito: nada de laranja/amarelo/verde
 *  para representar risco). */
export function RiskBadge({ riskLevel, score, className = '' }: RiskBadgeProps) {
  if (!riskLevel) {
    return <span className={`text-sm text-fg-subtle ${className}`}>Dados insuficientes</span>;
  }
  const tone = riskLevel === 'critico' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-fg-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${tone} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[riskLevel]}`} />
      {RISK_BAND_LABEL[riskLevel]}{score != null ? ` · ${score}` : ''}
    </span>
  );
}
