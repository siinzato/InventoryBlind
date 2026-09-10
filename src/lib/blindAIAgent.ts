// BlindAI — orquestrador do lado do cliente. Só faz duas coisas:
// 1. Fast-path: responde na hora, sem custo de LLM, as 4 leituras puras (progresso,
//    acuracidade, melhores linhas, produtos mais vendidos) — nenhuma delas exige
//    interpretação, então um template aqui não é o problema que motivou a reescrita.
// 2. Para qualquer outra pergunta, encaminha para o agente real (Claude + tool-calling
//    nos serviços existentes), rodando na Edge Function `blindai-agent`. Toda a
//    inteligência de priorização/causa-raiz/estratégia mora lá agora, não aqui.

import { supabase } from './supabase';
import { detectIntent, generateContextualSuggestions, type GlobalStats } from './blindAIAgentAlgorithm';
import type { BlindAISituation, TopVenda } from './supabase';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function answerFastPath(intent: 'progress_status' | 'accuracy_status' | 'best_lines' | 'top_products', globais: GlobalStats, topVendas: TopVenda[]): string {
  switch (intent) {
    case 'progress_status': {
      const pendentes = globais.totalSku - globais.totalDone;
      return (
        `Progresso atual: ${globais.progresso.toFixed(1)}% concluído.\n\n` +
        `- SKUs processados: ${globais.totalDone.toLocaleString('pt-BR')} de ${globais.totalSku.toLocaleString('pt-BR')}\n` +
        `- Pendentes: ${pendentes.toLocaleString('pt-BR')} SKUs\n` +
        `- Linhas em andamento: ${globais.tabela.filter(l => l.status === 'ANDAMENTO').length}\n` +
        `- Linhas concluídas: ${globais.tabela.filter(l => l.status === 'CONCLUÍDO').length}`
      );
    }
    case 'accuracy_status': {
      const taxaDivergencia = globais.totalDone > 0 ? (globais.totalDiv / globais.totalDone) * 100 : 0;
      const status = globais.acuracidade >= 80 ? 'Boa' : globais.acuracidade >= 50 ? 'Mediana, requer atenção' : 'Crítica, ação imediata recomendada';
      return (
        `Acuracidade geral: ${globais.acuracidade.toFixed(1)}%.\n\n` +
        `- Total de divergências: ${globais.totalDiv}\n` +
        `- Taxa de divergência: ${taxaDivergencia.toFixed(2)}%\n` +
        `- Status: ${status}`
      );
    }
    case 'best_lines': {
      const completed = globais.tabela.filter(l => l.status === 'CONCLUÍDO' && l.accuracy !== null);
      if (completed.length === 0) {
        return 'Não tenho dados suficientes para recomendar isso com segurança. Falta: linhas concluídas com acuracidade apurada.';
      }
      const top5 = [...completed].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 5);
      return `Top ${top5.length} linhas por acuracidade:\n\n${top5.map((l, i) => `${i + 1}. ${l.brand}: ${l.accuracy?.toFixed(1)}%`).join('\n')}`;
    }
    case 'top_products': {
      if (topVendas.length === 0) {
        return 'Não tenho dados suficientes para recomendar isso com segurança. Falta: lista de produtos mais vendidos cadastrada no Dashboard.';
      }
      const top5 = topVendas.slice(0, 5);
      return `Top ${top5.length} produtos mais vendidos:\n\n${top5.map((v, i) => `${i + 1}. ${v.produto} — SKU ${v.sku}, ${v.vendas} vendas`).join('\n')}`;
    }
  }
}

export interface BlindAIFastPathDeps {
  globais: GlobalStats;
  topVendas: TopVenda[];
}

/** Tenta responder sem custo de LLM. Retorna null se a pergunta exige raciocínio real —
 *  quem chama deve então encaminhar para askBlindAIAgent. */
export function tryFastPath(question: string, deps: BlindAIFastPathDeps): string | null {
  const intent = detectIntent(question);
  if (intent === 'llm') return null;
  return answerFastPath(intent, deps.globais, deps.topVendas);
}

/**
 * Encaminha para o agente real: Claude com tool-calling nos serviços de Risco, CBC,
 * ABC/XYZ, RCA e produtividade (ver supabase/functions/blindai-agent/). `history` é o
 * transcript completo já no formato da Messages API do Claude ({role, content}[]) — essa
 * é a própria memória de conversa, não precisa de um objeto de contexto à parte.
 */
export async function askBlindAIAgent(history: ChatMessage[], companyId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('blindai-agent', {
    body: { history, companyId },
  });

  if (error) {
    console.error('[BlindAI] Edge function error:', error);
    throw new Error('Não consegui consultar o agente agora. Tente novamente em instantes.');
  }
  if (!data?.reply) {
    throw new Error('O agente não retornou uma resposta. Tente novamente.');
  }
  return data.reply as string;
}

interface SuggestionDeps {
  situations: BlindAISituation[];
  globais: GlobalStats;
}

export function getContextualSuggestions(deps: SuggestionDeps): string[] {
  const hasPendingLines = deps.globais.tabela.some(l => l.status !== 'CONCLUÍDO' && l.totalSku > 0);
  const hasDivergenceConcentration = deps.globais.tabela.some(l => l.divergences > 0) || deps.situations.some(s => s.module === 'rca');
  return generateContextualSuggestions({
    hasLines: deps.globais.tabela.length > 0,
    hasPendingLines,
    hasCriticalRisk: deps.situations.some(s => s.module === 'risk'),
    hasDivergenceConcentration,
    hasRcaPattern: deps.situations.some(s => s.module === 'rca'),
    hasCbcOverdue: deps.situations.some(s => s.module === 'cbc'),
  });
}
