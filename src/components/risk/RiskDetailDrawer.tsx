import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '../ui';
import { RISK_BAND_LABEL } from '../../lib/riskAlgorithm';
import { getRecentEvidenceForProduct, type ProductRiskRow, type RiskEvidenceEvent } from '../../lib/riskService';

const FACTOR_LABEL: Record<string, string> = {
  divergenceHistory: 'Divergência recorrente',
  recurrence: 'Reincidência de divergência',
  recency: 'Recência da última contagem',
  stockouts: 'Rupturas de estoque',
  adjustments: 'Ajustes de saldo',
  abcClass: 'Classe ABC',
  financialValue: 'Valor em estoque',
  demand: 'Demanda média',
  coverage: 'Cobertura de estoque',
  operationalCriticality: 'Criticidade operacional',
};

interface RiskDetailDrawerProps {
  row: ProductRiskRow | null;
  companyId: string;
  onClose: () => void;
  onStartCount: (productId: string) => void;
  onAddToRoute: (productId: string) => void;
  isInRoute: boolean;
}

/** Painel lateral (não modal centralizado) — mesmo padrão de
 *  ConfidenceDetailDrawer.tsx / WarehousePositionDrawer.tsx (fixed à direita,
 *  motion/react), construído à parte para não misturar o detalhe de risco com
 *  os outros painéis de contexto do app. */
export function RiskDetailDrawer({ row, companyId, onClose, onStartCount, onAddToRoute, isInRoute }: RiskDetailDrawerProps) {
  const [tab, setTab] = useState<'composicao' | 'evidencias'>('composicao');
  const [evidence, setEvidence] = useState<RiskEvidenceEvent[] | null>(null);

  useEffect(() => {
    if (!row) { setEvidence(null); return; }
    setTab('composicao');
    getRecentEvidenceForProduct(row.product_id, companyId, row.product_location).then(setEvidence);
  }, [row, companyId]);

  if (!row) return null;

  const factors = row.factors ?? { probability: {}, impact: {} };
  const probabilityEntries = Object.entries(factors.probability ?? {});
  const impactEntries = Object.entries(factors.impact ?? {});
  const isCritical = row.risk_level === 'critico';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[var(--z-modal)]" style={{ zIndex: 'var(--z-modal)' }}>
        <motion.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute right-0 top-0 h-full w-full max-w-md bg-surface border-l border-edge shadow-overlay overflow-y-auto"
        >
          <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-edge">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Risco do SKU-local</p>
              <h2 className="text-base font-semibold text-fg truncate">{row.product_name}</h2>
              <p className="text-xs text-fg-subtle mt-0.5">
                {row.product_sku} · Localização {row.product_location ?? '—'}
              </p>
            </div>
            <button onClick={onClose} className="text-fg-subtle hover:text-fg transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-4 border-b border-edge">
            <div className="flex items-center gap-4">
              <div>
                <p className={`text-3xl font-semibold tabular-nums ${isCritical ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>
                  {row.risk_score != null ? `${row.risk_score}` : '—'}<span className="text-base text-fg-subtle">/100</span>
                </p>
                <p className="text-xs text-fg-subtle mt-0.5">{row.risk_level ? RISK_BAND_LABEL[row.risk_level] : 'Dados insuficientes'}</p>
              </div>
              <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-fg-subtle text-xs">Probabilidade</p>
                  <p className="text-fg tabular-nums">{row.probability != null ? `${row.probability}/100` : '—'}</p>
                </div>
                <div>
                  <p className="text-fg-subtle text-xs">Impacto</p>
                  <p className="text-fg tabular-nums">{row.impact != null ? `${row.impact}/100` : '—'}</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-fg-subtle mt-2">Risco intrínseco = Probabilidade × Impacto / 100</p>
            <p className="text-xs text-fg-subtle">Calculado em {new Date(row.last_risk_update).toLocaleString('pt-BR')}</p>
          </div>

          <div className="flex items-center gap-5 px-6 border-b border-edge">
            {([
              ['composicao', 'Por que está em risco'],
              ['evidencias', 'Evidências recentes'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === key ? 'text-accent border-accent' : 'text-fg-muted border-transparent hover:text-fg'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-5">
            {tab === 'composicao' && (
              <>
                {!row.has_sufficient_data ? (
                  <div>
                    <p className="text-sm text-fg-muted">Sem dados suficientes para calcular a probabilidade deste SKU-local (nunca foi contado).</p>
                    {row.missing_factors.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {row.missing_factors.map(f => (
                          <li key={f} className="text-xs text-fg-subtle">• {f} indisponível</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className={isCritical ? 'text-red-600 dark:text-red-400' : 'text-fg-muted'}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-1">Causa dominante</p>
                    <p className="text-sm">{row.risk_reason}</p>
                  </div>
                )}

                {probabilityEntries.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Probabilidade — por que este item está em risco</p>
                    <div className="space-y-3">
                      {probabilityEntries.map(([key, factor]) => (
                        <div key={key}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-fg-muted">{FACTOR_LABEL[key] ?? key}</span>
                            <span className="text-fg tabular-nums">{factor.score}/100 · peso {factor.weight}%</span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${factor.score}%` }} />
                          </div>
                          <p className="text-xs text-fg-subtle mt-1">{factor.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-edge">
                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Impacto operacional</p>
                  <div className="space-y-3">
                    {impactEntries.map(([key, factor]) => (
                      <div key={key}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-fg-muted">{FACTOR_LABEL[key] ?? key}</span>
                          <span className="text-fg tabular-nums">{factor.score}/100 · peso {factor.weight}%</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
                          <div className="h-full rounded-full bg-fg-muted" style={{ width: `${factor.score}%` }} />
                        </div>
                        <p className="text-xs text-fg-subtle mt-1">{factor.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={() => setTab('evidencias')} className="text-sm font-medium text-accent hover:text-accent-strong">
                  Ver histórico completo →
                </button>
              </>
            )}

            {tab === 'evidencias' && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Linha do tempo</p>
                {evidence == null ? (
                  <p className="text-sm text-fg-subtle">Carregando…</p>
                ) : evidence.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Nenhum evento registrado ainda para este SKU-local.</p>
                ) : (
                  <div className="space-y-3">
                    {evidence.map((e, i) => (
                      <div key={i} className="border-b border-edge/60 pb-2 last:border-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className={e.label.includes('Ruptura') || e.label.includes('Divergência') ? 'text-red-600 dark:text-red-400' : 'text-fg-muted'}>
                            {e.label}
                          </span>
                          <span className="text-xs text-fg-subtle">{new Date(e.date).toLocaleString('pt-BR')}</span>
                        </div>
                        <p className="text-xs text-fg-subtle mt-0.5">{e.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-edge p-4 flex items-center gap-3">
            <Button variant="secondary" onClick={() => onAddToRoute(row.product_id)} className="flex-1">
              {isInRoute ? 'Remover da rota' : 'Adicionar à rota'}
            </Button>
            <Button onClick={() => onStartCount(row.product_id)} className="flex-1">
              Criar contagem
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
