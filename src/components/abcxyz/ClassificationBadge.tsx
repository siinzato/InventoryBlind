import type { AbcXyzCombo } from '../../lib/supabase';

interface ClassificationBadgeProps {
  combo: AbcXyzCombo | null;
  className?: string;
}

/** ABC e XYZ são categorias analíticas, não estados positivos/negativos — nenhuma cor por
 *  classe, só texto grafite num contorno neutro (mesmo padrão de RiskBadge/ConfidenceBadge). */
export function ClassificationBadge({ combo, className = '' }: ClassificationBadgeProps) {
  if (!combo) {
    return <span className={`text-sm text-fg-subtle ${className}`}>Sem classificação</span>;
  }
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded border border-edge text-sm font-medium text-fg tabular-nums ${className}`}>
      {combo}
    </span>
  );
}
