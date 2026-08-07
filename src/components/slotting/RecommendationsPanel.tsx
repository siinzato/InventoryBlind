import { useEffect, useState, useCallback } from 'react';
import { Check, X, Clock3 } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { getRecommendations, decideRecommendation } from '../../lib/slottingRecommendationService';
import type { WarehouseSlottingRecommendation } from '../../lib/supabase';

interface RecommendationsPanelProps {
  companyId: string;
  layoutId: string;
  userId: string;
  userEmail: string;
  canEdit: boolean;
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  mover_mais_perto: 'Mover para mais perto',
  aproximar_expedicao: 'Aproximar da expedição',
  agrupar_frequentes: 'Agrupar SKUs frequentes',
  redistribuir_fluxo: 'Redistribuir fluxo',
};

/** Mesma leitura/decisão já usadas na aba "Slotting" (SlottingDashboardPage) — não
 *  duplica lógica de negócio, só dá à fila de recomendações uma aba própria no Digital
 *  Twin, para quem quer decidir sugestões sem abrir o painel de slotting completo. */
export function RecommendationsPanel({ companyId, layoutId, userId, userEmail, canEdit }: RecommendationsPanelProps) {
  const [recommendations, setRecommendations] = useState<WarehouseSlottingRecommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getRecommendations(companyId, layoutId, 'pendente').then(recs => { setRecommendations(recs); setLoading(false); });
  }, [companyId, layoutId]);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id: string, status: 'aprovada' | 'rejeitada' | 'adiada') => {
    await decideRecommendation(id, status, companyId, userId, userEmail);
    load();
  };

  if (loading) {
    return <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando recomendações...</PanelSection></Panel>;
  }

  return (
    <Panel>
      <PanelSection padding="md">
        <p className="text-section mb-3">Recomendações Pendentes</p>
        <div className="space-y-2">
          {recommendations.length === 0 && (
            <p className="text-xs text-fg-subtle">Nenhuma recomendação pendente — gere novas na aba Slotting.</p>
          )}
          {recommendations.map(rec => (
            <div key={rec.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-surface-3/50">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="accent">{RECOMMENDATION_LABEL[rec.recommendation_type]}</Badge>
                  {rec.estimated_meters_saved > 0 && (
                    <span className="text-xs text-fg-subtle">~{Math.round(rec.estimated_meters_saved)}m economizados</span>
                  )}
                </div>
                <p className="text-sm text-fg-muted">{rec.reason}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => handleDecide(rec.id, 'aprovada')} className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded transition" title="Aprovar"><Check size={16} /></button>
                  <button onClick={() => handleDecide(rec.id, 'adiada')} className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded transition" title="Adiar"><Clock3 size={16} /></button>
                  <button onClick={() => handleDecide(rec.id, 'rejeitada')} className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded transition" title="Rejeitar"><X size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </PanelSection>
    </Panel>
  );
}
