// Simulação de Inventário — camada de I/O. Busca a população real (SKUs da linha
// selecionada) e a produtividade histórica real (view user_productivity_stats_v, já usada
// por productivityService.ts) para pré-preencher a simulação; nada aqui é mockado — quando
// não há histórico suficiente, o painel simplesmente pede o número manualmente.

import { supabase } from './supabase';
import { getTeamProductivity } from './productivityService';
import { estimateHistoricalProductivityDetailed, type HistoricalProductivityResult } from './auditSimulationEngine';

export interface AuditableBrand {
  id: string;
  brand: string;
  total_sku: number;
}

export async function listAuditableBrands(companyId: string): Promise<AuditableBrand[]> {
  const { data, error } = await supabase
    .from('inventory_brands')
    .select('id, brand, total_sku')
    .eq('company_id', companyId)
    .order('brand');
  if (error) { console.error('[Audit] Error loading brands:', error); return []; }
  return (data ?? []) as AuditableBrand[];
}

/** Produtividade histórica média da empresa (SKUs/hora), ponderada pelo volume contado de
 *  cada operador, junto com o total de horas amostradas (usado só para o Confiança da
 *  previsão). Retorna null quando ainda não há contagens com duração registrada. */
export async function getHistoricalProductivity(companyId: string): Promise<HistoricalProductivityResult | null> {
  const stats = await getTeamProductivity(companyId);
  return estimateHistoricalProductivityDetailed(stats.map(s => ({ skusContados: s.skus_contados, tempoMedioSegundos: s.tempo_medio_segundos })));
}

export interface BrandAuditHistory {
  /** Nº de contagens iniciais (count_number = 1) já registradas para esta linha — dado real de
   *  inventory_count_records, nunca inventado. */
  previousAudits: number;
  /** % das contagens iniciais dessa linha que precisaram de recontagem (count_number > 1). */
  recountRatePercent: number | null;
}

/** Histórico real de auditorias de uma linha específica — usado para as informações
 *  auxiliares da Simulação (qtd. de inventários anteriores, estimativa de recontagem).
 *  Retorna null quando a linha ainda não tem nenhuma contagem registrada. */
export async function getBrandAuditHistory(companyId: string, brandId: string): Promise<BrandAuditHistory | null> {
  const { data, error } = await supabase
    .from('inventory_count_records')
    .select('count_number')
    .eq('company_id', companyId)
    .eq('brand_id', brandId);
  if (error || !data || data.length === 0) return null;

  const previousAudits = data.filter(r => r.count_number === 1).length;
  if (previousAudits === 0) return null;
  const recounts = data.filter(r => r.count_number > 1).length;

  return { previousAudits, recountRatePercent: (recounts / previousAudits) * 100 };
}
