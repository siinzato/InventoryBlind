// Webhook Dispatch — consumidor da fila de company_webhook_deliveries
// (Configurações Avançadas > Webhooks). Chamado pelo pg_cron a cada minuto
// (migration 064, company_webhook_dispatch_pending), nunca pelo navegador.
//
// ── Autenticação (sem usuário, igual ao automation-run em mode:'cron') ──────
// Segredo gerado pelo banco e guardado no Vault, apresentado no header
// x-webhook-cron-secret e conferido dentro do banco
// (company_webhook_verify_cron_secret) — o valor nunca entra na memória deste
// processo.
//
// ── SSRF ─────────────────────────────────────────────────────────────────────
// Mesma defesa em profundidade já provada em automation-run/index.ts
// (validateWebhookUrl + resolução de DNS + IP fixado contra TOCTOU), portada
// aqui como código próprio e independente — automation-run não foi tocado,
// então nada deste arquivo pode regredir o motor de automações. A única
// diferença deliberada: aqui http://localhost e http://127.0.0.1 são aceitos
// (pedido explícito, uso em desenvolvimento local com `supabase functions
// serve`) — não passam pela reentrega HTTPS com IP fixado, só por um fetch()
// direto, porque não há DNS de terceiro para forjar num endereço de loopback.
//
// ── Retentativas ─────────────────────────────────────────────────────────────
// No máximo 3 tentativas por entrega (company_webhook_record_attempt,
// migration 064), backoff curto e fixo — nunca um loop infinito.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DELIVERY_TIMEOUT_MS = 10_000;
const CLAIM_LIMIT = 20;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function computeHmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Validação de URL (mesmas regras da RPC company_webhook_create/update) ──
function isLoopbackDevUrl(u: URL): boolean {
  return (
    (u.protocol === 'http:') &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  );
}

function validateWebhookUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'a URL informada é inválida.';
  }

  if (isLoopbackDevUrl(u)) return null;

  if (u.protocol !== 'https:') {
    return 'a URL precisa usar HTTPS.';
  }

  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host === '::1' ||
    host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')
  ) {
    return 'endereços locais não são permitidos.';
  }
  if (
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host)
  ) {
    return 'endereços de rede interna não são permitidos.';
  }

  return null;
}

// ── Resolução de DNS e checagem de endereço — porte fiel de automation-run ──
function isBlockedAddress(ip: string): boolean {
  const address = ip.trim().toLowerCase();

  if (address.includes(':')) {
    if (address === '::1' || address === '::') return true;
    if (/^f[cd]/.test(address)) return true;
    if (/^fe[89ab]/.test(address)) return true;
    const mapped = address.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped != null) return isBlockedAddress(mapped[1]);
    return false;
  }

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

async function resolveAndCheckHost(hostname: string): Promise<{ ip: string } | { problem: string }> {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return isBlockedAddress(hostname)
      ? { problem: 'o endereço resolve para uma rede interna.' }
      : { ip: hostname };
  }

  const addresses: string[] = [];
  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...(await Deno.resolveDns(hostname, recordType)));
    } catch {
      // Ausência de um tipo de registro é normal.
    }
  }

  if (addresses.length === 0) {
    return { problem: 'não foi possível resolver o endereço informado.' };
  }
  if (addresses.some(isBlockedAddress)) {
    return { problem: 'o endereço resolve para uma rede interna e foi recusado.' };
  }

  return { ip: addresses[0] };
}

interface PinnedResponse {
  status: number;
}

/** Conecta ao IP já validado (fecha o TOCTOU entre resolver e conectar) —
 *  porte fiel de fetchWithPinnedIp em automation-run/index.ts. */
async function fetchWithPinnedIp(input: {
  url: URL;
  ip: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<PinnedResponse> {
  const port = input.url.port !== '' ? Number(input.url.port) : 443;
  const path = input.url.pathname + input.url.search;

  const tcp = await Deno.connect({ hostname: input.ip, port });
  let conn: Deno.TlsConn;
  try {
    conn = await Deno.startTls(tcp, { hostname: input.url.hostname });
  } catch (thrown) {
    tcp.close();
    throw thrown;
  }

  const timer = setTimeout(() => {
    try { conn.close(); } catch { /* já fechada */ }
  }, input.timeoutMs);

  try {
    const bodyBytes = new TextEncoder().encode(input.body);
    const headerLines = [
      `POST ${path === '' ? '/' : path} HTTP/1.1`,
      `Host: ${input.url.host}`,
      'Connection: close',
      `Content-Length: ${bodyBytes.byteLength}`,
      ...Object.entries(input.headers).map(([name, value]) => `${name}: ${value}`),
    ];
    const request = new TextEncoder().encode(headerLines.join('\r\n') + '\r\n\r\n');

    for (const chunk of [request, bodyBytes]) {
      let written = 0;
      while (written < chunk.byteLength) {
        written += await conn.write(chunk.subarray(written));
      }
    }

    const buffer = new Uint8Array(1024);
    const read = await conn.read(buffer);
    if (read == null || read === 0) throw new Error('Resposta vazia do destino.');

    const statusLine = new TextDecoder().decode(buffer.subarray(0, read)).split('\r\n')[0] ?? '';
    const match = statusLine.match(/^HTTP\/1\.[01] (\d{3})/);
    if (match == null) throw new Error('Resposta não reconhecida como HTTP.');

    return { status: Number(match[1]) };
  } finally {
    clearTimeout(timer);
    try { conn.close(); } catch { /* já fechada pelo timeout */ }
  }
}

interface Delivery {
  id: string;
  webhook_id: string;
  company_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
}

async function deliverOne(admin: SupabaseClient, delivery: Delivery): Promise<void> {
  const { data: webhook, error: webhookError } = await admin
    .from('company_webhooks')
    .select('id, url, is_active')
    .eq('id', delivery.webhook_id)
    .maybeSingle();

  if (webhookError || !webhook || !webhook.is_active) {
    await admin.rpc('company_webhook_record_attempt', {
      p_delivery_id: delivery.id,
      p_success: false,
      p_http_status: null,
      p_error: !webhook ? 'Webhook não encontrado.' : 'Webhook desativado.',
    });
    return;
  }

  const problem = validateWebhookUrl(webhook.url);
  if (problem != null) {
    await admin.rpc('company_webhook_record_attempt', {
      p_delivery_id: delivery.id,
      p_success: false,
      p_http_status: null,
      p_error: `URL recusada: ${problem}`,
    });
    return;
  }

  const { data: secretRow, error: secretError } = await admin
    .from('company_webhook_secrets')
    .select('secret')
    .eq('webhook_id', webhook.id)
    .maybeSingle();

  if (secretError || !secretRow) {
    await admin.rpc('company_webhook_record_attempt', {
      p_delivery_id: delivery.id,
      p_success: false,
      p_http_status: null,
      p_error: 'Segredo de assinatura não encontrado.',
    });
    return;
  }

  const body = JSON.stringify({
    id: delivery.id,
    event: delivery.event_type,
    createdAt: new Date().toISOString(),
    data: delivery.payload,
  });
  const signature = await computeHmacHex(body, secretRow.secret);
  const url = new URL(webhook.url);

  const headers = {
    'content-type': 'application/json',
    'x-inventoryblind-event': delivery.event_type,
    'x-inventoryblind-delivery-id': delivery.id,
    'x-inventoryblind-signature': signature,
  };

  try {
    let status: number;

    if (isLoopbackDevUrl(url)) {
      // Loopback de desenvolvimento: sem DNS de terceiro para forjar, e sem
      // TLS (é HTTP simples) — um fetch() direto é seguro e mais simples que
      // o cliente com IP fixado, que assume TLS.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
        status = response.status;
      } finally {
        clearTimeout(timer);
      }
    } else {
      const target = await resolveAndCheckHost(url.hostname);
      if ('problem' in target) {
        await admin.rpc('company_webhook_record_attempt', {
          p_delivery_id: delivery.id,
          p_success: false,
          p_http_status: null,
          p_error: `URL recusada: ${target.problem}`,
        });
        return;
      }
      const pinned = await fetchWithPinnedIp({ url, ip: target.ip, headers, body, timeoutMs: DELIVERY_TIMEOUT_MS });
      status = pinned.status;
    }

    const success = status >= 200 && status < 300;
    await admin.rpc('company_webhook_record_attempt', {
      p_delivery_id: delivery.id,
      p_success: success,
      p_http_status: status,
      p_error: success ? null : `HTTP ${status}`,
    });
  } catch (thrown) {
    await admin.rpc('company_webhook_record_attempt', {
      p_delivery_id: delivery.id,
      p_success: false,
      p_http_status: null,
      p_error: thrown instanceof Error ? thrown.message : 'Falha ao chamar o webhook.',
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const cronSecret = req.headers.get('x-webhook-cron-secret');
  if (!cronSecret) return json({ error: 'Não autorizado.' }, 401);

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: valid } = await admin.rpc('company_webhook_verify_cron_secret', { p_candidate: cronSecret });
  if (valid !== true) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  try {
    const { data: claimed, error: claimError } = await admin.rpc('company_webhook_claim_due_deliveries', {
      p_limit: CLAIM_LIMIT,
    });

    if (claimError) {
      console.error('[webhook-dispatch] Failed to claim deliveries:', claimError.message);
      return json({ error: 'Falha ao reivindicar entregas.' }, 500);
    }

    const deliveries = (claimed ?? []) as Delivery[];
    for (const delivery of deliveries) {
      await deliverOne(admin, delivery);
    }

    return json({ ok: true, processed: deliveries.length });
  } catch (err) {
    console.error('[webhook-dispatch] Unhandled error:', err);
    return json({ error: 'Erro interno.' }, 500);
  }
});
