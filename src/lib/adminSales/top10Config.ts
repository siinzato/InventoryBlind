// Ponte entre o Top 10 de Vendas (painel administrativo) e a Curva ABC — o único arquivo que lê
// das duas áreas. Nunca escreve em abc_curve_* nem em products; só lê análises publicadas e
// snapshots já calculados para alimentar o ranking automático. salesService.ts continua
// exclusivamente sales_*; a config do Top 10 mora aqui por depender da Curva ABC.

import { supabase } from '../supabase';
import { listAnalyses, listSkuSnapshots, matchProductIds, type AbcCurveAnalysis } from '../abcCurve/abcCurveService';
import {
  resolveAutomaticTopTen, type AbcRankingMetric, type AbcSnapshotInput,
  type AutomaticTopTenResult, type TopTenMetric, type TopTenPeriodPreset,
} from './salesTopTen';

export type Top10SourceMode = 'manual' | 'automatic_abc';

export interface AdminTopTenConfig {
  companyId: string;
  enabled: boolean;
  sourceMode: Top10SourceMode;
  manualMetric: TopTenMetric;
  manualPeriodPreset: TopTenPeriodPreset;
  manualPeriodFrom: string | null;
  manualPeriodTo: string | null;
  abcAnalysisId: string | null;
  rankingMetric: AbcRankingMetric | null;
  updatedAt: string;
}

interface ConfigRow {
  company_id: string; enabled: boolean; source_mode: Top10SourceMode;
  manual_metric: TopTenMetric; manual_period_preset: TopTenPeriodPreset;
  manual_period_from: string | null; manual_period_to: string | null;
  abc_analysis_id: string | null; ranking_metric: AbcRankingMetric | null; updated_at: string;
}

function configFromRow(row: ConfigRow): AdminTopTenConfig {
  return {
    companyId: row.company_id, enabled: row.enabled, sourceMode: row.source_mode,
    manualMetric: row.manual_metric, manualPeriodPreset: row.manual_period_preset,
    manualPeriodFrom: row.manual_period_from, manualPeriodTo: row.manual_period_to,
    abcAnalysisId: row.abc_analysis_id, rankingMetric: row.ranking_metric, updatedAt: row.updated_at,
  };
}

// `null` = nenhuma configuração salva ainda; a tela deve se comportar como hoje (modo manual,
// métrica/período padrão), sem forçar o operador a configurar nada.
export async function getTop10Config(companyId: string): Promise<AdminTopTenConfig | null> {
  const { data, error } = await supabase
    .from('admin_top10_config').select('*').eq('company_id', companyId).maybeSingle();
  if (error) throw error;
  return data ? configFromRow(data as ConfigRow) : null;
}

export interface Top10ConfigInput {
  enabled: boolean;
  sourceMode: Top10SourceMode;
  manualMetric: TopTenMetric;
  manualPeriodPreset: TopTenPeriodPreset;
  manualPeriodFrom: string | null;
  manualPeriodTo: string | null;
  abcAnalysisId: string | null;
  rankingMetric: AbcRankingMetric | null;
}

export async function upsertTop10Config(companyId: string, input: Top10ConfigInput): Promise<AdminTopTenConfig> {
  const { data, error } = await supabase
    .from('admin_top10_config')
    .upsert({
      company_id: companyId, enabled: input.enabled, source_mode: input.sourceMode,
      manual_metric: input.manualMetric, manual_period_preset: input.manualPeriodPreset,
      manual_period_from: input.manualPeriodFrom, manual_period_to: input.manualPeriodTo,
      abc_analysis_id: input.abcAnalysisId, ranking_metric: input.rankingMetric,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' })
    .select().single();
  if (error) throw error;
  return configFromRow(data as ConfigRow);
}

// Análises elegíveis para alimentar o modo automático — reaproveita listAnalyses, que já só
// devolve análises com status 'published' (concluídas e válidas) da própria empresa.
export async function listEligibleAbcAnalyses(companyId: string): Promise<AbcCurveAnalysis[]> {
  return listAnalyses(companyId);
}

// Regra única do ranking automático — usada tanto pela prévia da configuração quanto pelo bloco
// exibido no painel (evita divergência). Nunca recalcula faturamento/quantidade/lucro bruto: só
// lê o snapshot já persistido e resolve a correspondência de catálogo (productId já vinculado,
// senão SKU exato — nunca por nome), sempre restrita à mesma empresa.
export async function getAutomaticTopTen(
  companyId: string,
  analysisId: string,
  metric: AbcRankingMetric,
  limit = 10
): Promise<AutomaticTopTenResult> {
  const snapshots = await listSkuSnapshots(companyId, analysisId);
  const skusNeedingFallback = Array.from(new Set(
    snapshots.filter(s => !s.product_id).map(s => s.sku)
  ));
  const fallbackMap = skusNeedingFallback.length > 0
    ? await matchProductIds(companyId, skusNeedingFallback)
    : new Map<string, string>();
  const normalizedFallback = new Map(Array.from(fallbackMap.entries()).map(([sku, id]) => [sku.trim().toUpperCase(), id]));

  const inputs: AbcSnapshotInput[] = snapshots.map(s => ({
    sku: s.sku, productId: s.product_id, productName: s.product_name,
    revenue: s.revenue, quantity: s.quantity, grossProfit: s.gross_profit,
  }));

  return resolveAutomaticTopTen(inputs, metric, normalizedFallback, limit);
}
