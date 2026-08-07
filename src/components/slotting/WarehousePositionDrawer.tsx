import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, MapPin } from 'lucide-react';
import { Badge } from '../ui';
import { findExpeditionCell, findShortestPath, estimatePickingTimeSeconds } from '../../lib/slottingEngine';
import { getPositionActivity, type PositionActivity } from '../../lib/warehouseTwinService';
import { RISK_BAND_LABEL } from '../../lib/riskAlgorithm';
import { ABC_XYZ_STRATEGIES } from '../../lib/abcXyzStrategies';
import type { WarehouseCell, LocationLiveStatus, RiskBand, RiskLevel } from '../../lib/supabase';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const RISK_BADGE_VARIANT: Record<RiskBand, BadgeVariant> = {
  baixo: 'success', medio: 'warning', alto: 'warning', critico: 'danger',
};

const CONFIDENCE_HEALTH: Record<RiskLevel, { label: string; variant: BadgeVariant }> = {
  excelente: { label: 'Saudável', variant: 'success' },
  bom: { label: 'Saudável', variant: 'success' },
  medio: { label: 'Atenção', variant: 'warning' },
  critico: { label: 'Precisa auditoria', variant: 'danger' },
};

interface WarehousePositionDrawerProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  cell: WarehouseCell | null;
  status: LocationLiveStatus | null;
  cells: WarehouseCell[];
  cellSizeMeters: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Nunca';
  const date = new Date(iso);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return date.toLocaleDateString('pt-BR');
}

/** Painel lateral (não modal centralizado) — padrão novo, mas construído com o mesmo
 *  motion/react + tokens (bg-surface/border-edge) já usados em ui/Modal.tsx, porque o
 *  pedido é literalmente "abrir painel lateral" ao clicar num endereço, e não existia
 *  esse padrão de slide-over no app ainda. */
export function WarehousePositionDrawer({ open, onClose, companyId, cell, status, cells, cellSizeMeters }: WarehousePositionDrawerProps) {
  const [activity, setActivity] = useState<PositionActivity | null>(null);

  useEffect(() => {
    if (open && status?.sku) {
      getPositionActivity(companyId, status.sku).then(setActivity);
    } else {
      setActivity(null);
    }
  }, [open, companyId, status?.sku]);

  const avgPickSeconds = useMemo(() => {
    if (!cell) return null;
    const expedition = findExpeditionCell(cells);
    if (!expedition) return null;
    const path = findShortestPath(cells, { x: cell.x, y: cell.y }, { x: expedition.x, y: expedition.y });
    if (!path) return null;
    return estimatePickingTimeSeconds(path.lengthCells * cellSizeMeters, 1);
  }, [cell, cells, cellSizeMeters]);

  if (!cell) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Endereço', value: cell.location_code ?? '—' },
    { label: 'SKU', value: status?.sku ?? '—' },
    { label: 'Produto', value: status?.productName ?? '—' },
    { label: 'Quantidade', value: status?.stockQuantity != null ? status.stockQuantity.toLocaleString('pt-BR') : '—' },
    { label: 'Última contagem', value: formatDate(activity?.lastCountAt ?? null) },
    { label: 'Última divergência', value: formatDate(activity?.lastDivergenceAt ?? null) },
    { label: 'Tempo médio de picking', value: avgPickSeconds != null ? `${Math.round(avgPickSeconds)} s` : '—' },
  ];

  const abcXyzStrategy = status?.abcClass && status?.xyzClass ? ABC_XYZ_STRATEGIES[`${status.abcClass}${status.xyzClass}` as keyof typeof ABC_XYZ_STRATEGIES] : null;
  const confidenceHealth = status?.confidenceLevel ? CONFIDENCE_HEALTH[status.confidenceLevel] : null;
  const rec = status?.recommendation ?? null;
  const recGains = rec
    ? [
        rec.estimated_meters_saved > 0 ? `~${Math.round(rec.estimated_meters_saved)}m economizados` : null,
        rec.estimated_productivity_gain_pct > 0 ? `+${rec.estimated_productivity_gain_pct}% produtividade` : null,
      ].filter((g): g is string => !!g).join(', ')
    : '';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0" style={{ zIndex: 'var(--z-modal)' }}>
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: 'var(--z-modal-backdrop)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="absolute right-0 top-0 h-full w-full max-w-sm bg-surface border-l border-edge shadow-2xl overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
              <h2 className="text-base font-semibold text-fg flex items-center gap-2">
                <MapPin size={16} /> {cell.location_code ?? `(${cell.x},${cell.y})`}
              </h2>
              <button onClick={onClose} className="text-fg-subtle hover:text-fg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {!status?.occupied && (
                <p className="text-xs text-fg-subtle">Endereço sem produto atribuído no momento.</p>
              )}

              <div className="divide-y divide-edge">
                {rows.map(row => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 gap-3">
                    <p className="text-xs text-fg-subtle">{row.label}</p>
                    <p className="text-sm font-medium text-fg text-right">{row.value}</p>
                  </div>
                ))}
              </div>

              {status?.occupied && (
                <div className="pt-4 border-t border-edge space-y-3">
                  {status.riskScore != null && status.riskLevel && (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-xs text-fg-subtle uppercase tracking-wide font-semibold">Risk Score</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-fg">{Math.round(status.riskScore)}/100</p>
                          <Badge variant={RISK_BADGE_VARIANT[status.riskLevel]}>{RISK_BAND_LABEL[status.riskLevel]}</Badge>
                        </div>
                      </div>
                      {status.riskReason && <p className="text-xs text-fg-subtle">{status.riskReason}</p>}
                    </div>
                  )}

                  {status.confidenceScore != null && confidenceHealth && (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-xs text-fg-subtle uppercase tracking-wide font-semibold">Confidence</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-fg">{Math.round(status.confidenceScore)}%</p>
                          <Badge variant={confidenceHealth.variant}>{confidenceHealth.label}</Badge>
                        </div>
                      </div>
                      {status.confidenceTopReasons.length > 0 && (
                        <p className="text-xs text-fg-subtle">Baseado em: {status.confidenceTopReasons.join('; ')}</p>
                      )}
                    </div>
                  )}

                  {abcXyzStrategy && (
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs text-fg-subtle uppercase tracking-wide font-semibold">ABC/XYZ</p>
                        <Badge variant="accent">{abcXyzStrategy.combo}</Badge>
                      </div>
                      <p className="text-xs text-fg-subtle">{abcXyzStrategy.description} {abcXyzStrategy.countingGuidance}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-edge">
                <p className="text-xs text-fg-subtle uppercase tracking-wide font-semibold mb-2">Sugestão</p>
                {rec ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-fg-subtle">Atual</p>
                      <p className="text-sm font-medium text-fg">{rec.current_location ?? cell.location_code ?? '—'}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-fg-subtle">Sugestão</p>
                      <p className="text-sm font-medium text-fg">{rec.suggested_location ?? '—'}</p>
                    </div>
                    <div className="flex items-start gap-2 pt-1">
                      <Badge variant="accent">Motivo</Badge>
                      <p className="text-sm text-fg-muted">{recGains ? `${recGains}. ` : ''}{rec.reason}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-fg-subtle">Nenhuma sugestão no momento.</p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
