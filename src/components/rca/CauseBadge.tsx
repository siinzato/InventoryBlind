import { Badge } from '../ui';
import { CAUSE_LABEL } from '../../lib/rcaAlgorithm';
import type { RcaCauseCategory } from '../../lib/supabase';

const VARIANT: Record<RcaCauseCategory, 'danger' | 'warning' | 'accent' | 'neutral'> = {
  furto_perda: 'danger',
  avaria: 'danger',
  erro_operacional: 'warning',
  sistema_integracao: 'warning',
  cadastro: 'warning',
  conversao_unidade: 'warning',
  recebimento: 'accent',
  armazenagem: 'accent',
  picking: 'accent',
  separacao: 'accent',
  expedicao: 'accent',
  inventario: 'accent',
  sem_causa_identificada: 'neutral',
  outro: 'neutral',
};

interface CauseBadgeProps {
  cause: RcaCauseCategory;
  customLabel?: string | null;
  className?: string;
}

export function CauseBadge({ cause, customLabel, className = '' }: CauseBadgeProps) {
  const label = cause === 'outro' && customLabel ? customLabel : CAUSE_LABEL[cause];
  return <Badge variant={VARIANT[cause]} className={className}>{label}</Badge>;
}
