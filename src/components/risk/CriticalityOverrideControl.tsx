import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { setCriticalityOverride } from '../../lib/riskService';
import type { CriticalityLevel } from '../../lib/supabase';

const LEVEL_LABEL: Record<CriticalityLevel, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
  maxima: 'Máxima',
};

interface CriticalityOverrideControlProps {
  productId: string;
  companyId: string;
  currentLevel: CriticalityLevel;
  role: string | undefined;
  userId: string;
  userEmail: string;
  onUpdated: () => void;
}

/** Configura a "criticidade operacional" — bônus manual aplicado pelo riskAlgorithm por
 *  cima do score calculado. RLS já restringe a escrita a owner/admin/manager; este
 *  controle só fica habilitado no client para esses papéis, evitando um botão que sempre
 *  falharia silenciosamente para os demais. */
export function CriticalityOverrideControl({ productId, companyId, currentLevel, role, userId, userEmail, onUpdated }: CriticalityOverrideControlProps) {
  const [saving, setSaving] = useState(false);
  const canEdit = role === 'owner' || role === 'admin' || role === 'manager';

  const handleChange = async (level: CriticalityLevel) => {
    setSaving(true);
    await setCriticalityOverride(productId, companyId, level, userId, userEmail);
    setSaving(false);
    onUpdated();
  };

  return (
    <div className="flex items-center gap-2">
      <ShieldAlert size={14} className="text-fg-subtle flex-shrink-0" />
      <span className="text-xs text-fg-muted">Criticidade operacional:</span>
      {canEdit ? (
        <select
          value={currentLevel}
          disabled={saving}
          onChange={e => handleChange(e.target.value as CriticalityLevel)}
          className="text-xs px-2 py-1 border border-edge rounded-lg bg-surface text-fg"
        >
          {(Object.keys(LEVEL_LABEL) as CriticalityLevel[]).map(l => (
            <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs font-medium text-fg">{LEVEL_LABEL[currentLevel]}</span>
      )}
    </div>
  );
}
