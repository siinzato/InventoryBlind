// BlindAI — camada pura compartilhada entre o cliente e o agente (Edge Function).
// Mesmo espírito de riskAlgorithm.ts/rcaAlgorithm.ts: sem I/O.
//
// Duas responsabilidades bem separadas:
// 1. Fast-path client-side: um punhado de leituras factuais sem nenhuma interpretação
//    (progresso/acuracidade/melhores linhas/produtos mais vendidos) — qualquer frase para
//    elas seria só reformatar o mesmo número, então respondem na hora, sem custo de LLM.
//    Qualquer coisa que exija raciocínio (priorização, causa raiz, estratégia, follow-ups,
//    perguntas gerais) vai para o agente real — ver supabase/functions/blindai-agent/.
// 2. rankLinesByPriority: o motor de priorização de linha. Não é mais chamado direto pelo
//    cliente — é importado, sem modificação, dentro da Edge Function como a implementação
//    da tool `rank_lines_by_priority` que o Claude aciona. Fica aqui (não duplicado lá)
//    porque é puro: nenhuma dependência de ambiente impede reuso em Deno.

import type { BlindAILineRanking, BlindAIPriority, BrandData } from './domainTypes';

export type BlindAIIntent = 'progress_status' | 'accuracy_status' | 'best_lines' | 'top_products' | 'llm';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const has = (q: string, ...needles: string[]) => needles.some(n => q.includes(n));

/**
 * Só reconhece os 4 pedidos de leitura pura — qualquer ambiguidade (causa, comparação,
 * estratégia, "por que") cai em 'llm' de propósito, porque essas exigem raciocínio real.
 */
export function detectIntent(question: string): BlindAIIntent {
  const q = normalize(question).trim();
  const causal = has(q, 'por que', 'porque', 'caiu', 'aumentar', 'melhorar', 'subir', 'piorou');

  if (has(q, 'progresso', 'andamento') && !causal) return 'progress_status';
  if (has(q, 'acuracidade', 'precisao', 'acuracia') && !causal) return 'accuracy_status';
  if (has(q, 'melhor', 'melhores') && has(q, 'linha') && !has(q, 'vend', 'produto')) return 'best_lines';
  if (has(q, 'mais vendido', 'top produtos', 'produtos mais vendidos', 'top vendas')) return 'top_products';
  return 'llm';
}

// ── Estatísticas globais (linhas / inventory_brands) ────────────────────────────────
// Extraído do useMemo que já existia em App.tsx para que o Dashboard e a tool
// `get_dashboard_overview` da Edge Function calculem exatamente a mesma fórmula.

/**
 * Acuracidade final consolidada de uma linha/marca — fonte única usada pelo
 * Dashboard (computeGlobalStats), pela listagem de resultados e pelo resumo de
 * fechamento (closingReportService.ts). Nunca copiar de um registro de contagem
 * individual: o resultado da linha é sempre derivado dos totais consolidados.
 */
export function computeAccuracy(doneSku: number, divergences: number): number | null {
  if (doneSku <= 0) return null;
  return Math.min(100, Math.max(0, ((doneSku - divergences) / doneSku) * 100));
}

export interface GlobalStatsRow {
  id: string;
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  status: string;
}

export interface GlobalStats {
  tabela: GlobalStatsRow[];
  totalSku: number;
  totalDone: number;
  totalDiv: number;
  progresso: number;
  acuracidade: number;
  melhores: { nome: string; valor: string }[];
  piores: { nome: string; valor: string }[];
}

export function computeGlobalStats(brands: BrandData[]): GlobalStats {
  let totalSkuGeral = 0;
  let totalDoneGeral = 0;
  let totalDivGeral = 0;

  const dataProcessada: GlobalStatsRow[] = brands.map(b => {
    totalSkuGeral += b.total_sku;
    totalDoneGeral += b.done_sku;
    totalDivGeral += b.divergences;

    const progress = b.total_sku > 0 ? Math.min(100, (b.done_sku / b.total_sku) * 100) : 0;
    const accuracy = computeAccuracy(b.done_sku, b.divergences);

    return {
      id: b.id,
      brand: b.brand,
      totalSku: b.total_sku,
      doneSku: b.done_sku,
      divergences: b.divergences,
      progress,
      accuracy,
      status: progress >= 100 ? 'CONCLUÍDO' : 'ANDAMENTO',
    };
  });

  const progressoGeral = totalSkuGeral > 0 ? (totalDoneGeral / totalSkuGeral) * 100 : 0;
  const acuracidadeGeral = computeAccuracy(totalDoneGeral, totalDivGeral) ?? 0;

  const concluidas = dataProcessada.filter(b => b.status === 'CONCLUÍDO' && b.accuracy !== null);
  const concluidasOrdenadas = [...concluidas].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));

  const melhores = concluidasOrdenadas.slice(0, 10).map(b => ({ nome: b.brand, valor: `${b.accuracy?.toFixed(1)}%` }));
  const piores = [...concluidasOrdenadas].reverse().map(b => ({ nome: b.brand, valor: `${b.accuracy?.toFixed(2)}%` }));

  return {
    tabela: dataProcessada,
    totalSku: totalSkuGeral,
    totalDone: totalDoneGeral,
    totalDiv: totalDivGeral,
    progresso: progressoGeral,
    acuracidade: acuracidadeGeral,
    melhores,
    piores,
  };
}

// ── Priorização de linhas — usada pela tool `rank_lines_by_priority` ────────────────

export interface LineData {
  brand: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
  accuracy: number | null;
  status: string;
}

export const PRIORITY_LABEL: Record<BlindAIPriority, string> = {
  P1: 'crítica',
  P2: 'alta',
  P3: 'moderada',
  P4: 'baixa',
};

/**
 * Prioriza linhas pendentes combinando os três sinais que realmente existem por linha:
 * taxa de divergência (peso maior — é o sinal mais direto de problema real), o quanto a
 * acuracidade já apurada está abaixo de 100%, e o volume ainda pendente. Linhas sem
 * nenhum SKU contado ainda não têm sinal de divergência/acuracidade, então pontuam só
 * pelo volume pendente — nunca ultrapassam uma linha com divergência real comprovada,
 * mesmo que sejam maiores. Não usa risco/ABC-XYZ por SKU porque inventory_brands não tem
 * vínculo de schema com products — cruzar isso seria inventar uma relação que não existe.
 */
export function rankLinesByPriority(lines: LineData[]): BlindAILineRanking[] {
  const pending = lines.filter(l => l.status !== 'CONCLUÍDO' && l.totalSku > 0);

  const scored = pending.map(l => {
    const pendingSku = Math.max(0, l.totalSku - l.doneSku);
    const pendingRatio = l.totalSku > 0 ? pendingSku / l.totalSku : 0;
    const divergenceRate = l.doneSku > 0 ? Math.min(1, l.divergences / l.doneSku) : 0;
    const accuracyGap = l.accuracy !== null ? Math.max(0, (100 - l.accuracy) / 100) : 0;

    const score = divergenceRate * 0.45 + accuracyGap * 0.35 + pendingRatio * 0.2;

    const reasons: string[] = [];
    if (l.doneSku > 0) {
      reasons.push(
        `${l.divergences} divergência${l.divergences === 1 ? '' : 's'} em ${l.doneSku} SKU${l.doneSku === 1 ? '' : 's'} contado${l.doneSku === 1 ? '' : 's'} (taxa de ${(divergenceRate * 100).toFixed(0)}%)`
      );
      if (l.accuracy !== null) reasons.push(`Acuracidade apurada: ${l.accuracy.toFixed(1)}%`);
    } else {
      reasons.push('Nenhum SKU contado ainda — sem sinal de divergência disponível');
    }
    reasons.push(`${pendingSku} de ${l.totalSku} SKUs ainda não contados`);

    return { brand: l.brand, score, pendingSku, divergences: l.divergences, accuracy: l.accuracy, reasons };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.map((s, idx) => {
    const priority: BlindAIPriority =
      idx === 0 && s.score > 0 ? 'P1' : s.score >= 0.35 ? 'P2' : s.score >= 0.15 ? 'P3' : 'P4';
    return { ...s, priority };
  });
}

// ── Sugestões contextuais (chips do chat) ───────────────────────────────────────────

interface SuggestionInputs {
  hasLines: boolean;
  hasPendingLines: boolean;
  hasCriticalRisk: boolean;
  hasDivergenceConcentration: boolean;
  hasRcaPattern: boolean;
  hasCbcOverdue: boolean;
}

/** Sugestões só entram se o dado por trás delas existir de verdade — nunca oferece uma
 *  pergunta cuja resposta seria "não tenho dados para isso". */
export function generateContextualSuggestions(input: SuggestionInputs): string[] {
  const suggestions: string[] = [];
  if (input.hasCriticalRisk) suggestions.push('Qual é o maior risco do inventário agora?');
  if (input.hasPendingLines) suggestions.push('Qual linha devo priorizar hoje?');
  if (input.hasDivergenceConcentration) suggestions.push('Onde estão concentradas minhas divergências?');
  if (input.hasRcaPattern) suggestions.push('Existe algum padrão nas minhas divergências?');
  if (input.hasCbcOverdue) suggestions.push('Quais SKUs devo recontar primeiro?');
  if (input.hasPendingLines) suggestions.push('Qual estratégia de contagem você recomenda?');
  if (input.hasLines) suggestions.push('O que merece minha atenção agora?');
  return suggestions.slice(0, 5);
}
