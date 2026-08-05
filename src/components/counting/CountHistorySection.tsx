import { useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Panel, PanelSection, Badge } from '../ui';
import { supabase, InventoryCountRecord } from '../../lib/supabase';

interface CountHistorySectionProps {
  companyId: string;
  brandsById: Map<string, string>;
  refreshKey: number;
}

const formatDateTime = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
};

/** Groups 1ª/2ª/3ª counts by their linked_count_id chain (root = the record with no linked_count_id). */
function groupByChain(records: InventoryCountRecord[]): InventoryCountRecord[][] {
  const roots = records.filter(r => !r.linked_count_id);
  const byRoot = new Map<string, InventoryCountRecord[]>();

  roots.forEach(root => byRoot.set(root.id, [root]));
  records
    .filter(r => r.linked_count_id)
    .forEach(r => {
      const chain = byRoot.get(r.linked_count_id!);
      if (chain) chain.push(r);
      else byRoot.set(r.linked_count_id!, [r]);
    });

  return Array.from(byRoot.values()).map(chain => chain.sort((a, b) => a.count_number - b.count_number));
}

export function CountHistorySection({ companyId, brandsById, refreshKey }: CountHistorySectionProps) {
  const [records, setRecords] = useState<InventoryCountRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    supabase
      .from('inventory_count_records')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('Error loading count history:', error);
        } else if (data) {
          setRecords(data as InventoryCountRecord[]);
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [companyId, refreshKey]);

  const chains = groupByChain(records);

  return (
    <Panel>
      <PanelSection padding="md" className="flex items-center gap-2">
        <History size={16} className="text-fg-subtle" />
        <p className="text-title">Histórico de Contagens</p>
      </PanelSection>

      {loading && (
        <PanelSection padding="lg" className="flex items-center justify-center text-fg-subtle text-sm gap-2">
          <RefreshCw size={14} className="animate-spin" /> Carregando...
        </PanelSection>
      )}

      {!loading && chains.length === 0 && (
        <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">
          Nenhuma contagem registrada ainda.
        </PanelSection>
      )}

      {!loading && chains.map(chain => (
        <PanelSection key={chain[0].id} padding="md">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-fg">{brandsById.get(chain[0].brand_id) ?? 'Linha removida'}</p>
            <span className="text-xs text-fg-subtle">{formatDateTime(chain[0].created_at)}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {chain.map(rec => (
              <div key={rec.id} className="flex-1 min-w-[160px] rounded-lg border border-edge px-3 py-2">
                <div className="flex items-center justify-between">
                  <Badge variant={rec.count_number === 1 ? 'neutral' : rec.count_number === 2 ? 'accent' : 'warning'}>
                    {rec.count_number}ª contagem
                  </Badge>
                  <span className="text-xs text-fg-subtle">{rec.source === 'import' ? 'Importação' : 'Manual'}</span>
                </div>
                <p className="text-xs text-fg-muted mt-1.5">{rec.operator_1 || 'Operador não informado'}</p>
                <p className="text-xs text-fg-subtle">
                  {rec.skus_contados} contados · {rec.divergencias_reais} divergências reais
                  {rec.accuracy_final !== null ? ` · ${rec.accuracy_final.toFixed(1)}% acuracidade` : ''}
                </p>
              </div>
            ))}
          </div>
        </PanelSection>
      ))}
    </Panel>
  );
}
