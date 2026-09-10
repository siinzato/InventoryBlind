import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '../ui';
import { RISK_LEVEL_LABEL } from '../../lib/cbcAlgorithm';
import {
  getCountHistoryForProduct, scheduleCount,
  type ProductConfidenceRow, type ProductCountHistoryRow,
} from '../../lib/cbcService';

type Tab = 'composicao' | 'historico' | 'configuracao';

const FACTOR_LABEL: Record<string, { label: string; max: number }> = {
  accuracyHistory: { label: 'Histórico de acuracidade', max: 40 },
  recency: { label: 'Recência da contagem', max: 25 },
  stability: { label: 'Estabilidade operacional', max: 20 },
  integrity: { label: 'Integridade dos dados', max: 15 },
};

interface ConfidenceDetailDrawerProps {
  row: ProductConfidenceRow | null;
  companyId: string;
  userId: string;
  onClose: () => void;
  onStartCount: (productId: string) => void;
  onScheduled: () => void;
}

/** Painel lateral (não modal centralizado) — mesmo padrão de
 *  WarehousePositionDrawer.tsx (fixed à direita, motion/react), construído à
 *  parte para não misturar o detalhe do CBC com o painel do Digital Twin. */
export function ConfidenceDetailDrawer({ row, companyId, userId, onClose, onStartCount, onScheduled }: ConfidenceDetailDrawerProps) {
  const [tab, setTab] = useState<Tab>('composicao');
  const [history, setHistory] = useState<ProductCountHistoryRow[] | null>(null);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    if (!row) { setHistory(null); return; }
    setTab('composicao');
    getCountHistoryForProduct(row.product_id, companyId, row.product_location).then(setHistory);
  }, [row, companyId]);

  if (!row) return null;

  const handleSchedule = async () => {
    setScheduling(true);
    await scheduleCount(row.product_id, companyId, userId, !row.is_manually_scheduled);
    setScheduling(false);
    onScheduled();
  };

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
              <h2 className="text-base font-semibold text-fg truncate">{row.product_name}</h2>
              <p className="text-xs text-fg-subtle mt-0.5">
                SKU: {row.product_sku} · Localização: {row.product_location ?? '—'}
              </p>
              <p className="text-xs text-fg-subtle">Atualizado {new Date(row.last_algorithm_run).toLocaleString('pt-BR')}</p>
            </div>
            <button onClick={onClose} className="text-fg-subtle hover:text-fg transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-4 border-b border-edge grid grid-cols-2 gap-4">
            <div>
              <p className={`text-2xl font-semibold tabular-nums ${row.risk_level === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>
                {row.confidence_score != null ? `${row.confidence_score}/100` : '—'}
              </p>
              <p className="text-xs text-fg-subtle mt-0.5">
                Confiança {row.risk_level ? `· ${RISK_LEVEL_LABEL[row.risk_level]}` : '· Sem dados suficientes'}
              </p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-fg tabular-nums">
                {row.priority_score != null ? `${row.priority_score}/100` : '—'}
              </p>
              <p className="text-xs text-fg-subtle mt-0.5">Prioridade de contagem</p>
            </div>
          </div>

          <div className="flex items-center gap-5 px-6 border-b border-edge">
            {([
              ['composicao', 'Composição do score'],
              ['historico', 'Histórico'],
              ['configuracao', 'Configuração'],
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
                {row.why_to_count && (
                  <div className={row.risk_level === 'critico' ? 'text-red-600 dark:text-red-400' : 'text-fg-muted'}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-1">Por que está em prioridade</p>
                    <p className="text-sm">{row.why_to_count}</p>
                  </div>
                )}

                {row.has_sufficient_data ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Composição da confiança</p>
                    <div className="space-y-3">
                      {Object.entries(row.factors).map(([key, factor]) => {
                        const meta = FACTOR_LABEL[key] ?? { label: key, max: factor.weight };
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-fg-muted">{meta.label}</span>
                              <span className="text-fg tabular-nums">{factor.score} de {meta.max}</span>
                            </div>
                            <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${(factor.score / meta.max) * 100}%` }} />
                            </div>
                            <p className="text-xs text-fg-subtle mt-1">{factor.detail}</p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-sm font-medium text-fg mt-4">
                      Score calculado: {Object.values(row.factors).map(f => f.score).join(' + ')} = {row.confidence_score}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-fg-muted">Sem dados suficientes para calcular a confiança deste SKU-local.</p>
                    {row.missing_factors.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {row.missing_factors.map(f => (
                          <li key={f} className="text-xs text-fg-subtle">• {f} indisponível</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <p className="text-xs text-fg-subtle">
                  Cálculo em {new Date(row.last_algorithm_run).toLocaleString('pt-BR')}
                </p>

                <div className="pt-4 border-t border-edge">
                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Recomendação</p>
                  <p className="text-sm font-medium text-fg">
                    {row.confidence_score != null && row.confidence_score < 40 ? 'Realizar contagem imediatamente' : 'Programar próxima contagem'}
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-2 text-sm">
                    <div>
                      <p className="text-xs text-fg-subtle">Prazo recomendado</p>
                      <p className="text-fg">{new Date(row.next_count_date).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-fg-subtle">Localização</p>
                      <p className="text-fg">{row.product_location ?? '—'}</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'historico' && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Últimas contagens</p>
                {history == null ? (
                  <p className="text-sm text-fg-subtle">Carregando…</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Nenhuma contagem registrada ainda para este SKU-local.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h, i) => {
                      const divergence = h.systemQty != null && h.physicalQty != null ? h.physicalQty - h.systemQty : h.divergence;
                      return (
                        <div key={i} className="flex items-center justify-between text-sm border-b border-edge/60 pb-2 last:border-0">
                          <span className="text-fg-muted">{new Date(h.date).toLocaleDateString('pt-BR')}</span>
                          <span className="text-fg-subtle">Sistema {h.systemQty ?? '—'}</span>
                          <span className="text-fg-subtle">Físico {h.physicalQty ?? '—'}</span>
                          <span className={divergence && divergence !== 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}>
                            {divergence == null ? '—' : divergence === 0 ? 'Sem divergência' : `Divergência ${divergence > 0 ? '+' : ''}${divergence}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'configuracao' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-fg">Programação manual</p>
                    <p className="text-xs text-fg-subtle mt-0.5">
                      {row.is_manually_scheduled ? 'Este SKU-local está marcado para contagem programada.' : 'Marque para incluir na aba "Programadas".'}
                    </p>
                  </div>
                  <Button variant={row.is_manually_scheduled ? 'secondary' : 'primary'} size="sm" onClick={handleSchedule} disabled={scheduling}>
                    {row.is_manually_scheduled ? 'Remover' : 'Programar'}
                  </Button>
                </div>
                <p className="text-xs text-fg-subtle">
                  Algoritmo {row.algorithm_version} · última execução {new Date(row.last_algorithm_run).toLocaleString('pt-BR')}
                </p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-edge p-4 flex items-center gap-3">
            <Button variant="secondary" onClick={handleSchedule} disabled={scheduling} className="flex-1">
              {row.is_manually_scheduled ? 'Remover programação' : 'Programar'}
            </Button>
            <Button onClick={() => onStartCount(row.product_id)} className="flex-1">
              Iniciar contagem
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
