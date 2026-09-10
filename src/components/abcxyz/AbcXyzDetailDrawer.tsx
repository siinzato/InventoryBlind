import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Button, Textarea } from '../ui';
import { ABC_XYZ_STRATEGIES } from '../../lib/abcXyzStrategies';
import { ClassificationBadge } from './ClassificationBadge';
import {
  getWeeklySeriesForProduct, getOperationalReadout, getMovementsForProduct, hasComparableHistory,
  PERIOD_LABEL, SOURCE_LABEL,
  type ProductAbcXyzRow, type AbcXyzPeriod, type WeeklyDemandPoint, type OperationalReadout,
} from '../../lib/abcXyzService';
import type { AbcXyzMigration } from '../../lib/abcXyzService';

const UNCLASSIFIED_LABEL: Record<string, string> = {
  sem_movimento: 'Sem saídas no período',
  sem_custo: 'Sem custo cadastrado',
  fonte_desconectada: 'Fonte de vendas desconectada',
  historico_insuficiente: 'Histórico insuficiente',
  sku_nao_associado: 'SKU não associado a uma venda',
};

interface AbcXyzDetailDrawerProps {
  row: ProductAbcXyzRow | null;
  companyId: string;
  period: AbcXyzPeriod;
  migrations: AbcXyzMigration[];
  onClose: () => void;
  onOpenProduct: (productId: string) => void;
}

function WeeklyBarChart({ points }: { points: WeeklyDemandPoint[] }) {
  if (points.length === 0) return <p className="text-xs text-fg-subtle py-4">Sem série de demanda disponível.</p>;
  const max = Math.max(...points.map(p => p.quantity), 1);
  return (
    <div className="flex items-end gap-0.5 h-16">
      {points.map(p => (
        <div key={p.weekIndex} className="flex-1 bg-fg-muted/70 rounded-t-sm" style={{ height: `${Math.max((p.quantity / max) * 100, p.quantity > 0 ? 4 : 1)}%` }} title={`${p.quantity} un.`} />
      ))}
    </div>
  );
}

export function AbcXyzDetailDrawer({ row, companyId, period, migrations, onClose, onOpenProduct }: AbcXyzDetailDrawerProps) {
  const [tab, setTab] = useState<'demanda' | 'movimentacoes'>('demanda');
  const [series, setSeries] = useState<WeeklyDemandPoint[] | null>(null);
  const [readout, setReadout] = useState<OperationalReadout | null>(null);
  const [movements, setMovements] = useState<{ saleDate: string; quantity: number; totalValue: number }[] | null>(null);
  const [firstOfPeriod, setFirstOfPeriod] = useState(true);
  const [policyNote, setPolicyNote] = useState('');
  const [policySaved, setPolicySaved] = useState(false);

  useEffect(() => {
    if (!row) { setSeries(null); setReadout(null); setMovements(null); return; }
    setTab('demanda');
    setPolicySaved(false);
    setPolicyNote('');
    getWeeklySeriesForProduct(row.product_id, row.product_sku, companyId, period).then(setSeries);
    getOperationalReadout(row.product_id, companyId).then(setReadout);
    getMovementsForProduct(row.product_id, companyId, period).then(setMovements);
    hasComparableHistory(companyId, period).then(setFirstOfPeriod);
  }, [row, companyId, period]);

  if (!row) return null;

  const migration = migrations.find(m => m.productId === row.product_id) ?? null;
  const strategy = row.abc_xyz_class ? ABC_XYZ_STRATEGIES[row.abc_xyz_class] : null;

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
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Análise do produto</p>
              <h2 className="text-base font-semibold text-fg truncate">{row.product_name}</h2>
              <p className="text-xs text-fg-subtle mt-0.5">{row.product_sku} · {PERIOD_LABEL[period]}</p>
            </div>
            <button onClick={onClose} className="text-fg-subtle hover:text-fg transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-4 border-b border-edge">
            <div className="flex items-center gap-3">
              <ClassificationBadge combo={row.abc_xyz_class} className="text-lg px-3 py-1" />
              {strategy && <p className="text-sm text-fg-muted">{strategy.title}</p>}
            </div>
            {!row.abc_xyz_class && row.unclassified_reason && (
              <p className="text-sm text-fg-muted mt-2">{UNCLASSIFIED_LABEL[row.unclassified_reason]}</p>
            )}
            <p className="text-xs text-fg-subtle mt-2">Fonte: {SOURCE_LABEL[row.source] ?? row.source} · Calculado em {new Date(row.updated_at).toLocaleString('pt-BR')}</p>
          </div>

          <div className="p-6 space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Composição ABC</p>
              {row.abc_class ? (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-fg-subtle text-xs">Qtd. movimentada</p><p className="text-fg tabular-nums">{row.quantity_moved.toLocaleString('pt-BR')} un.</p></div>
                  <div><p className="text-fg-subtle text-xs">Custo médio</p><p className="text-fg tabular-nums">{row.unit_cost_used != null ? `R$ ${row.unit_cost_used.toFixed(2)}` : '—'}</p></div>
                  <div><p className="text-fg-subtle text-xs">Valor movimentado</p><p className="text-fg tabular-nums">R$ {row.value_moved.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p></div>
                </div>
              ) : (
                <p className="text-sm text-fg-subtle">{row.unclassified_reason ? UNCLASSIFIED_LABEL[row.unclassified_reason] : 'Sem classificação ABC.'}</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Comportamento da demanda</p>
              <WeeklyBarChart points={series ?? []} />
              {row.xyz_class ? (
                <div className="grid grid-cols-3 gap-3 text-sm mt-2">
                  <div><p className="text-fg-subtle text-xs">CV</p><p className="text-fg tabular-nums">{row.demand_coefficient_variation?.toFixed(2) ?? '—'}</p></div>
                  <div><p className="text-fg-subtle text-xs">Semanas s/ saída</p><p className="text-fg tabular-nums">{row.weeks_without_sale}</p></div>
                  <div><p className="text-fg-subtle text-xs">Semanas c/ dado</p><p className="text-fg tabular-nums">{row.weeks_with_data}</p></div>
                </div>
              ) : (
                <p className="text-sm text-fg-subtle mt-2">{row.unclassified_reason ? UNCLASSIFIED_LABEL[row.unclassified_reason] : 'Sem classificação XYZ.'}</p>
              )}
            </div>

            <div className="pt-4 border-t border-edge">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Leitura operacional</p>
              {strategy && <p className="text-sm text-fg mb-2">{strategy.countingGuidance}</p>}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-fg-subtle text-xs">Estoque disponível</p><p className="text-fg tabular-nums">{readout?.stockQuantity ?? '—'}</p></div>
                <div><p className="text-fg-subtle text-xs">Rupturas</p><p className={`tabular-nums ${readout && readout.ruptureCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg'}`}>{readout?.ruptureCount ?? '—'}</p></div>
                <div><p className="text-fg-subtle text-xs">Última contagem</p><p className="text-fg">{readout?.lastCountDate ? new Date(readout.lastCountDate).toLocaleDateString('pt-BR') : '—'}</p></div>
              </div>
            </div>

            <div className="pt-4 border-t border-edge">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Histórico de classe</p>
              {firstOfPeriod && !migration ? (
                <p className="text-sm text-fg-subtle">Primeira classificação deste período.</p>
              ) : migration ? (
                <p className="text-sm text-fg">{migration.from} → {migration.to}</p>
              ) : (
                <p className="text-sm text-fg-subtle">Classe mantida desde a última comparação.</p>
              )}
            </div>

            <div className="pt-4 border-t border-edge">
              <div className="flex items-center gap-5 mb-3">
                <button onClick={() => setTab('demanda')} className={`text-sm font-medium pb-1 border-b-2 ${tab === 'demanda' ? 'text-accent border-accent' : 'text-fg-muted border-transparent'}`}>Resumo</button>
                <button onClick={() => setTab('movimentacoes')} className={`text-sm font-medium pb-1 border-b-2 ${tab === 'movimentacoes' ? 'text-accent border-accent' : 'text-fg-muted border-transparent'}`}>Movimentações</button>
              </div>
              {tab === 'movimentacoes' && (
                movements == null ? (
                  <p className="text-sm text-fg-subtle">Carregando…</p>
                ) : movements.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Nenhuma venda registrada nesta fonte para o período.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {movements.map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-sm border-b border-edge/60 pb-1 last:border-0">
                        <span className="text-fg-subtle">{new Date(m.saleDate).toLocaleDateString('pt-BR')}</span>
                        <span className="text-fg tabular-nums">{m.quantity} un.</span>
                        <span className="text-fg-muted tabular-nums">R$ {m.totalValue.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
              {tab === 'demanda' && strategy && (
                <p className="text-sm text-fg-muted">{strategy.description}</p>
              )}
            </div>

            {strategy && (
              <div className="pt-4 border-t border-edge">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle mb-2">Criar política de estoque</p>
                {policySaved ? (
                  <p className="text-sm text-fg-muted">Recomendação registrada localmente para este produto.</p>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      value={policyNote || strategy.countingGuidance}
                      onChange={e => setPolicyNote(e.target.value)}
                      rows={2}
                    />
                    <Button size="sm" variant="secondary" onClick={() => setPolicySaved(true)}>Salvar recomendação</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 bg-surface border-t border-edge p-4 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTab('movimentacoes')} className="flex-1">Ver movimentações</Button>
            <Button size="sm" onClick={() => onOpenProduct(row.product_id)} className="flex-1">Abrir produto</Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
