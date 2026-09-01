import { Badge } from '../ui';
import { CAUSE_LABEL } from '../../lib/rcaAlgorithm';
import type { RcaCauseCategory } from '../../lib/supabase';

interface CauseBadgeProps {
  cause: RcaCauseCategory;
  customLabel?: string | null;
  className?: string;
}

/** Sempre neutro — categoria de causa não é sinal de gravidade (isso é papel da
 *  severidade); colorir por categoria também violaria a regra de fidelidade visual
 *  ("não usar cards/badges coloridos por categoria", vermelho reservado a alerta real). */
export function CauseBadge({ cause, customLabel, className = '' }: CauseBadgeProps) {
  const label = cause === 'outro' && customLabel ? customLabel : (CAUSE_LABEL[cause] ?? cause);
  return <Badge variant="neutral" className={className}>{label}</Badge>;
}
