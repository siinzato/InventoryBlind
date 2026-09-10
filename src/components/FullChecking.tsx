import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  RefreshCw, Check, ChevronLeft, AlertTriangle, ClipboardCheck, User,
} from 'lucide-react';
import type { FullOperation, FullOperationItem } from '../lib/fullManagerTypes';
import { STATUS_LABEL, STATUS_COLOR, ITEM_STATUS_LABEL, ITEM_STATUS_COLOR } from '../lib/fullManagerTypes';
import { Panel, PanelSection, Button } from './ui';
import { recomputeForProducts } from '../lib/cbcService';
import { recomputeRiskForProducts } from '../lib/riskService';
import { RcaClassificationModal, PendingRcaItem } from './rca/RcaClassificationModal';

// ── Operation selector ────────────────────────────────────────────────────────

const CheckingSelector: React.FC<{
  operations: FullOperation[];
  loading: boolean;
  onSelect: (op: FullOperation) => void;
}> = ({ operations, loading, onSelect }) => (
  <div className="space-y-3">
    <p className="text-sm text-fg-subtle font-medium">
      Selecione uma operação para conferência:
    </p>
    {loading ? (
      <div className="flex items-center justify-center py-16 gap-2 text-fg-subtle">
        <RefreshCw size={18} className="animate-spin" /> Carregando...
      </div>
    ) : operations.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 bg-surface-2 rounded-xl border border-edge text-fg-subtle">
        <ClipboardCheck size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">Nenhuma operação aguardando conferência.</p>
        <p className="text-xs mt-1">Operações precisam estar no status "Conferência".</p>
      </div>
    ) : (
      operations.map(op => {
        const tagCls = STATUS_COLOR[op.status];
        return (
          <button key={op.id} onClick={() => onSelect(op)}
            className="w-full flex items-center gap-4 p-4 bg-surface-2 border border-edge rounded-xl hover:border-fg-subtle hover:bg-surface-3 transition text-left">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-fg">FULL #{op.full_number}</p>
              <p className="text-sm text-fg-subtle">{op.marketplace} · {op.responsible || '—'}</p>
              <div className="flex gap-3 mt-1 text-xs text-fg-subtle">
                <span>{op.total_sku} SKU · {op.total_pieces} peças</span>
              </div>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${tagCls}`}>
              {STATUS_LABEL[op.status]}
            </span>
          </button>
        );
      })
    )}
  </div>
);

// ── Checking form ─────────────────────────────────────────────────────────────

const CheckingForm: React.FC<{
  operation: FullOperation;
  items: FullOperationItem[];
  onBack: () => void;
  onComplete: () => void;
}> = ({ operation, items, onBack, onComplete }) => {
  const { companyId, profile } = useAuth();
  const [checker, setChecker] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingRcaItems, setPendingRcaItems] = useState<PendingRcaItem[]>([]);

  const picked = items.filter(i => i.status === 'picked');
  const errors = items.filter(i => ['not_found', 'picking_error', 'skipped'].includes(i.status));
  const totalPicked = picked.reduce((s, i) => s + i.quantity_picked, 0);
  const totalRequested = items.reduce((s, i) => s + i.quantity_requested, 0);
  const accuracy = totalRequested > 0 ? Math.round((totalPicked / totalRequested) * 100) : 0;

  const handleSave = async (status: 'completed' | 'checking') => {
    if (status === 'completed' && !checker.trim()) {
      setError('Informe o nome do conferente.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const update: Partial<FullOperation> = {
        status,
        checker: checker.trim() || null,
        checker_notes: notes.trim() || null,
        checked_at: new Date().toISOString(),
      };
      if (status === 'completed') update.completed_at = new Date().toISOString();
      const { error: err } = await supabase.from('full_operations').update(update).eq('id', operation.id);
      if (err) throw err;

      // CBC — conclusão de operação Full é o sinal de "movimentação" para recálculo do score.
      if (status === 'completed' && companyId) {
        const productIds = items.map(i => i.product_id).filter((id): id is string => !!id);
        if (productIds.length > 0) {
          recomputeForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
          recomputeRiskForProducts(productIds, companyId, profile?.id, profile?.email ?? undefined);
        }
      }

      // RCA — divergência (item não encontrado/erro/pulado) exige causa antes de fechar a
      // operação; se não houver nenhuma, segue direto como antes.
      if (status === 'completed' && errors.length > 0) {
        setPendingRcaItems(errors.map(item => ({
          sourceItemId: item.id,
          productId: item.product_id,
          sku: item.sku,
          productName: item.product_name,
          location: item.location,
          operatorUserId: item.picked_by_user_id,
          operatorName: null,
          divergenceQty: item.quantity_picked - item.quantity_requested,
        })));
        setSaving(false);
        return;
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Op header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-fg-subtle hover:text-fg-muted">
          <ChevronLeft size={20} />
        </button>
        <div>
          <p className="font-bold text-fg">FULL #{operation.full_number}</p>
          <p className="text-xs text-fg-subtle">{operation.marketplace} · {operation.responsible || '—'}</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <Panel>
        <PanelSection>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y divide-edge sm:divide-y-0 sm:divide-x">
            {[
              { l: 'Separados', v: picked.length, cls: 'text-emerald-700 dark:text-emerald-400' },
              { l: 'Com erro', v: errors.length, cls: errors.length > 0 ? 'text-red-700 dark:text-red-400' : '' },
              { l: 'Peças coletadas', v: totalPicked, cls: '' },
              { l: 'Acurácia', v: `${accuracy}%`, cls: accuracy >= 90 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400' },
            ].map(({ l, v, cls }, i) => (
              <div key={l} className={`px-0 sm:px-4 py-2 sm:py-0 ${i === 0 ? 'sm:pl-0' : ''}`}>
                <p className={`text-2xl font-bold leading-none ${cls}`}>{v}</p>
                <p className="text-caption mt-1">{l}</p>
              </div>
            ))}
          </div>
        </PanelSection>
      </Panel>

      {/* Items table */}
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Itens da Operação ({items.length})</h3>
        </PanelSection>
        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-b border-edge">
                {['Status', 'Nome', 'SKU', 'Local', 'Solicitado', 'Coletado'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-fg-subtle uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors">
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ITEM_STATUS_COLOR[item.status]}`}>
                      {ITEM_STATUS_LABEL[item.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium text-fg max-w-[180px] truncate">{item.product_name || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">{item.sku || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">{item.location || '—'}</td>
                  <td className="px-4 py-2 font-mono font-bold text-fg-muted">{item.quantity_requested}</td>
                  <td className="px-4 py-2 font-mono font-bold">
                    <span className={item.quantity_picked >= item.quantity_requested ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {item.quantity_picked}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Checking form */}
      <Panel>
        <PanelSection className="space-y-4">
          <h3 className="text-title flex items-center gap-2">
            <User size={15} className="text-fg-subtle" /> Conferente
          </h3>
          <div>
            <label className="block text-xs font-medium text-fg-subtle uppercase mb-1.5">Nome do Conferente *</label>
            <input value={checker} onChange={e => setChecker(e.target.value)} placeholder="Nome do conferente"
              className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-subtle uppercase mb-1.5">Observações</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-4 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none" />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-sm text-red-700 dark:text-red-400">
              <AlertTriangle size={16} />{error}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            <Button onClick={() => handleSave('completed')} disabled={saving}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              Finalizar Operação
            </Button>
            <Button variant="secondary" onClick={() => handleSave('checking')} disabled={saving}>
              Salvar rascunho
            </Button>
          </div>
        </PanelSection>
      </Panel>

      {profile && companyId && (
        <RcaClassificationModal
          open={pendingRcaItems.length > 0}
          sourceModule="full_operation"
          items={pendingRcaItems}
          companyId={companyId}
          userId={profile.id}
          userEmail={profile.email ?? ''}
          onDone={() => { setPendingRcaItems([]); onComplete(); }}
        />
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

interface FullCheckingProps {
  initialOperationId?: string;
  onDone: () => void;
}

const FullChecking: React.FC<FullCheckingProps> = ({ initialOperationId, onDone }) => {
  const { companyId } = useAuth();
  const [operations, setOperations] = useState<FullOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOp, setSelectedOp] = useState<FullOperation | null>(null);
  const [items, setItems] = useState<FullOperationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const loadOps = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('full_operations').select('id, company_id, full_number, marketplace, responsible, scheduled_date, scheduled_time, status, total_sku, total_pieces, notes, checker, checker_notes, checked_at, completed_at, created_at, updated_at')
      .eq('company_id', companyId)
      .in('status', ['checking', 'ready'])
      .order('updated_at', { ascending: false })
      .limit(50);
    const ops = (data as FullOperation[]) || [];
    setOperations(ops);
    setLoading(false);
    if (initialOperationId) {
      const found = ops.find(o => o.id === initialOperationId);
      if (found) selectOp(found);
    }
  }, [companyId, initialOperationId]);

  useEffect(() => { loadOps(); }, [loadOps]);

  const selectOp = async (op: FullOperation) => {
    setSelectedOp(op);
    setLoadingItems(true);
    const { data } = await supabase.from('full_operation_items').select('id, operation_id, company_id, listing_id, product_id, sku, ean, product_name, location, quantity_requested, quantity_picked, status, picker_notes, picked_at, created_at').eq('operation_id', op.id).order('location');
    setItems((data as FullOperationItem[]) || []);
    setLoadingItems(false);
  };

  if (loadingItems) {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-fg-subtle">
        <RefreshCw size={20} className="animate-spin" />Carregando itens...
      </div>
    );
  }

  if (selectedOp) {
    return (
      <CheckingForm
        operation={selectedOp}
        items={items}
        onBack={() => setSelectedOp(null)}
        onComplete={() => { setSelectedOp(null); onDone(); loadOps(); }}
      />
    );
  }

  return <CheckingSelector operations={operations} loading={loading} onSelect={selectOp} />;
};

export default FullChecking;
