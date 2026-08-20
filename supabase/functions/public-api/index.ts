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
// Deploy: npx supabase functions deploy public-api --no-verify-jwt
// (o chamador externo não tem — e nunca terá — um JWT do Supabase; a
// autenticação é 100% pela chave de API.)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'GET') return json({ error: 'Método não suportado.' }, 405);

  const url = new URL(req.url);
  if (!url.pathname.endsWith('/stock')) {
    return json({ error: 'Rota não encontrada. Use GET /public-api/stock?sku=...' }, 404);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!presented) {
    return json({ error: 'Chave de API ausente. Envie "Authorization: Bearer <chave>".' }, 401);
  }

  const sku = url.searchParams.get('sku')?.trim();
  if (!sku) {
    return json({ error: 'Informe o parâmetro "sku".' }, 400);
  }

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const keyHash = await sha256Hex(presented);

    const { data: keyRow, error: keyError } = await admin
      .from('api_keys')
      .select('id, company_id, revoked_at')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyError) {
      console.error('[public-api] Failed to look up API key:', keyError.message);
      return json({ error: 'Erro ao validar a chave de API.' }, 500);
    }
    if (!keyRow || keyRow.revoked_at) {
      return json({ error: 'Chave de API inválida ou revogada.' }, 401);
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
      return json({ error: 'Erro ao consultar o produto.' }, 500);
    }
    if (!product) {
      return json({ error: 'Produto não encontrado para este SKU.' }, 404);
    }

    return json({
      sku: product.sku,
      name: product.name,
      location: product.location,
      stock_quantity: product.stock_quantity,
    });
  } catch (err) {
    console.error('[public-api] Unhandled error:', err);
    return json({ error: 'Erro interno.' }, 500);
  }
});
