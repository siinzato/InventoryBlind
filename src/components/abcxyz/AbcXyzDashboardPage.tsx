import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { PageHeader, Panel, PanelSection, Button } from '../ui';
import {
  getMatrixCounts, listWithFilter, getClassMigrations, recomputeAbcXyzForCompany,
  AbcXyzFilter, ProductAbcXyzRow, AbcXyzMigration,
} from '../../lib/abcXyzService';
import { ABC_XYZ_STRATEGIES } from '../../lib/abcXyzStrategies';
import { ClassificationMatrix } from './ClassificationMatrix';
import { ClassificationBadge } from './ClassificationBadge';
import type { AbcXyzCombo } from '../../lib/supabase';

interface AbcXyzDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const QUICK_FILTERS: { id: AbcXyzFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'combo:AX', label: 'Apenas AX' },
  { id: 'combo:AZ', label: 'Apenas AZ' },
  { id: 'combo:CZ', label: 'Apenas CZ' },
];

export function AbcXyzDashboardPage({ companyId, userId, userEmail }: AbcXyzDashboardPageProps) {
  const [matrix, setMatrix] = useState<Record<AbcXyzCombo, { count: number; value: number }> | null>(null);
  const [migrations, setMigrations] = useState<AbcXyzMigration[]>([]);
  const [selectedCombo, setSelectedCombo] = useState<AbcXyzCombo | null>(null);
  const [filter, setFilter] = useState<AbcXyzFilter>('all');
  const [rows, setRows] = useState<ProductAbcXyzRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const loadOverview = useCallback(() => {
    setLoading(true);
    Promise.all([getMatrixCounts(companyId), getClassMigrations(companyId)]).then(([m, mig]) => {
      setMatrix(m);
      setMigrations(mig);
      setLoading(false);
    });
  }, [companyId]);

  useEffect(loadOverview, [loadOverview]);

  const activeFilter: AbcXyzFilter = selectedCombo ? `combo:${selectedCombo}` : filter;

  useEffect(() => {
    listWithFilter(companyId, activeFilter).then(setRows);
  }, [companyId, activeFilter]);

  const handleRecomputeAll = async () => {
    setRecomputing(true);
    await recomputeAbcXyzForCompany(companyId, userId, userEmail);
    loadOverview();
    listWithFilter(companyId, activeFilter).then(setRows);
    setRecomputing(false);
  };

  const totalSkus = matrix ? Object.values(matrix).reduce((s, c) => s + c.count, 0) : 0;
  const totalValue = matrix ? Object.values(matrix).reduce((s, c) => s + c.value, 0) : 0;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Classificação ABC+XYZ"
        description="Prioriza estratégia operacional de estoque combinando valor movimentado (ABC) e previsibilidade de demanda (XYZ)."
        actions={
          <Button variant="secondary" onClick={handleRecomputeAll} disabled={recomputing}>
            <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recalculando...' : 'Recalcular Tudo'}
          </Button>
        }
      />

      {loading || !matrix ? (
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando classificação...</PanelSection></Panel>
      ) : (
        <>
          <Panel>
            <PanelSection padding="md" className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-2.5">
                <LayoutGrid size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-fg-subtle">SKUs Classificados</p>
                  <p className="text-sm font-semibold text-fg">{totalSkus}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <LayoutGrid size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-fg-subtle">Valor Movimentado Total</p>
                  <p className="text-sm font-semibold text-fg">R$ {totalValue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <ArrowLeftRight size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-fg-subtle">Mudaram de Classe</p>
                  <p className="text-sm font-semibold text-fg">{migrations.length}</p>
                </div>
              </div>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <p className="text-section mb-3">Matriz ABC × XYZ</p>
              <ClassificationMatrix counts={matrix} selected={selectedCombo} onSelect={setSelectedCombo} />
              {selectedCombo && (
                <div className="mt-4 p-3 bg-surface-3/50 rounded-lg">
                  <p className="text-sm font-semibold text-fg">{ABC_XYZ_STRATEGIES[selectedCombo].title}</p>
                  <p className="text-xs text-fg-muted mt-1">{ABC_XYZ_STRATEGIES[selectedCombo].description}</p>
                  <p className="text-xs text-accent mt-1.5 font-medium">{ABC_XYZ_STRATEGIES[selectedCombo].countingGuidance}</p>
                </div>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection padding="md">
              <div className="flex flex-wrap gap-2 mb-4">
                {QUICK_FILTERS.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setSelectedCombo(null); setFilter(f.id); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      !selectedCombo && filter === f.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                {rows.length === 0 && <p className="text-xs text-fg-subtle">Nenhum SKU nesse filtro.</p>}
                {rows.map(row => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-2 border-b border-edge last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{row.product_name}</p>
                      <p className="text-xs text-fg-subtle">{row.product_sku} · R$ {row.value_moved.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} movimentados</p>
                    </div>
                    <ClassificationBadge combo={row.abc_xyz_class} />
                  </div>
                ))}
              </div>
            </PanelSection>
          </Panel>
        </>
      )}
    </div>
  );
}
