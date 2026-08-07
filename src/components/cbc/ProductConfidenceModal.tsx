import { useEffect, useState, useCallback } from 'react';
import { Gauge, CalendarClock, AlertCircle, AlertOctagon, LayoutGrid } from 'lucide-react';
import { Modal } from '../ui';
import { getProductConfidence } from '../../lib/cbcService';
import { getProductRisk, getCriticalityLevel } from '../../lib/riskService';
import { getProductClassification } from '../../lib/abcXyzService';
import { ABC_XYZ_STRATEGIES } from '../../lib/abcXyzStrategies';
import { ConfidenceBadge } from './ConfidenceBadge';
import { RiskBadge } from '../risk/RiskBadge';
import { CriticalityOverrideControl } from '../risk/CriticalityOverrideControl';
import { ClassificationBadge } from '../abcxyz/ClassificationBadge';
import type { ProductConfidenceScore, ProductRiskScore, CriticalityLevel, ProductAbcXyzClassification } from '../../lib/supabase';

interface ProductConfidenceModalProps {
  open: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  companyId: string;
  role?: string;
  userId?: string;
  userEmail?: string;
}

/** A "tela do produto" pedida para o CBC — não existia nenhuma tela de detalhe de produto
 *  neste app antes; esta é net-new, seguindo o padrão estrutural de HeatmapDetailsModal.tsx
 *  (modal de detalhe aberto por clique numa linha), só que por produto em vez de por marca. */
export function ProductConfidenceModal({ open, onClose, productId, productName, companyId, role, userId, userEmail }: ProductConfidenceModalProps) {
  const [confidence, setConfidence] = useState<ProductConfidenceScore | null>(null);
  const [risk, setRisk] = useState<ProductRiskScore | null>(null);
  const [classification, setClassification] = useState<ProductAbcXyzClassification | null>(null);
  const [criticalityLevel, setCriticalityLevel] = useState<CriticalityLevel>('normal');
  const [loading, setLoading] = useState(true);

  const loadRisk = useCallback(() => {
    Promise.all([getProductRisk(productId, companyId), getCriticalityLevel(productId, companyId)]).then(([r, level]) => {
      setRisk(r);
      setCriticalityLevel(level);
    });
  }, [productId, companyId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getProductConfidence(productId, companyId),
      getProductRisk(productId, companyId),
      getCriticalityLevel(productId, companyId),
      getProductClassification(productId, companyId),
    ]).then(([c, r, level, cls]) => {
      if (cancelled) return;
      setConfidence(c);
      setRisk(r);
      setCriticalityLevel(level);
      setClassification(cls);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, productId, companyId]);

  return (
    <Modal open={open} onClose={onClose} title={productName} maxWidth="max-w-lg">
      {loading ? (
        <p className="text-sm text-fg-subtle text-center py-6">Carregando...</p>
      ) : (
        <div className="space-y-6">
          {confidence ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gauge size={18} className="text-accent" />
                  <span className="text-sm font-medium text-fg-muted">Confidence Score</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-fg">{confidence.confidence_score}</span>
                  <ConfidenceBadge riskLevel={confidence.risk_level} />
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <CalendarClock size={16} className="text-fg-subtle flex-shrink-0" />
                Próxima contagem: <span className="font-semibold text-fg">{new Date(confidence.next_count_date).toLocaleDateString('pt-BR')}</span>
              </div>

              <div>
                <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <AlertCircle size={13} /> Motivos da nota
                </p>
                <ul className="space-y-1.5">
                  {confidence.top_reasons.map(reason => (
                    <li key={reason} className="text-sm text-fg-muted flex items-start gap-2">
                      <span className="text-accent mt-1">•</span> {reason}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[11px] text-fg-subtle">
                Última execução do algoritmo: {new Date(confidence.last_algorithm_run).toLocaleString('pt-BR')} ({confidence.algorithm_version})
              </p>
            </div>
          ) : (
            <p className="text-sm text-fg-subtle">
              Ainda não há Confidence Score para este produto — ele aparece após a primeira contagem importada.
            </p>
          )}

          <div className="border-t border-edge pt-5">
            {risk ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertOctagon size={18} className="text-red-500" />
                    <span className="text-sm font-medium text-fg-muted">Risk Score</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-fg">{risk.risk_score}</span>
                    <RiskBadge riskLevel={risk.risk_level} />
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <AlertCircle size={13} /> Motivos da classificação
                  </p>
                  <p className="text-sm text-fg-muted">{risk.risk_reason}</p>
                </div>

                {userId && userEmail && (
                  <CriticalityOverrideControl
                    productId={productId}
                    companyId={companyId}
                    currentLevel={criticalityLevel}
                    role={role}
                    userId={userId}
                    userEmail={userEmail}
                    onUpdated={loadRisk}
                  />
                )}

                <p className="text-[11px] text-fg-subtle">
                  Última atualização: {new Date(risk.last_risk_update).toLocaleString('pt-BR')} ({risk.algorithm_version})
                </p>
              </div>
            ) : (
              <p className="text-sm text-fg-subtle">Ainda não há Risk Score para este produto.</p>
            )}
          </div>

          <div className="border-t border-edge pt-5">
            {classification ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <LayoutGrid size={18} className="text-accent" />
                    <span className="text-sm font-medium text-fg-muted">Classificação ABC+XYZ</span>
                  </div>
                  <ClassificationBadge combo={classification.abc_xyz_class} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-fg-subtle">Classe ABC</p>
                    <p className="font-semibold text-fg">{classification.abc_class}</p>
                  </div>
                  <div>
                    <p className="text-xs text-fg-subtle">Classe XYZ</p>
                    <p className="font-semibold text-fg">{classification.xyz_class}</p>
                  </div>
                </div>

                <p className="text-xs text-accent font-medium">
                  {ABC_XYZ_STRATEGIES[classification.abc_xyz_class].countingGuidance}
                </p>

                <div>
                  <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <AlertCircle size={13} /> Motivos da classificação
                  </p>
                  <ul className="space-y-1.5">
                    {classification.reasons.map(reason => (
                      <li key={reason} className="text-sm text-fg-muted flex items-start gap-2">
                        <span className="text-accent mt-1">•</span> {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-subtle">Ainda não há Classificação ABC+XYZ para este produto.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
