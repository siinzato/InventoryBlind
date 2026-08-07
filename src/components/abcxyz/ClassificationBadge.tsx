import { Badge } from '../ui';
import type { AbcXyzCombo } from '../../lib/supabase';

// A = maior valor (verde/destaque), C = menor valor; X = previsível (verde), Z = imprevisível (vermelho)
// — a cor do badge reflete a letra XYZ (o eixo mais "operacionalmente urgente" no dia a dia).
const VARIANT: Record<'X' | 'Y' | 'Z', 'success' | 'warning' | 'danger'> = {
  X: 'success',
  Y: 'warning',
  Z: 'danger',
};

interface ClassificationBadgeProps {
  combo: AbcXyzCombo;
  className?: string;
}

export function ClassificationBadge({ combo, className = '' }: ClassificationBadgeProps) {
  const xyzLetter = combo[1] as 'X' | 'Y' | 'Z';
  return (
    <Badge variant={VARIANT[xyzLetter]} className={className}>
      {combo}
    </Badge>
  );
}
