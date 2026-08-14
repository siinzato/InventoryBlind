// BlindAI — ferramentas do agente. Cada uma espelha a mesma consulta que os serviços do
// app já fazem (src/lib/*Service.ts) ou importa direto um arquivo puro (sem I/O) já
// existente. Nenhuma fórmula de negócio é reescrita aqui.
//
// Por que não importar os *Service.ts diretamente: eles importam o singleton
// src/lib/supabase.ts, que cria o client com `import.meta.env.VITE_...` — isso não existe
// no runtime Deno e quebraria a função. Os arquivos *Algorithm.ts (sem I/O, sem
// import.meta.env) são seguros e são importados sem modificação abaixo.
//
// Segurança: toda query aqui roda com o client que o index.ts cria (anon key + JWT do
// usuário encaminhado) — a MESMA RLS que protege o app no navegador se aplica a cada
// chamada de tool. Nenhuma tool usa service_role.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { computeGlobalStats, rankLinesByPriority, PRIORITY_LABEL } from '../../../src/lib/blindAIAgentAlgorithm.ts';
import { computeParetoBuckets, groupByDimension, CAUSE_LABEL } from '../../../src/lib/rcaAlgorithm.ts';
import type { RcaDimension } from '../../../src/lib/rcaAlgorithm.ts';
import { estimateHistoricalProductivity } from '../../../src/lib/auditSimulationEngine.ts';
import type { BrandData, RcaRecord } from '../../../src/lib/domainTypes.ts';

type RiskBand = 'critico' | 'alto' | 'medio' | 'baixo';

const round1 = (n: number) => Math.round(n * 10) / 10;

export const TOOLS = [
  {
    name: 'get_dashboard_overview',
    description:
      'Retorna o progresso geral do inventário, acuracidade, divergências e a lista de linhas (marcas) com seus números individuais. Use para status geral, progresso ou visão consolidada.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'rank_lines_by_priority',
    description:
      'Calcula o ranking de prioridade das linhas (marcas) pendentes, com os motivos de cada posição (divergências, acuracidade, SKUs pendentes). Use para qual linha começar, priorizar, ou qual está pior.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_risk_summary',
    description:
      'Retorna o resumo de risco da empresa (contagem por faixa: crítico/alto/médio/baixo) e os produtos com maior risco individual (SKU, produto, localização, motivo). Use para maior risco, produtos/SKUs críticos, ou risco geral.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_risk_trend',
    description: 'Retorna a evolução do risco médio ao longo do tempo. Use quando a pergunta for sobre o risco estar piorando/melhorando ao longo do tempo.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Janela em dias, padrão 30' } },
      required: [],
    },
  },
  {
    name: 'get_confidence_summary',
    description:
      'Retorna o resumo de confiança de saldo (Confidence Based Counting) e os produtos com confiança mais crítica ou contagem em atraso. Use para quais SKUs recontar, confiabilidade do saldo, contagens atrasadas.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_confidence_trend',
    description: 'Retorna a evolução da confiança de saldo média ao longo do tempo.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Janela em dias, padrão 30' } },
      required: [],
    },
  },
  {
    name: 'get_abc_xyz_summary',
    description:
      'Retorna a matriz de classificação ABC/XYZ (contagem e valor movimentado por combinação) e, se um combo for informado, exemplos de SKUs nessa classe. Use para giro, valor movimentado, classificação de produtos.',
    input_schema: {
      type: 'object',
      properties: { combo: { type: 'string', description: 'Uma das 9 combinações: AX, AY, AZ, BX, BY, BZ, CX, CY, CZ' } },
      required: [],
    },
  },
  {
    name: 'get_divergence_records',
    description:
      'Retorna a análise de causa raiz das divergências (RCA): Pareto de causas, agrupamento opcional por dimensão, e uma amostra recente. Use para por que ocorrem divergências, padrões, onde estão concentradas.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Janela em dias, padrão 90' },
        group_by: {
          type: 'string',
          enum: ['sku', 'location', 'operator', 'cause_category', 'supplier', 'period'],
          description: 'Dimensão para agrupar, opcional',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_product',
    description: 'Busca produtos por SKU ou nome (parcial). Use quando o usuário mencionar um produto específico por nome ou código.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_product_detail',
    description:
      'Retorna o perfil completo de um produto: dados básicos, risco, confiança, classificação ABC/XYZ e divergências recentes. Informe product_id (de search_product) ou sku diretamente.',
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'string' }, sku: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_productivity_estimate',
    description:
      'Retorna a produtividade histórica real da equipe (SKUs/hora) e uma estimativa de tempo e pessoas-dia para concluir os SKUs pendentes. Use para prazo, tempo restante, dimensionamento de equipe.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_smart_count_queue',
    description:
      'Retorna a fila de contagem recomendada, priorizada por faixa de risco e agrupada por localização para reduzir deslocamento físico. Use para estratégia de contagem ou por onde começar a contar fisicamente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

async function getDashboardOverview(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase.from('inventory_brands').select('*').eq('company_id', companyId);
  if (error) throw error;
  const stats = computeGlobalStats((data ?? []) as BrandData[]);
  return {
    progresso_pct: round1(stats.progresso),
    acuracidade_pct: round1(stats.acuracidade),
    total_sku: stats.totalSku,
    total_contado: stats.totalDone,
    total_divergencias: stats.totalDiv,
    linhas: stats.tabela.map(l => ({
      linha: l.brand,
      total_sku: l.totalSku,
      contado: l.doneSku,
      pendente: l.totalSku - l.doneSku,
      divergencias: l.divergences,
      progresso_pct: round1(l.progress),
      acuracidade_pct: l.accuracy !== null ? round1(l.accuracy) : null,
      status: l.status,
    })),
  };
}

async function rankLines(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase.from('inventory_brands').select('*').eq('company_id', companyId);
  if (error) throw error;
  const stats = computeGlobalStats((data ?? []) as BrandData[]);
  const ranking = rankLinesByPriority(stats.tabela);
  if (ranking.length === 0) {
    return { ranking: [], observacao: 'Nenhuma linha pendente registrada — todas concluídas ou nenhuma linha cadastrada.' };
  }
  return {
    ranking: ranking.map(r => ({
      linha: r.brand,
      prioridade: r.priority,
      prioridade_label: PRIORITY_LABEL[r.priority],
      skus_pendentes: r.pendingSku,
      divergencias: r.divergences,
      acuracidade_pct: r.accuracy !== null ? round1(r.accuracy) : null,
      motivos: r.reasons,
    })),
  };
}

async function getRiskSummary(supabase: SupabaseClient, companyId: string) {
  const [summaryRes, rowsRes] = await Promise.all([
    supabase.from('risk_company_summary_v').select('*').eq('company_id', companyId).maybeSingle(),
    supabase
      .from('product_risk_scores')
      .select('*, products(name, sku, location)')
      .eq('company_id', companyId)
      .order('risk_score', { ascending: false })
      .limit(10),
  ]);
  if (summaryRes.error) throw summaryRes.error;
  if (rowsRes.error) throw rowsRes.error;

  const summary = summaryRes.data;
  const top = (rowsRes.data ?? []).map((r: any) => ({
    sku: r.products?.sku ?? null,
    produto: r.products?.name ?? null,
    localizacao: r.products?.location ?? null,
    risk_score: r.risk_score,
    risk_level: r.risk_level,
    motivo: r.risk_reason,
  }));

  if (!summary) {
    return { resumo: null, top_criticos: top, observacao: 'Ainda não há risco calculado para nenhum produto desta empresa.' };
  }
  return {
    resumo: {
      risco_medio: Math.round(summary.avg_risk),
      total_avaliado: summary.total_scored,
      critico: summary.critico_count,
      alto: summary.alto_count,
      medio: summary.medio_count,
      baixo: summary.baixo_count,
    },
    top_criticos: top,
  };
}

function averageByDay(rows: { value: number; recorded_at: string }[]): { data: string; media: number }[] {
  const byDay = new Map<string, number[]>();
  for (const row of rows) {
    const day = row.recorded_at.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(row.value);
    byDay.set(day, list);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, values]) => ({ data, media: Math.round(values.reduce((a, b) => a + b, 0) / values.length) }));
}

async function getRiskTrend(supabase: SupabaseClient, companyId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('product_risk_history')
    .select('risk_score, recorded_at')
    .eq('company_id', companyId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  const series = averageByDay((data ?? []).map((r: any) => ({ value: r.risk_score, recorded_at: r.recorded_at })));
  if (series.length === 0) return { serie: [], observacao: `Sem histórico de risco nos últimos ${days} dias.` };
  return { serie: series };
}

async function getConfidenceSummary(supabase: SupabaseClient, companyId: string) {
  const [summaryRes, rowsRes] = await Promise.all([
    supabase.from('cbc_company_summary_v').select('*').eq('company_id', companyId).maybeSingle(),
    supabase
      .from('product_confidence_scores')
      .select('*, products(name, sku)')
      .eq('company_id', companyId)
      .eq('risk_level', 'critico')
      .order('confidence_score', { ascending: true })
      .limit(10),
  ]);
  if (summaryRes.error) throw summaryRes.error;
  if (rowsRes.error) throw rowsRes.error;

  const summary = summaryRes.data;
  const critical = (rowsRes.data ?? []).map((r: any) => ({
    sku: r.products?.sku ?? null,
    produto: r.products?.name ?? null,
    confidence_score: r.confidence_score,
    proxima_contagem: r.next_count_date,
    motivos: r.top_reasons,
  }));

  if (!summary) {
    return { resumo: null, mais_criticos: critical, observacao: 'Ainda não há confiança de saldo calculada para nenhum produto desta empresa.' };
  }
  return {
    resumo: {
      confianca_media: Math.round(summary.avg_confidence),
      total_avaliado: summary.total_scored,
      excelente: summary.excelente_count,
      bom: summary.bom_count,
      medio: summary.medio_count,
      critico: summary.critico_count,
      em_atraso: summary.overdue_count,
      vence_esta_semana: summary.due_this_week_count,
    },
    mais_criticos: critical,
  };
}

async function getConfidenceTrend(supabase: SupabaseClient, companyId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('product_confidence_history')
    .select('confidence_score, recorded_at')
    .eq('company_id', companyId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  const series = averageByDay((data ?? []).map((r: any) => ({ value: r.confidence_score, recorded_at: r.recorded_at })));
  if (series.length === 0) return { serie: [], observacao: `Sem histórico de confiança nos últimos ${days} dias.` };
  return { serie: series };
}

async function getAbcXyzSummary(supabase: SupabaseClient, companyId: string, combo?: string) {
  const { data, error } = await supabase.from('abc_xyz_company_summary_v').select('*').eq('company_id', companyId);
  if (error) throw error;
  const matrix = (data ?? []).map((r: any) => ({ combo: r.abc_xyz_class, quantidade_skus: r.sku_count, valor_movimentado: r.total_value_moved }));

  if (!combo) return { matriz: matrix };

  const { data: examples, error: exError } = await supabase
    .from('product_abc_xyz_classifications')
    .select('*, products(name, sku)')
    .eq('company_id', companyId)
    .eq('abc_xyz_class', combo)
    .order('value_moved', { ascending: false })
    .limit(10);
  if (exError) throw exError;

  return {
    matriz: matrix,
    exemplos_do_combo: (examples ?? []).map((r: any) => ({ sku: r.products?.sku ?? null, produto: r.products?.name ?? null, valor_movimentado: r.value_moved })),
  };
}

async function getDivergenceRecords(supabase: SupabaseClient, companyId: string, days: number, groupBy?: RcaDimension) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('rca_records')
    .select('*')
    .eq('company_id', companyId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false });
  if (error) throw error;

  const records = (data ?? []) as RcaRecord[];
  if (records.length === 0) {
    return { total_registros: 0, observacao: `Nenhuma divergência classificada nos últimos ${days} dias.` };
  }

  const pareto = computeParetoBuckets(records);
  const grouping = groupBy ? groupByDimension(records, groupBy).slice(0, 10) : null;

  return {
    total_registros: records.length,
    pareto_causas: pareto.map(p => ({ causa: CAUSE_LABEL[p.category], quantidade: p.count, pct_do_total: round1(p.pctOfTotal) })),
    agrupamento: grouping?.map(g => ({ chave: g.label, quantidade: g.count })) ?? null,
    amostra_recente: records.slice(0, 5).map(r => ({
      sku: r.sku,
      produto: r.product_name,
      local: r.location,
      causa: CAUSE_LABEL[r.cause_category],
      data: r.occurred_at,
    })),
  };
}

async function searchProduct(supabase: SupabaseClient, companyId: string, query: string) {
  const like = `%${query}%`;
  const [bySku, byName] = await Promise.all([
    supabase.from('products').select('id, sku, name, location, stock_quantity').eq('company_id', companyId).ilike('sku', like).limit(10),
    supabase.from('products').select('id, sku, name, location, stock_quantity').eq('company_id', companyId).ilike('name', like).limit(10),
  ]);
  if (bySku.error) throw bySku.error;
  if (byName.error) throw byName.error;

  const merged = new Map<string, any>();
  for (const p of [...(bySku.data ?? []), ...(byName.data ?? [])]) merged.set(p.id, p);
  const produtos = Array.from(merged.values()).slice(0, 10);
  if (produtos.length === 0) return { produtos: [], observacao: `Nenhum produto encontrado para "${query}".` };
  return { produtos };
}

async function getProductDetail(supabase: SupabaseClient, companyId: string, productId?: string, sku?: string) {
  let resolvedId = productId;
  if (!resolvedId && sku) {
    const { data, error } = await supabase.from('products').select('id').eq('company_id', companyId).eq('sku', sku).maybeSingle();
    if (error) throw error;
    resolvedId = data?.id;
  }
  if (!resolvedId) return { erro: 'Informe product_id (de search_product) ou sku.' };

  const [productRes, riskRes, confidenceRes, abcXyzRes, rcaRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', resolvedId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_risk_scores').select('*').eq('product_id', resolvedId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_confidence_scores').select('*').eq('product_id', resolvedId).eq('company_id', companyId).maybeSingle(),
    supabase.from('product_abc_xyz_classifications').select('*').eq('product_id', resolvedId).eq('company_id', companyId).maybeSingle(),
    supabase.from('rca_records').select('cause_category, occurred_at, divergence_qty').eq('product_id', resolvedId).eq('company_id', companyId).order('occurred_at', { ascending: false }).limit(5),
  ]);
  for (const r of [productRes, riskRes, confidenceRes, abcXyzRes, rcaRes]) if (r.error) throw r.error;

  if (!productRes.data) return { erro: 'Produto não encontrado nesta empresa.' };

  return {
    produto: { sku: productRes.data.sku, nome: productRes.data.name, localizacao: productRes.data.location, estoque_atual: productRes.data.stock_quantity },
    risco: riskRes.data ? { nivel: riskRes.data.risk_level, score: riskRes.data.risk_score, motivo: riskRes.data.risk_reason } : null,
    confianca: confidenceRes.data ? { nivel: confidenceRes.data.risk_level, score: confidenceRes.data.confidence_score, proxima_contagem: confidenceRes.data.next_count_date } : null,
    abc_xyz: abcXyzRes.data ? { combo: abcXyzRes.data.abc_xyz_class, valor_movimentado: abcXyzRes.data.value_moved } : null,
    divergencias_recentes: (rcaRes.data ?? []).map((r: any) => ({ causa: CAUSE_LABEL[r.cause_category as keyof typeof CAUSE_LABEL], data: r.occurred_at, quantidade: r.divergence_qty })),
  };
}

async function getProductivityEstimate(supabase: SupabaseClient, companyId: string) {
  const [statsRes, brandsRes] = await Promise.all([
    supabase.from('user_productivity_stats_v').select('skus_contados, tempo_medio_segundos').eq('company_id', companyId),
    supabase.from('inventory_brands').select('*').eq('company_id', companyId),
  ]);
  if (statsRes.error) throw statsRes.error;
  if (brandsRes.error) throw brandsRes.error;

  const stats = computeGlobalStats((brandsRes.data ?? []) as BrandData[]);
  const pending = stats.totalSku - stats.totalDone;
  const productivityPerHour = estimateHistoricalProductivity(
    (statsRes.data ?? []).map((s: any) => ({ skusContados: s.skus_contados, tempoMedioSegundos: s.tempo_medio_segundos }))
  );

  if (pending <= 0) return { skus_pendentes: 0, observacao: 'Todos os SKUs já foram contados.' };
  if (!productivityPerHour || productivityPerHour <= 0) {
    return {
      skus_pendentes: pending,
      produtividade_historica_skus_por_hora: null,
      observacao: 'Ainda não há histórico de produtividade suficiente da equipe para uma estimativa real.',
    };
  }

  const horasNecessarias = pending / productivityPerHour;
  return {
    skus_pendentes: pending,
    produtividade_historica_skus_por_hora: Math.round(productivityPerHour),
    horas_necessarias_total: round1(horasNecessarias),
    pessoa_dia_necessario: round1(horasNecessarias / 8),
  };
}

const RISK_BAND_ORDER: Record<RiskBand, number> = { critico: 0, alto: 1, medio: 2, baixo: 3 };

async function getSmartCountQueue(supabase: SupabaseClient, companyId: string) {
  const { data, error } = await supabase
    .from('product_risk_scores')
    .select('*, products(name, sku, location)')
    .eq('company_id', companyId)
    .order('risk_score', { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = (data ?? []).map((r: any) => ({
    sku: r.products?.sku ?? '—',
    produto: r.products?.name ?? '—',
    localizacao: r.products?.location ?? null,
    risk_level: r.risk_level as RiskBand,
  }));
  if (rows.length === 0) return { fila: [], observacao: 'Ainda não há risco calculado para montar a fila.' };

  // Mesma heurística de riskService.generateSmartCountQueue (não importada por depender de
  // ProductRiskRow local ao Service): ordena por faixa de risco e, dentro dela, por
  // localização — agrupa deslocamento físico sem ser roteamento real.
  const fila = [...rows]
    .sort((a, b) => {
      const bandDiff = RISK_BAND_ORDER[a.risk_level] - RISK_BAND_ORDER[b.risk_level];
      if (bandDiff !== 0) return bandDiff;
      return (a.localizacao ?? '').localeCompare(b.localizacao ?? '');
    })
    .slice(0, 20);

  return { fila };
}

export async function executeTool(supabase: SupabaseClient, companyId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_dashboard_overview':
      return getDashboardOverview(supabase, companyId);
    case 'rank_lines_by_priority':
      return rankLines(supabase, companyId);
    case 'get_risk_summary':
      return getRiskSummary(supabase, companyId);
    case 'get_risk_trend':
      return getRiskTrend(supabase, companyId, (input.days as number) || 30);
    case 'get_confidence_summary':
      return getConfidenceSummary(supabase, companyId);
    case 'get_confidence_trend':
      return getConfidenceTrend(supabase, companyId, (input.days as number) || 30);
    case 'get_abc_xyz_summary':
      return getAbcXyzSummary(supabase, companyId, input.combo as string | undefined);
    case 'get_divergence_records':
      return getDivergenceRecords(supabase, companyId, (input.days as number) || 90, input.group_by as RcaDimension | undefined);
    case 'search_product':
      return searchProduct(supabase, companyId, String(input.query ?? ''));
    case 'get_product_detail':
      return getProductDetail(supabase, companyId, input.product_id as string | undefined, input.sku as string | undefined);
    case 'get_productivity_estimate':
      return getProductivityEstimate(supabase, companyId);
    case 'get_smart_count_queue':
      return getSmartCountQueue(supabase, companyId);
    default:
      return { erro: `Ferramenta desconhecida: ${name}` };
  }
}
