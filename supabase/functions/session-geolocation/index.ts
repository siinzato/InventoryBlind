// Session Geolocation — Edge Function. Resolve localização aproximada (cidade/
// região/país) dos IPs de sessões do painel administrativo de Sessões
// (Central de Segurança → Sessões), sem o navegador nunca falar diretamente
// com o provedor de geolocalização.
//
// Segurança (mesmo padrão de nfe-fetch-by-key/erp-sync, não alterar sem
// revisar de novo):
// - O client Supabase usa a ANON key + o JWT do usuário encaminhado pelo
//   navegador, nunca service_role.
// - Os IPs NUNCA vêm do corpo da requisição — só session_ids. Os IPs em si
//   são obtidos pela RPC admin_get_session_ips (migration 093), que já
//   reaplica a checagem de owner/admin e o isolamento por empresa. Isso
//   impede tanto geolocalizar um IP arbitrário quanto uma sessão de fora da
//   empresa do operador.
// - Nunca persiste a localização resolvida — o resultado só volta na resposta
//   HTTP desta chamada.
// - Uma falha de geolocalização (rede, 429, IP privado/reservado) nunca gera
//   erro 5xx: a sessão correspondente volta com available:false, e a
//   listagem de sessões (que já rodou antes desta chamada) nunca é bloqueada
//   por isso.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const PROVIDER_TIMEOUT_MS = 4_000;
const MAX_IPS_PER_CALL = 25;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export interface GeoResult {
  available: boolean;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  country_code?: string | null;
}

/** Adaptador substituível — trocar de provedor é trocar só esta função. */
type GeoProvider = (ip: string) => Promise<GeoResult>;

const UNAVAILABLE: GeoResult = { available: false };

/** ipwho.is — sem chave de API, HTTPS, aceita `fields=` para não devolver
 *  mais dados do que o necessário. Chamado só pelo backend, nunca pelo
 *  navegador. */
const ipwhoIsProvider: GeoProvider = async (ip) => {
  try {
    const resp = await fetch(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,message,city,region,country,country_code`,
      { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
    );
    if (resp.status === 429) {
      console.warn('[session-geolocation] Provider rate-limited (429) for an IP lookup.');
      return UNAVAILABLE;
    }
    if (!resp.ok) return UNAVAILABLE;

    const data = await resp.json().catch(() => null) as {
      success?: boolean; city?: string; region?: string; country?: string; country_code?: string;
    } | null;
    if (!data || data.success === false) return UNAVAILABLE;

    return {
      available: true,
      city: data.city ?? null,
      region: data.region ?? null,
      country: data.country ?? null,
      country_code: data.country_code ?? null,
    };
  } catch (err) {
    console.warn('[session-geolocation] Provider lookup failed:', err);
    return UNAVAILABLE;
  }
};

const PROVIDER: GeoProvider = ipwhoIsProvider;

/** IPv4/IPv6 privados, reservados, loopback ou link-local nunca são
 *  enviados ao provedor externo — não têm localização geográfica real. */
function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
  return false;
}

function isValidIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const v6 = /^[0-9a-fA-F:]+$/;
  if (v4.test(ip)) return ip.split('.').every(part => Number(part) <= 255);
  return v6.test(ip) && ip.includes(':');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401);

    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    const body = await req.json().catch(() => null);
    const rawIds = Array.isArray(body?.session_ids) ? body.session_ids : [];
    const sessionIds = [...new Set(rawIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))]
      .slice(0, MAX_IPS_PER_CALL);

    if (sessionIds.length === 0) {
      return jsonResponse({ results: {} });
    }

    // A RPC já reaplica owner/admin + isolamento por empresa — se o operador
    // não tiver permissão, ou pedir uma sessão de outra empresa, ela nunca
    // aparece aqui. Nenhum IP chega por este caminho vindo do client.
    const { data: sessionIps, error: rpcError } = await supabase.rpc('admin_get_session_ips', {
      p_session_ids: sessionIds,
    });
    if (rpcError) {
      return jsonResponse({ error: 'Não foi possível resolver a localização das sessões agora.' }, 403);
    }

    const rows = (sessionIps ?? []) as { session_id: string; ip_address: string | null }[];

    // IP → lista de session_ids que o compartilham, para uma única consulta ao
    // provedor por IP único (remove duplicados).
    const sessionsByIp = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.ip_address || !isValidIp(row.ip_address) || isPrivateOrReservedIp(row.ip_address)) continue;
      const list = sessionsByIp.get(row.ip_address) ?? [];
      list.push(row.session_id);
      sessionsByIp.set(row.ip_address, list);
    }

    const uniqueIps = [...sessionsByIp.keys()];
    const geoByIp = new Map<string, GeoResult>();
    await Promise.all(uniqueIps.map(async (ip) => {
      geoByIp.set(ip, await PROVIDER(ip));
    }));

    const results: Record<string, GeoResult> = {};
    for (const id of sessionIds) results[id] = UNAVAILABLE;
    for (const [ip, ids] of sessionsByIp) {
      const geo = geoByIp.get(ip) ?? UNAVAILABLE;
      for (const id of ids) results[id] = geo;
    }

    return jsonResponse({ results });
  } catch (err) {
    console.error('[session-geolocation] Unhandled error:', err);
    // Falha aqui nunca deve impedir a listagem de sessões no frontend — devolve
    // sucesso vazio em vez de 500, já que o frontend trata ausência como
    // "indisponível" por sessão.
    return jsonResponse({ results: {} });
  }
});
