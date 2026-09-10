// Produtividade — leitura de indicadores (view user_productivity_stats_v, sem tabela de cache)

import { supabase, UserProductivityStats } from './supabase';

export async function getMyProductivity(userId: string): Promise<UserProductivityStats | null> {
  const { data, error } = await supabase
    .from('user_productivity_stats_v')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error loading productivity stats:', error);
    return null;
  }
  return data as UserProductivityStats | null;
}

export async function getTeamProductivity(companyId: string): Promise<UserProductivityStats[]> {
  const { data, error } = await supabase
    .from('user_productivity_stats_v')
    .select('*')
    .eq('company_id', companyId);

  if (error) {
    console.error('Error loading team productivity stats:', error);
    return [];
  }
  return (data ?? []) as UserProductivityStats[];
}

export type ReportPeriod = 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

export function resolvePeriodRange(period: ReportPeriod, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();

  switch (period) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case '7d': {
      const from = new Date(now); from.setDate(from.getDate() - 7);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case '30d': {
      const from = new Date(now); from.setDate(from.getDate() - 30);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case 'custom':
      return { from: customFrom ?? startOfDay(now), to: customTo ?? endOfDay(now) };
  }
}

export interface PeriodProductivity {
  skus_contados: number;
  contagens: number;
  recontagens: number;
  divergencias_encontradas: number;
  divergencias_reais: number;
  acuracidade_media: number | null;
}

/** Period-scoped stats for reports — queries inventory_count_records directly (the live view is
 *  all-time by design, see plan Context §6), filtered by created_at between from/to. */
export async function getProductivityForPeriod(userId: string, from: string, to: string): Promise<PeriodProductivity> {
  const { data, error } = await supabase
    .from('inventory_count_records')
    .select('skus_contados, count_number, divergencias_encontradas, divergencias_reais, accuracy_final')
    .eq('created_by', userId)
    .gte('created_at', from)
    .lte('created_at', to);

  if (error || !data) {
    console.error('Error loading period productivity:', error);
    return { skus_contados: 0, contagens: 0, recontagens: 0, divergencias_encontradas: 0, divergencias_reais: 0, acuracidade_media: null };
  }

  const accValues = data.map(r => r.accuracy_final).filter((v): v is number => v !== null);

  return {
    skus_contados: data.reduce((sum, r) => sum + (r.skus_contados ?? 0), 0),
    contagens: data.length,
    recontagens: data.filter(r => r.count_number > 1).length,
    divergencias_encontradas: data.reduce((sum, r) => sum + (r.divergencias_encontradas ?? 0), 0),
    divergencias_reais: data.reduce((sum, r) => sum + (r.divergencias_reais ?? 0), 0),
    acuracidade_media: accValues.length > 0 ? accValues.reduce((a, b) => a + b, 0) / accValues.length : null,
  };
}

export type CompetencyKey =
  | 'inventario_cego' | 'recontagem' | 'organizacao_estoque' | 'full_manager'
  | 'etiquetagem' | 'conferencia' | 'acuracidade' | 'produtividade';

export type CompetencyLevel = 'Iniciante' | 'Intermediário' | 'Avançado' | 'Especialista';

const levelFromThresholds = (value: number, thresholds: [number, number, number]): CompetencyLevel => {
  if (value >= thresholds[2]) return 'Especialista';
  if (value >= thresholds[1]) return 'Avançado';
  if (value >= thresholds[0]) return 'Intermediário';
  return 'Iniciante';
};

/** Simple threshold-based competency levels — same source data as achievements, no new table. */
export function computeCompetencyLevels(stats: UserProductivityStats): Record<CompetencyKey, CompetencyLevel> {
  return {
    inventario_cego: levelFromThresholds(stats.contagens, [5, 20, 60]),
    recontagem: levelFromThresholds(stats.recontagens, [3, 15, 50]),
    organizacao_estoque: levelFromThresholds(stats.itens_separados, [50, 300, 1000]),
    full_manager: levelFromThresholds(stats.fulls_realizados, [3, 15, 50]),
    etiquetagem: levelFromThresholds(stats.etiquetas_geradas, [100, 500, 2000]),
    conferencia: levelFromThresholds(stats.divergencias_reais > 0 ? stats.recontagens : 0, [3, 15, 50]),
    acuracidade: levelFromThresholds(stats.acuracidade_media ?? 0, [80, 92, 97]),
    produtividade: levelFromThresholds(stats.skus_contados, [500, 2000, 5000]),
  };
}

export function rankTeam(stats: UserProductivityStats[]): UserProductivityStats[] {
  return [...stats].sort((a, b) => {
    const accA = a.acuracidade_media ?? 0;
    const accB = b.acuracidade_media ?? 0;
    if (accB !== accA) return accB - accA;
    return b.skus_contados - a.skus_contados;
  });
}

/** Auto-generated executive-summary text, same threshold-based-sentence style as countManagementUtils.ts's generateCountInsight(). */
export function generateExecutiveSummary(stats: UserProductivityStats): string {
  const parts: string[] = [];

  if (stats.contagens === 0) {
    return 'Nenhuma contagem registrada ainda neste período.';
  }

  if (stats.acuracidade_media !== null) {
    if (stats.acuracidade_media >= 97) {
      parts.push(`✅ Excelente acuracidade média: ${stats.acuracidade_media.toFixed(1)}%.`);
    } else if (stats.acuracidade_media >= 90) {
      parts.push(`📊 Boa acuracidade média: ${stats.acuracidade_media.toFixed(1)}%.`);
    } else {
      parts.push(`⚠️ Acuracidade média abaixo do esperado: ${stats.acuracidade_media.toFixed(1)}% — pode indicar necessidade de suporte ou treinamento.`);
    }
  }

  parts.push(`📦 ${stats.skus_contados} SKUs contados em ${stats.contagens} contagens (${stats.recontagens} recontagens).`);

  if (stats.fulls_realizados > 0) {
    parts.push(`⚡ ${stats.fulls_realizados} operações Full concluídas, ${stats.itens_separados} itens separados.`);
  }
  if (stats.etiquetas_geradas > 0) {
    parts.push(`🏷️ ${stats.etiquetas_geradas} etiquetas geradas.`);
  }

  return parts.join(' ');
}
