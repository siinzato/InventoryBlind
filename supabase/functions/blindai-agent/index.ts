// BlindAI — Edge Function. Não é um proxy: recebe o transcript da conversa, deixa o
// Claude decidir quais ferramentas (dados reais desta empresa) precisa consultar antes de
// responder, executa cada uma e devolve o resultado até ele produzir uma resposta final.
//
// Segurança (não alterar sem revisar de novo):
// - ANTHROPIC_API_KEY só existe como secret desta função (Deno.env.get) — nunca em VITE_*.
// - O client Supabase usa a ANON key + o JWT do usuário encaminhado pelo navegador, nunca
//   service_role — toda consulta das tools roda sob a mesma RLS que protege o app hoje.
// - Guarda de autenticação roda antes de qualquer chamada ao Claude: sem sessão válida,
//   401 imediato — nunca segue em frente com company_id indefinido.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { TOOLS, executeTool } from './tools.ts';
import { buildSystemPrompt } from './systemPrompt.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ROUNDTRIPS = 6;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function callClaude(system: string, messages: unknown[]): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2048, system, messages, tools: TOOLS }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[blindai-agent] Anthropic API error:', res.status, errText);
    throw new Error(`anthropic_error_${res.status}`);
  }
  return res.json();
}

async function runAgentLoop(supabase: SupabaseClient, companyId: string, history: ChatMessage[]): Promise<string> {
  const systemPrompt = buildSystemPrompt();
  const messages: any[] = history.map(m => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDTRIPS; round++) {
    const response = await callClaude(systemPrompt, messages);

    if (response.stop_reason === 'refusal') {
      return 'Não posso ajudar com essa solicitação específica. Pergunte sobre a operação, priorização, risco ou divergências.';
    }

    const content = response.content ?? [];
    const toolUseBlocks = content.filter((b: any) => b.type === 'tool_use');
    const textBlocks = content.filter((b: any) => b.type === 'text');

    if (toolUseBlocks.length === 0) {
      const text = textBlocks.map((b: any) => b.text).join('\n').trim();
      return text || 'Não consegui formular uma resposta agora. Tente reformular a pergunta.';
    }

    messages.push({ role: 'assistant', content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block: any) => {
        try {
          const result = await executeTool(supabase, companyId, block.name, block.input ?? {});
          return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
        } catch (err) {
          console.error(`[blindai-agent] Tool "${block.name}" failed:`, err);
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({
              error: true,
              message: 'A consulta a este dado falhou agora. NÃO trate isso como "não existem dados" — informe ao usuário que a consulta falhou e sugira tentar novamente.',
            }),
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  return 'A análise ficou mais longa do que o esperado para concluir agora. Tente uma pergunta mais específica.';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    // Autenticação primeiro, sempre — inclusive antes do check de configuração, para não
    // dar a um chamador não autenticado um jeito de distinguir "servidor mal configurado"
    // de "não autenticado" pela forma da resposta.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    const { data: companyId, error: companyError } = await supabase.rpc('get_my_company_id');
    if (companyError || !companyId) {
      return jsonResponse({ error: 'Não foi possível identificar a empresa deste usuário.' }, 401);
    }

    if (!ANTHROPIC_API_KEY) {
      console.error('[blindai-agent] ANTHROPIC_API_KEY not configured');
      return jsonResponse({ error: 'BlindAI não está configurado nesta instância (chave de API ausente).' }, 500);
    }

    const body = await req.json().catch(() => null);
    const history = (body?.history ?? []) as ChatMessage[];
    if (!Array.isArray(history) || history.length === 0) {
      return jsonResponse({ error: 'Nenhuma mensagem recebida.' }, 400);
    }
    if (history.length > 40 || JSON.stringify(history).length > 40_000) {
      return jsonResponse({ error: 'Conversa muito longa. Inicie uma nova pergunta.' }, 400);
    }

    const reply = await runAgentLoop(supabase, companyId as string, history);
    return jsonResponse({ reply });
  } catch (err) {
    console.error('[blindai-agent] Unhandled error:', err);
    return jsonResponse({ error: 'Não consegui processar sua pergunta agora. Tente novamente em instantes.' }, 500);
  }
});
