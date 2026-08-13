import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { Page,
  PageHeader, Panel, PanelSection, Button, Stat, StatRow, StatCell, ListRow,
  SegmentedControl, type SegmentedOption,
} from '../ui';
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

const QUICK_FILTERS: SegmentedOption<AbcXyzFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'combo:AX', label: 'Apenas AX' },
  { value: 'combo:AZ', label: 'Apenas AZ' },
  { value: 'combo:CZ', label: 'Apenas CZ' },
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
    <Page>
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
            <PanelSection padding="md">
              <StatRow>
                <StatCell>
                  <Stat label="SKUs Classificados" value={totalSkus} icon={<LayoutGrid />} />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Valor Movimentado Total"
                    value={`R$ ${totalValue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
                    icon={<LayoutGrid />}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Mudaram de Classe"
                    value={migrations.length}
                    icon={<ArrowLeftRight />}
                    context={totalSkus ? `de ${totalSkus} SKUs` : undefined}
                  />
                </StatCell>
              </StatRow>
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
              <div className="mb-4">
                <SegmentedControl
                  label="Filtro rápido de classificação"
                  options={QUICK_FILTERS}
                  value={selectedCombo ? null : filter}
                  onChange={next => { setSelectedCombo(null); setFilter(next); }}
                />
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-fg-subtle">Nenhum SKU nesse filtro.</p>
              ) : (
                rows.map(row => (
                  <ListRow key={row.id} value={<ClassificationBadge combo={row.abc_xyz_class} />}>
                    <p className="truncate text-sm font-medium text-fg">{row.product_name}</p>
                    <p className="text-caption">
                      {row.product_sku} · R$ {row.value_moved.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} movimentados
                    </p>
                  </ListRow>
                ))
              )}
            </PanelSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
