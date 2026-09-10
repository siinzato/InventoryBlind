// "Progresso do inventário" — reaproveita `globais` (já carregado pelo
// Dashboard) para percentual/contabilizados/pendentes/linhas, e uma única
// consulta leve e local a `inventory_count_records` (últimos 30 dias) para
// ritmo/projeção, através das MESMAS funções puras já usadas em
// KpisIndicadoresPage.tsx (groupDailyProduction/averageDailyProduction/
// forecastBusinessDays) — nenhum cálculo novo, nenhum endpoint novo.

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { supabase } from '../../lib/supabase';
import { resolvePeriodRange } from '../../lib/productivityService';
import { groupDailyProduction, averageDailyProduction, forecastBusinessDays } from '../../lib/kpisIndicadores/executiveKpis';
import type { GlobalStats } from '../../lib/blindAIAgentAlgorithm';

interface DashboardInventoryProgressProps {
  companyId: string | null;
  globais: GlobalStats;
  onOpenKpis: () => void;
}

export function DashboardInventoryProgress({ companyId, globais, onOpenKpis }: DashboardInventoryProgressProps) {
  const [ritmoAtual, setRitmoAtual] = useState<number | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const { from, to } = resolvePeriodRange('30d');
    supabase
      .from('inventory_count_records')
      .select('created_at, skus_contados')
      .eq('company_id', companyId)
      .gte('created_at', from)
      .lte('created_at', to)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const daily = groupDailyProduction(data ?? [], from.slice(0, 10), to.slice(0, 10));
        setRitmoAtual(averageDailyProduction(daily));
      });
    return () => { cancelled = true; };
  }, [companyId]);

  const pendentes = Math.max(0, globais.totalSku - globais.totalDone);
  const previsaoDias = ritmoAtual != null ? forecastBusinessDays(pendentes, ritmoAtual) : null;
  const emAndamento = globais.tabela.filter(b => b.status === 'ANDAMENTO').length;

  return (
    <Panel>
      <PanelSection padding="sm">
        <h3 className="text-title">Progresso do inventário</h3>
      </PanelSection>

      <PanelSection padding="sm">
        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-fg">
          {globais.progresso.toFixed(1)}%
        </p>
        <div className="mt-2 h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, globais.progresso)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-fg-subtle">
          <span>{globais.totalDone.toLocaleString('pt-BR')} contabilizados</span>
          <span>{pendentes.toLocaleString('pt-BR')} pendentes</span>
        </div>
      </PanelSection>

      <PanelSection padding="sm" className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-label">Produtividade</p>
          <p className="mt-0.5 text-sm font-semibold text-fg tabular-nums">
            {ritmoAtual != null ? `${ritmoAtual.toFixed(0)} SKUs/dia` : '—'}
          </p>
        </div>
        <div>
          <p className="text-label">Projeção</p>
          <p className="mt-0.5 text-sm font-semibold text-fg tabular-nums">
            {previsaoDias != null ? `${previsaoDias} dias úteis` : '—'}
          </p>
        </div>
        <div>
          <p className="text-label">Linhas</p>
          <p className="mt-0.5 text-sm font-semibold text-fg tabular-nums">{globais.tabela.length}</p>
        </div>
        <div>
          <p className="text-label">Em andamento</p>
          <p className="mt-0.5 text-sm font-semibold text-fg tabular-nums">{emAndamento}</p>
        </div>
      </PanelSection>

      <PanelSection padding="sm">
        <button
          onClick={onOpenKpis}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong transition-colors py-1"
        >
          Abrir KPIs e indicadores <ArrowRight size={14} />
        </button>
      </PanelSection>
    </Panel>
  );
}
