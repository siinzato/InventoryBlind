// ERP Sync — Edge Function. Envia os ajustes de uma sessão de contagem física
// já aprovada para o adapter do ERP configurado (hoje: Tiny, sem credenciais
// reais — ver tinyAdapter.ts) e registra cada resultado em erp_sync_events.
//
// Segurança (mesmo padrão de blindai-agent/index.ts, não alterar sem revisar de novo):
// - O client Supabase usa a ANON key + o JWT do usuário encaminhado pelo navegador,
//   nunca service_role — toda leitura/escrita roda sob a mesma RLS do app.
// - Guarda de autenticação + role (owner/admin) roda antes de qualquer ajuste;
//   a sessão precisa estar aprovada (approved_at) — revalidado de novo dentro de
//   pc_record_erp_sync_event no banco, nunca confiando só nesta checagem aqui.
// - Erro parcial nunca é escondido: cada item tem seu próprio resultado no
//   relatório devolvido (seção 21 do ticket).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { TinyErpAdapter } from './tinyAdapter.ts';
import type { ErpAdapter } from '../../../src/lib/erp/erpAdapter.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

function getAdapter(_provider: string): ErpAdapter {
  // Único provedor real hoje é o Tiny; a abstração já permite adicionar
  // Bling/SAP/TOTVS depois sem tocar no restante desta função.
  return new TinyErpAdapter();
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

    const { data: companyId, error: companyError } = await supabase.rpc('get_my_company_id');
    if (companyError || !companyId) {
      return jsonResponse({ error: 'Não foi possível identificar a empresa deste usuário.' }, 401);
    }

    const { data: role, error: roleError } = await supabase.rpc('get_my_role');
    if (roleError || !role || !['owner', 'admin'].includes(role as string)) {
      return jsonResponse({ error: 'Apenas owner ou admin podem sincronizar ajustes com o ERP.' }, 403);
    }

    const body = await req.json().catch(() => null);
    const sessionId = body?.sessionId as string | undefined;
    if (!sessionId) return jsonResponse({ error: 'sessionId é obrigatório.' }, 400);

    const { data: session, error: sessionError } = await supabase
      .from('physical_count_sessions')
      .select('id, company_id, approved_at, status')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError || !session) return jsonResponse({ error: 'Sessão não encontrada.' }, 404);
    if (session.company_id !== companyId) return jsonResponse({ error: 'Sessão pertence a outra empresa.' }, 403);
    if (!session.approved_at) return jsonResponse({ error: 'A sessão precisa ser aprovada antes do envio ao ERP.' }, 400);

    const { data: items, error: itemsError } = await supabase
      .from('physical_count_items')
      .select('id, product_id, sku, ean, erp_quantity_snapshot, physical_quantity, found_elsewhere_quantity, result_status')
      .eq('session_id', sessionId)
      .neq('result_status', 'ok');

    if (itemsError) return jsonResponse({ error: 'Falha ao carregar os itens divergentes da sessão.' }, 500);

    const divergentItems = items ?? [];
    if (divergentItems.length === 0) {
      return jsonResponse({ attempted: 0, succeeded: 0, pending: 0, failed: 0, results: [] });
    }

    const { data: priorEvents } = await supabase
      .from('erp_sync_events')
      .select('item_id')
      .eq('session_id', sessionId)
      .eq('success', true);

    const alreadySynced = new Set((priorEvents ?? []).map(e => e.item_id as string));
    const adapter = getAdapter('tiny');

    const results = await Promise.all(
      divergentItems.map(async item => {
        if (alreadySynced.has(item.id as string)) {
          return { itemId: item.id as string, productId: item.product_id as string, sku: item.sku as string | null, success: true, pending: false, errorMessage: null };
        }

        const previousQuantity = Number(item.erp_quantity_snapshot ?? 0);
        // Total físico real = achado no local esperado + achado em outro local
        // (ver pc_flag_found_elsewhere) — sincronizar só physical_quantity
        // subestimaria o estoque real sempre que houvesse excedente registrado.
        const finalQuantity = Number(item.physical_quantity ?? 0) + Number(item.found_elsewhere_quantity ?? 0);
        const idempotencyKey = crypto.randomUUID();

        const adjustmentResult = await adapter.pushAdjustment({
          itemId: item.id as string,
          productId: item.product_id as string,
          sku: item.sku as string | null,
          ean: item.ean as string | null,
          previousQuantity,
          finalQuantity,
          idempotencyKey,
        });

        const { error: recordError } = await supabase.rpc('pc_record_erp_sync_event', {
          p_session_id: sessionId,
          p_item_id: item.id,
          p_product_id: item.product_id,
          p_sku: item.sku,
          p_provider: adapter.provider,
          p_previous_quantity: previousQuantity,
          p_final_quantity: finalQuantity,
          p_adjustment: finalQuantity - previousQuantity,
          p_request_payload: adjustmentResult.requestPayload,
          p_response_payload: adjustmentResult.responsePayload,
          p_success: adjustmentResult.success,
          p_pending: adjustmentResult.pending,
          p_error_message: adjustmentResult.errorMessage,
          p_idempotency_key: idempotencyKey,
        });

        if (recordError) {
          console.error('[erp-sync] Failed to record sync event:', recordError);
        }

        return {
          itemId: item.id as string,
          productId: item.product_id as string,
          sku: item.sku as string | null,
          success: adjustmentResult.success,
          pending: adjustmentResult.pending,
          errorMessage: adjustmentResult.errorMessage,
        };
      })
    );

    const succeeded = results.filter(r => r.success).length;
    const pending = results.filter(r => r.pending).length;
    const failed = results.filter(r => !r.success && !r.pending).length;

    return jsonResponse({ attempted: results.length, succeeded, pending, failed, results });
  } catch (err) {
    console.error('[erp-sync] Unhandled error:', err);
    return jsonResponse({ error: 'Não foi possível processar a sincronização agora. Tente novamente.' }, 500);
  }
});
