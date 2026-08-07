// Simulação de Inventário — camada de I/O. Busca a população real (SKUs da linha
// selecionada) e a produtividade histórica real (view user_productivity_stats_v, já usada
// por productivityService.ts) para pré-preencher a simulação; nada aqui é mockado — quando
// não há histórico suficiente, o painel simplesmente pede o número manualmente.

import { supabase } from './supabase';
import { getTeamProductivity } from './productivityService';
import { estimateHistoricalProductivity } from './auditSimulationEngine';

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
 *  cada operador. Retorna null quando ainda não há contagens com duração registrada. */
export async function getHistoricalProductivity(companyId: string): Promise<number | null> {
  const stats = await getTeamProductivity(companyId);
  return estimateHistoricalProductivity(stats.map(s => ({ skusContados: s.skus_contados, tempoMedioSegundos: s.tempo_medio_segundos })));
}
