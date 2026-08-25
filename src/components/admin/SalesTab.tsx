// Aba "Vendas e Integrações" — Top 10 calculado a partir de vendas importadas (nunca editado
// manualmente), histórico de importações e o assistente de upload. Puramente analítico: nunca
// altera estoque, inventário ou contagem.

import { useEffect, useMemo, useState } from 'react';
import { Upload, TrendingUp, History, Package } from 'lucide-react';
import { Panel, PanelSection, Button, Table, Thead, Tr, Th, Td, SegmentedControl } from '../ui';
import { computeTopTen, type TopTenMetric, type TopTenPeriodPreset } from '../../lib/adminSales/salesTopTen';
import { listImportBatches, listSalesRecordsForTopTen, type SalesImportBatch } from '../../lib/adminSales/salesService';
import { SalesImportWizard } from './SalesImportWizard';

interface SalesTabProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const PERIOD_OPTIONS: { value: TopTenPeriodPreset; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes_atual', label: 'Mês atual' },
];

export function SalesTab({ companyId, userId, userEmail }: SalesTabProps) {
  const [metric, setMetric] = useState<TopTenMetric>('quantidade');
  const [period, setPeriod] = useState<TopTenPeriodPreset>('30d');
  const [records, setRecords] = useState<Awaited<ReturnType<typeof listSalesRecordsForTopTen>>>([]);
  const [batches, setBatches] = useState<SalesImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, b] = await Promise.all([
        listSalesRecordsForTopTen(companyId),
        listImportBatches(companyId),
      ]);
      setRecords(r);
      setBatches(b);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const topTen = useMemo(
    () => computeTopTen(records, metric, { preset: period }, new Date()),
    [records, metric, period]
  );

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-title flex items-center gap-2"><TrendingUp size={16} className="text-fg-subtle" /> Top 10 de Vendas</h3>
          <Button size="sm" onClick={() => setShowWizard(true)}><Upload size={14} /> Importar Vendas</Button>
        </PanelSection>
        <PanelSection className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Métrica"
            value={metric}
            onChange={setMetric}
            options={[{ value: 'quantidade', label: 'Quantidade vendida' }, { value: 'faturamento', label: 'Faturamento' }]}
          />
          <SegmentedControl label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        </PanelSection>
        <PanelSection className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-fg-subtle text-center py-6">Carregando...</p>
          ) : records.length === 0 ? (
            <div className="text-center py-8">
              <Package size={28} className="mx-auto text-fg-subtle mb-2" />
              <p className="text-sm text-fg-muted">Nenhuma venda importada ainda. Use "Importar Vendas" para começar.</p>
            </div>
          ) : topTen.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-6">Nenhuma venda no período selecionado.</p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>#</Th><Th>Produto</Th><Th>SKU</Th>
                  <Th className="text-right">Quantidade</Th><Th className="text-right">Faturamento</Th>
                </Tr>
              </Thead>
              <tbody>
                {topTen.map(entry => (
                  <Tr key={`${entry.sku}-${entry.productName}`}>
                    <Td>{entry.position}</Td>
                    <Td>{entry.productName}</Td>
                    <Td className="font-mono text-xs">{entry.sku ?? '—'}</Td>
                    <Td className="text-right">{entry.quantity}</Td>
                    <Td className="text-right">{entry.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title flex items-center gap-2"><History size={16} className="text-fg-subtle" /> Histórico de Importações</h3>
        </PanelSection>
        <PanelSection>
          {batches.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-4">Nenhuma importação registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {batches.map(b => (
                <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-fg truncate">{b.fileName}</p>
                    <p className="text-caption mt-0.5">{new Date(b.createdAt).toLocaleString('pt-BR')} · {b.status === 'completed' ? 'Concluída' : 'Falhou'}</p>
                  </div>
                  <div className="text-xs text-fg-muted text-right flex-shrink-0">
                    <p>{b.rowCount} linhas</p>
                    {b.unmatchedCount > 0 && <p className="text-amber-600 dark:text-amber-400">{b.unmatchedCount} não associadas</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </Panel>

      {showWizard && (
        <SalesImportWizard
          companyId={companyId} userId={userId} userEmail={userEmail}
          onClose={() => setShowWizard(false)}
          onImported={load}
        />
      )}
    </div>
  );
}
