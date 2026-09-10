// Aba "Visão Geral" — só dados reais do workspace: nada fica com valor fictício quando ausente.

import { useEffect, useState } from 'react';
import { Building2, ClipboardList, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';
import { Panel, PanelSection, Stat, StatRow, StatCell } from '../ui';
import type { InventorySnapshot } from '../../lib/supabase';
import { computeTopTen } from '../../lib/adminSales/salesTopTen';
import { listImportBatches, listSalesRecordsForTopTen, type SalesImportBatch } from '../../lib/adminSales/salesService';

interface OverviewTabProps {
  companyId: string;
  companyName: string | null;
  companyCreatedAt: string | null;
  globais: { totalSku: number; totalDone: number; totalDiv: number; acuracidade: number };
  latestSnapshot: InventorySnapshot | null;
}

export function OverviewTab({ companyId, companyName, companyCreatedAt, globais, latestSnapshot }: OverviewTabProps) {
  const [loading, setLoading] = useState(true);
  const [latestBatch, setLatestBatch] = useState<SalesImportBatch | null>(null);
  const [topFive, setTopFive] = useState<ReturnType<typeof computeTopTen>>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listImportBatches(companyId, 1), listSalesRecordsForTopTen(companyId)])
      .then(([batches, records]) => {
        if (cancelled) return;
        setLatestBatch(batches[0] ?? null);
        setTopFive(computeTopTen(records, 'faturamento', { preset: '30d' }, new Date(), 5));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title flex items-center gap-2"><Building2 size={16} className="text-fg-subtle" /> Status da Empresa</h3>
        </PanelSection>
        <PanelSection>
          <StatRow className="md:grid-cols-4">
            <StatCell><Stat label="Empresa" value={companyName ?? '—'} /></StatCell>
            <StatCell><Stat label="Total SKUs" value={globais.totalSku} /></StatCell>
            <StatCell><Stat label="Acuracidade" value={`${globais.acuracidade.toFixed(1)}%`} /></StatCell>
            <StatCell><Stat label="Ativa desde" value={companyCreatedAt ? new Date(companyCreatedAt).toLocaleDateString('pt-BR') : '—'} /></StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title flex items-center gap-2"><ClipboardList size={16} className="text-fg-subtle" /> Último Inventário</h3>
          </PanelSection>
          <PanelSection>
            {latestSnapshot ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-fg">{latestSnapshot.name}</p>
                <p className="text-caption">{new Date(latestSnapshot.end_date).toLocaleDateString('pt-BR')}</p>
                <p className="text-fg-muted">Progresso: <strong className="text-fg">{latestSnapshot.progress.toFixed(1)}%</strong> · Acuracidade: <strong className="text-fg">{latestSnapshot.accuracy.toFixed(1)}%</strong></p>
              </div>
            ) : (
              <p className="text-sm text-fg-subtle flex items-center gap-2"><AlertTriangle size={14} /> Nenhum inventário arquivado ainda.</p>
            )}
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title flex items-center gap-2"><TrendingUp size={16} className="text-fg-subtle" /> Última Importação de Vendas</h3>
          </PanelSection>
          <PanelSection>
            {loading ? (
              <p className="text-sm text-fg-subtle flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando...</p>
            ) : latestBatch ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-fg truncate">{latestBatch.fileName}</p>
                <p className="text-caption">{new Date(latestBatch.createdAt).toLocaleString('pt-BR')}</p>
                <p className="text-fg-muted">{latestBatch.rowCount} linhas · {latestBatch.unmatchedCount} não associadas</p>
              </div>
            ) : (
              <p className="text-sm text-fg-subtle">Nenhuma importação de vendas ainda.</p>
            )}
          </PanelSection>
        </Panel>
      </div>

      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Prévia do Top 10 de Vendas (30 dias, faturamento)</h3>
        </PanelSection>
        <PanelSection>
          {loading ? (
            <p className="text-sm text-fg-subtle">Carregando...</p>
          ) : topFive.length === 0 ? (
            <p className="text-sm text-fg-subtle">Sem vendas importadas nos últimos 30 dias.</p>
          ) : (
            <div className="divide-y divide-edge">
              {topFive.map(entry => (
                <div key={`${entry.sku}-${entry.productName}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-fg">{entry.position}. {entry.productName}</span>
                  <span className="text-fg-muted">{entry.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </Panel>
    </div>
  );
}
