// Automation Webhook — endereço público de entrada.
//
//   POST /automation-webhook/<automationId>
//
// Verifica, registra e ENFILEIRA. Não avalia condição e não executa ação: o corpo de
// um webhook chega com timeout curto, e rodar o workflow aqui produziria timeout,
// reentrega e trabalho duplicado. O engine consome pela fila, igual a qualquer outro
// gatilho.
//
// ── Autenticidade ───────────────────────────────────────────────────────────
// Reusa webhookVerification.ts, o mesmo módulo das integrações: HMAC-SHA256 sobre o
// corpo cru com o segredo da automação, janela de frescor e unicidade do corpo. Os
// três juntos, porque assinatura sozinha permite replay e timestamp sozinho permite
// forja.
//
// Segredo por automação (migration 053), gerado pelo banco e entregue uma única vez
// ao usuário. Não há caminho de leitura: quem perder rotaciona.
//
// ── O que uma entrega não autenticada produz ────────────────────────────────
// Nada. Nem linha de registro. O endereço é público, e gravar rejeição de qualquer
// requisição transformaria a URL num jeito de encher a tabela de graça. Registro só
// depois de a assinatura conferir.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  buildSafeLog,
  signaturePayload,
  verifyWebhook,
} from '../../../src/lib/integrations/webhooks/webhookVerification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Teto do corpo. Sem limite, um remetente hostil força a função a alocar memória
 *  arbitrária antes de qualquer verificação — e a verificação precisa do corpo
 *  inteiro para calcular o HMAC, então não há como validar antes de ler. */
const MAX_BODY_BYTES = 128 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-signature, x-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id da automação é o último segmento do caminho.
 *
 *  A forma uuid é validada aqui, e não no banco: sem isso, um caminho qualquer
 *  chegaria como comparação uuid, falharia no cast e responderia 500 — que diz ao
 *  remetente "erro nosso, tente de novo" para o que é só uma URL errada. Mesmo
 *  defeito que a 050 corrigiu no webhook de integrações. */
function parseAutomationId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const anchor = segments.lastIndexOf('automation-webhook');
  if (anchor === -1) return null;
  if (segments.length !== anchor + 2) return null;

  const id = segments[anchor + 1];
  return UUID.test(id) ? id : null;
}

/** HMAC-SHA256 em hex minúsculo, via WebCrypto.
 *
 *  Síncrono porque `verifyWebhook` é uma função pura e recebe o cálculo pronto. O
 *  HMAC é pré-computado antes da chamada — foi um bug real no webhook de
 *  integrações passar uma referência ainda não atribuída. */
async function computeHmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Retoma uma execução parada num bloco de espera.
 *
 *  Tudo acontece numa transação no banco (automation_resume_wait): emitir o evento de
 *  retomada e fechar a espera juntos. Separado, haveria janela em que a espera consta
 *  resolvida e o evento não existe.
 *
 *  Respostas: 200 quando retoma, 404 para token inexistente, 409 para espera já
 *  resolvida ou vencida. O 409 é informação útil — diz ao sistema externo que ele
 *  chegou tarde, não que errou o endereço. */
async function resumeWait(token: string, rawBody: string): Promise<Response> {
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let payload: unknown = null;
  try {
    payload = rawBody.trim() === '' ? {} : JSON.parse(rawBody);
  } catch {
    // Corpo não-JSON não impede a retomada: o que importa é a chamada ter acontecido.
    payload = { raw: rawBody.slice(0, 2000) };
  }

  const { data, error } = await admin.rpc('automation_resume_wait', {
    p_token: token,
    p_external_payload: payload,
  });

  if (error) {
    return json({ error: 'Falha ao retomar a execução.' }, 500);
  }

  const outcome = ((data ?? []) as { resumed: boolean; reason: string; event_id: string | null }[])[0];

  if (outcome == null || outcome.reason === 'not_found') {
    return json({ error: 'Espera não reconhecida.' }, 404);
  }

  if (!outcome.resumed) {
    return json({ error: 'Esta espera já foi resolvida ou venceu.', reason: outcome.reason }, 409);
  }

  console.log(
    JSON.stringify(
      buildSafeLog({
        event: 'automation.wait.resumed',
        context: { eventId: outcome.event_id },
      })
    )
  );

  return json({ ok: true, resumed: true, eventId: outcome.event_id });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  // GET numa URL de webhook é varredura, não entrega.
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const url = new URL(req.url);

  // ── Retomada de espera ────────────────────────────────────────────────────
  // `?wait=<token>` continua uma execução parada num bloco de espera por chamada
  // externa (migration 057). O token É a credencial: aleatório de 32 bytes, de uso
  // único, e não há assinatura HMAC porque o sistema externo não recebeu segredo — ele
  // recebeu o token no log da execução. Adivinhá-lo é o mesmo problema de adivinhar o
  // segredo.
  const waitToken = url.searchParams.get('wait');
  if (waitToken != null) {
    return await resumeWait(waitToken, await req.text());
  }

  const automationId = parseAutomationId(url.pathname);
  if (automationId == null) {
    return json({ error: 'URL de webhook inválida.' }, 404);
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: 'Corpo da requisição muito grande.' }, 413);
  }

  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { data: resolved, error: resolveError } = await admin.rpc('automation_resolve_webhook', {
      p_automation_id: automationId,
    });

    if (resolveError) {
      // Culpa nossa: queremos a reentrega.
      return json({ error: 'Falha ao resolver a automação.' }, 500);
    }

    const row = ((resolved ?? []) as { automation_id: string; company_id: string; secret: string; is_active: boolean }[])[0];

    // Automação inexistente, de outra empresa, sem gatilho de webhook ou sem segredo:
    // uma resposta só. Diferenciar confirmaria a existência de um id alheio.
    if (row == null) {
      return json({ error: 'Webhook não reconhecido.' }, 404);
    }

    const timestampHeader = req.headers.get('x-timestamp');
    const signatureHeader = req.headers.get('x-signature');

    // Pré-computado antes de verifyWebhook, que é puro e sincrônico.
    const expected = await computeHmacHex(
      signaturePayload(timestampHeader ?? '', rawBody),
      row.secret
    );

    const verification = verifyWebhook({
      rawBody,
      signatureHeader,
      timestampHeader,
      computeHmac: () => expected,
      secret: row.secret,
      nowMs: Date.now(),
    });

    if (!verification.ok) {
      // NADA gravado: ver o comentário do topo.
      console.log(
        JSON.stringify(
          buildSafeLog({
            event: 'automation.webhook.rejected',
            message: verification.rejection.code,
            context: { automationId },
          })
        )
      );
      return json({ error: verification.rejection.message, code: verification.rejection.code }, verification.rejection.status);
    }

    // Autenticado. Daqui em diante vale registrar.
    const payloadHash = await sha256Hex(rawBody);

    if (!row.is_active) {
      // Assinatura válida e automação desligada. Registrado como recusa para o
      // usuário ver que a entrega chegou — sem isso, ele desativa por engano e fica
      // sem entender por que "o webhook não funciona".
      await admin.rpc('automation_reject_webhook', {
        p_automation_id: automationId,
        p_company_id: row.company_id,
        p_payload_hash: payloadHash,
        p_reason: 'automation_inactive',
      });
      // 200: a entrega foi entendida e aceita como fato; a automação é que está
      // desligada. Um 4xx faria o provedor tratar como erro e eventualmente
      // desabilitar a assinatura.
      return json({ ok: true, ignored: true, reason: 'automation_inactive' });
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Corpo não-JSON é aceito como texto, para o remetente não precisar de JSON.
      // O contexto expõe em `trigger.webhook.raw`.
      payload = null;
    }

    const { data: accepted, error: acceptError } = await admin.rpc('automation_accept_webhook', {
      p_automation_id: automationId,
      p_company_id: row.company_id,
      p_payload_hash: payloadHash,
      p_payload: {
        webhook: {
          automationId,
          receivedAt: new Date().toISOString(),
          // Espaço de nomes fechado, igual aos outros gatilhos: o registry declara
          // `trigger.webhook.*` e a validação recusa caminho fora disso.
          body: payload,
          raw: payload == null ? rawBody.slice(0, 4000) : null,
        },
      },
    });

    if (acceptError) {
      return json({ error: 'Falha ao registrar a entrega.' }, 500);
    }

    const outcome = ((accepted ?? []) as { delivery_status: string; event_id: string | null }[])[0];

    if (outcome?.delivery_status === 'duplicate') {
      // 200 e não 409: para o remetente, reentregar algo já processado teve o efeito
      // pretendido. Um erro o faria tentar de novo indefinidamente.
      return json({ ok: true, duplicate: true });
    }

    console.log(
      JSON.stringify(
        buildSafeLog({
          event: 'automation.webhook.accepted',
          context: { automationId, eventId: outcome?.event_id ?? null },
        })
      )
    );

    return json({ ok: true, eventId: outcome?.event_id ?? null });
  } catch (thrown) {
    console.error(
      JSON.stringify(
        buildSafeLog({
          event: 'automation.webhook.crashed',
          message: thrown instanceof Error ? thrown.message : 'erro desconhecido',
          context: { automationId },
        })
      )
    );
    return json({ error: 'Erro interno.' }, 500);
  }
});
