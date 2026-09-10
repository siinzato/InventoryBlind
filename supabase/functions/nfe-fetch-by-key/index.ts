// NF-e Fetch by Key — Edge Function. Busca a NF-e no provedor externo (Meu Danfe,
// api.meudanfe.com.br/v2) a partir da chave de acesso (44 dígitos) e devolve o XML
// puro. O parsing do XML, o vínculo produto-a-produto e a criação do registro
// continuam 100% em src/lib/nfe/nfeService.ts (importNfeXml) — esta função NUNCA
// duplica essa lógica, só entrega o XML para o mesmo caminho já usado na
// importação manual.
//
// Contrato com o provedor confirmado contra uma integração já em produção
// (GoScan/outlet-app, supabase/functions/consultar-nfe-meudanfe): header de
// autenticação é exatamente "Api-Key" (com hífen — NÃO "apikey"), sem corpo no
// PUT, e o GET devolve { format: "XML", data: "<xml...>" } — não "xml".
//
// Segurança (mesmo padrão de erp-sync/index.ts, não alterar sem revisar de novo):
// - O client Supabase usa a ANON key + o JWT do usuário encaminhado pelo navegador,
//   nunca service_role — toda leitura roda sob a mesma RLS do app.
// - MEUDANFE_API_KEY só existe como secret desta função (Deno.env.get) — nunca em VITE_*.
// - Qualquer usuário autenticado com empresa resolvível pode buscar (não precisa ser
//   admin/owner) — só a sessão válida é exigida.
// - Nunca simula sucesso: erro de formato, nota inexistente ou falha do provedor
//   sempre voltam como erro explícito pro operador, nunca um XML vazio/fake.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MEUDANFE_API_KEY = Deno.env.get('MEUDANFE_API_KEY');
const PROVIDER_BASE = 'https://api.meudanfe.com.br/v2';
const UPSTREAM_TIMEOUT_MS = 15_000;

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

function isValidInvoiceKey(key: string): boolean {
  return /^\d{44}$/.test(key);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    if (!MEUDANFE_API_KEY) {
      console.error('[nfe-fetch-by-key] MEUDANFE_API_KEY não configurada.');
      return jsonResponse({ error: 'Busca automática de NF-e não está configurada nesta instância.' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401);

    const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

    const body = await req.json().catch(() => null);
    const invoiceKey = String(body?.invoiceKey ?? '').trim();
    if (!isValidInvoiceKey(invoiceKey)) {
      return jsonResponse({ error: 'Chave de acesso inválida. Informe os 44 dígitos da NF-e.' }, 400);
    }

    const { data: existing, error: existingError } = await supabase
      .from('nfe_invoices')
      .select('*')
      .eq('invoice_key', invoiceKey)
      .maybeSingle();
    if (existingError) {
      console.error('[nfe-fetch-by-key] Failed to check existing invoice:', existingError);
      return jsonResponse({ error: 'Não foi possível verificar se esta nota já foi importada.' }, 500);
    }
    if (existing) {
      return jsonResponse({ outcome: 'already_imported', invoice: existing });
    }

    const { data: claimed, error: claimError } = await supabase.rpc('nfe_claim_key_fetch', {
      p_invoice_key: invoiceKey,
    });
    if (claimError) {
      console.error('[nfe-fetch-by-key] Failed to claim rate-limit lock:', claimError);
      return jsonResponse({ error: 'Não foi possível iniciar a busca agora. Tente novamente.' }, 500);
    }
    if (!claimed) {
      return jsonResponse({ error: 'Aguarde um instante antes de tentar buscar esta chave novamente.' }, 429);
    }

    // PUT — solicita/consulta status. Sem corpo: o provedor rejeita com 400
    // genérico se receber Content-Type/corpo inesperado nesta chamada.
    let addResp: Response;
    try {
      addResp = await fetch(`${PROVIDER_BASE}/fd/add/${invoiceKey}`, {
        method: 'PUT',
        headers: { 'Api-Key': MEUDANFE_API_KEY },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      console.error('[nfe-fetch-by-key] Network error on PUT fd/add:', err);
      return jsonResponse({ error: 'O provedor de consulta de NF-e está indisponível agora. Tente novamente.' }, 502);
    }

    if (!addResp.ok) {
      const rawText = await addResp.text();
      console.error('[nfe-fetch-by-key] Provider add error:', addResp.status, rawText);
      if (addResp.status === 400) {
        return jsonResponse({ error: 'Chave de acesso inválida. Confira os 44 dígitos.' }, 400);
      }
      if (addResp.status === 401 || addResp.status === 403) {
        return jsonResponse({ error: 'Integração com o provedor de NF-e não está configurada corretamente. Procure um administrador.' }, 502);
      }
      if (addResp.status === 402) {
        return jsonResponse({ error: 'Saldo insuficiente na integração de consulta de NF-e. Procure um administrador.' }, 502);
      }
      if (addResp.status === 429) {
        return jsonResponse({ error: 'Muitas consultas ao provedor em pouco tempo. Aguarde e tente novamente.' }, 429);
      }
      return jsonResponse({ error: 'O provedor de consulta de NF-e está temporariamente indisponível. Tente novamente mais tarde.' }, 502);
    }

    let addJson: { status?: unknown } | null = null;
    try {
      addJson = await addResp.json();
    } catch {
      console.error('[nfe-fetch-by-key] Provider add returned non-JSON body.');
      return jsonResponse({ error: 'Resposta inválida do provedor de consulta de NF-e.' }, 502);
    }

    const providerStatus = typeof addJson?.status === 'string' ? addJson.status.trim().toUpperCase() : '';

    if (providerStatus === 'WAITING' || providerStatus === 'SEARCHING') {
      return jsonResponse({ outcome: 'waiting', providerStatus });
    }

    if (providerStatus === 'NOT_FOUND') {
      return jsonResponse({ error: 'NF-e não encontrada. Confira a chave de acesso ou envie o XML manualmente.' }, 404);
    }

    if (providerStatus !== 'OK') {
      console.error('[nfe-fetch-by-key] Unexpected provider status:', providerStatus);
      return jsonResponse({ error: 'Não foi possível consultar esta NF-e agora. Você ainda pode importar o XML manualmente.' }, 502);
    }

    // OK — baixa o XML nesta mesma requisição.
    let xmlResp: Response;
    try {
      xmlResp = await fetch(`${PROVIDER_BASE}/fd/get/xml/${invoiceKey}`, {
        method: 'GET',
        headers: { 'Api-Key': MEUDANFE_API_KEY },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      console.error('[nfe-fetch-by-key] Network error on GET fd/get/xml:', err);
      return jsonResponse({ error: 'O provedor de consulta de NF-e está indisponível agora. Tente novamente.' }, 502);
    }

    if (xmlResp.status === 404) {
      // Corrida documentada: status vira OK antes do XML estar de fato
      // disponível pra download — trata como "ainda buscando", nunca como erro.
      return jsonResponse({ outcome: 'waiting', providerStatus: 'SEARCHING' });
    }
    if (!xmlResp.ok) {
      const rawText = await xmlResp.text();
      console.error('[nfe-fetch-by-key] Provider xml fetch error:', xmlResp.status, rawText);
      return jsonResponse({ error: 'Não foi possível baixar o XML desta NF-e no provedor.' }, 502);
    }

    let xmlJson: { format?: unknown; data?: unknown } | null = null;
    try {
      xmlJson = await xmlResp.json();
    } catch {
      console.error('[nfe-fetch-by-key] Provider xml returned non-JSON body.');
      return jsonResponse({ error: 'Resposta inválida do provedor ao baixar o XML.' }, 502);
    }

    if (xmlJson?.format !== 'XML' || typeof xmlJson?.data !== 'string' || xmlJson.data.trim() === '') {
      console.error('[nfe-fetch-by-key] Provider xml response missing data:', xmlJson);
      return jsonResponse({ error: 'O provedor não retornou o XML desta NF-e. Você ainda pode importar o XML manualmente.' }, 502);
    }

    return jsonResponse({ outcome: 'ok', xml: xmlJson.data });
  } catch (err) {
    console.error('[nfe-fetch-by-key] Unhandled error:', err);
    return jsonResponse({ error: 'Não foi possível buscar a NF-e agora. Tente novamente.' }, 500);
  }
});
