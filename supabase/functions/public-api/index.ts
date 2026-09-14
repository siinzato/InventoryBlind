// Public API — endpoint externo autenticado por chave de API (Configurações
// Avançadas > API). Endpoint real desta primeira versão: saldo de um produto
// pelo SKU.
//
//   GET /public-api/stock?sku=<sku>
//   Header: Authorization: Bearer <chave>
//
// A chave nunca é comparada em texto puro: o servidor calcula SHA-256 do
// valor apresentado e compara contra api_keys.key_hash (migration 063). O
// company_id da resposta vem SEMPRE da linha da chave encontrada — nunca de
// um parâmetro do chamador, então uma chave de uma empresa jamais devolve
// dado de outra.
//
// Chave revogada (403) e chave expirada (401, migration 067) são recusadas
// antes de qualquer leitura de produto.
//
// Erros seguem sempre o mesmo formato: { "error": <mensagem>, "code": <slug> }.
// Nunca stack trace, mensagem de banco ou qualquer valor de segredo.
//
// Deploy: npx supabase functions deploy public-api --no-verify-jwt
// (o chamador externo não tem — e nunca terá — um JWT do Supabase; a
// autenticação é 100% pela chave de API.)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Teto por chave de API, em janela fixa. 60 req/min é folgado para consulta de saldo
 *  (o caso de uso é um ERP perguntando por SKU) e ainda assim impede varredura de
 *  catálogo em rajada. O contador vive no banco — nunca no cliente. */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Erro padronizado: mensagem legível + código estável para o cliente tratar
 *  em código. Nunca inclui stack trace, detalhe de banco ou qualquer segredo —
 *  o motivo técnico fica só no log do servidor. */
function fail(status: number, code: string, message: string): Response {
  return json({ error: message, code }, status);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', 'Método não suportado.');

  const url = new URL(req.url);
  if (!url.pathname.endsWith('/stock')) {
    return fail(404, 'not_found', 'Rota não encontrada. Use GET /public-api/stock?sku=...');
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!presented) {
    return fail(401, 'missing_key', 'Chave de API ausente. Envie "Authorization: Bearer <chave>".');
  }

  const sku = url.searchParams.get('sku')?.trim();
  if (!sku) {
    return fail(400, 'missing_parameter', 'Informe o parâmetro "sku".');
  }

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const keyHash = await sha256Hex(presented);

    const { data: keyRow, error: keyError } = await admin
      .from('api_keys')
      .select('id, company_id, revoked_at, expires_at')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyError) {
      console.error('[public-api] Failed to look up API key:', keyError.message);
      return fail(500, 'internal_error', 'Erro ao validar a chave de API.');
    }
    // Chave desconhecida e chave revogada devolvem códigos diferentes de
    // propósito: quem revogou a chave precisa distinguir "errei o valor" de
    // "essa chave foi desligada". Nenhuma das duas volta a funcionar aqui.
    if (!keyRow) {
      return fail(401, 'invalid_key', 'Chave de API inválida.');
    }
    if (keyRow.revoked_at) {
      return fail(403, 'key_revoked', 'Esta chave de API foi revogada.');
    }
    if (keyRow.expires_at != null && new Date(keyRow.expires_at).getTime() <= Date.now()) {
      return fail(401, 'key_expired', 'Esta chave de API expirou.');
    }

    // Teto de requisições por CHAVE, contado no banco (nunca no cliente): reserva atômica
    // via api_key_consume_rate_limit, o mesmo padrão de nfe_claim_key_fetch. Só entra
    // DEPOIS de a chave ser reconhecida, válida e não revogada — uma chave inválida não
    // consome a cota de ninguém, e a resposta 429 não revela nada sobre outras chaves ou
    // workspaces. Falha do RPC nega a requisição: teto que falha aberto não é teto.
    const { data: withinLimit, error: limitError } = await admin.rpc('api_key_consume_rate_limit', {
      p_api_key_id: keyRow.id,
      p_limit: RATE_LIMIT_MAX_REQUESTS,
      p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    if (limitError) {
      console.error('[public-api] Rate limit check failed:', limitError.message);
      return fail(503, 'rate_limit_unavailable', 'Serviço indisponível no momento. Tente novamente.');
    }
    if (withinLimit !== true) {
      return new Response(
        JSON.stringify({ error: 'Limite de requisições excedido. Tente novamente em instantes.', code: 'rate_limited' }),
        {
          status: 429,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json',
            'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS),
          },
        },
      );
    }

    const { error: touchError } = await admin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRow.id);
    if (touchError) {
      // Informativo apenas — nunca bloqueia a resposta ao chamador.
      console.error('[public-api] Failed to update last_used_at:', touchError.message);
    }

    const { data: product, error: productError } = await admin
      .from('products')
      .select('sku, name, location, stock_quantity')
      .eq('company_id', String(keyRow.company_id))
      .eq('sku', sku)
      .maybeSingle();

    if (productError) {
      console.error('[public-api] Failed to look up product:', productError.message);
      return fail(500, 'internal_error', 'Erro ao consultar o produto.');
    }
    if (!product) {
      return fail(404, 'product_not_found', 'Produto não encontrado para este SKU.');
    }

    return json({
      sku: product.sku,
      name: product.name,
      location: product.location,
      stock_quantity: product.stock_quantity,
    });
  } catch (err) {
    // Só o log do servidor vê o erro real; a resposta nunca carrega stack
    // trace nem mensagem interna.
    console.error('[public-api] Unhandled error:', err);
    return fail(500, 'internal_error', 'Erro interno.');
  }
});
