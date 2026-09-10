// Integration Webhook — public endpoint.
//
// The only function in this project with NO user authentication, because the caller
// is a provider, not a person. Authenticity comes from the HMAC signature instead,
// which is why every check in webhookVerification.ts is load-bearing here.
//
// URL shape:  POST /integration-webhook/:providerKey/:connectionId
//
// The connection id is in the path rather than the body so the secret can be looked
// up before the body is trusted at all. A body-supplied id would have to be parsed
// from unverified input to find the key that verifies it — backwards.
//
// ── Answering strategy ──────────────────────────────────────────────────────
// A provider retries on any non-2xx. So:
//   200  accepted, duplicate, or permanently unacceptable (stop retrying)
//   401  bad/missing signature (visible as auth failure in their dashboard)
//   400  valid signature but replayed or malformed
//   500  our fault, and we DO want the retry
// Answering 500 to a bad signature would make the provider retry an attack for us.
//
// ── Work is enqueued, never performed ───────────────────────────────────────
// The handler records the event and enqueues a sync job. It does not call the
// provider: a webhook has a short timeout, and doing a multi-page sync inline would
// time out, get retried, and duplicate work. pg_cron picks the job up.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  buildSafeLog,
  eventIdentity,
  isDuplicateEventError,
  parseWebhookPath,
  signaturePayload,
  verifyWebhook,
} from '../../../src/lib/integrations/webhooks/webhookVerification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Header names differ per provider. Kept as a list rather than a per-provider map
 *  because the set is small and a provider using a new name is a one-line change —
 *  and because a missing entry fails closed (no signature -> 401), never open. */
const SIGNATURE_HEADERS = [
  'x-signature',
  'x-hub-signature-256',
  'x-webhook-signature',
  'x-tiny-signature',
  'signature',
];

const TIMESTAMP_HEADERS = [
  'x-timestamp',
  'x-webhook-timestamp',
  'x-request-timestamp',
  'x-tiny-timestamp',
];

const EVENT_ID_HEADERS = ['x-event-id', 'x-webhook-id', 'x-request-id', 'x-delivery-id'];

function firstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const value = req.headers.get(name);
    if (value != null && value.trim().length > 0) return value;
  }
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** SHA-256 hex of the raw body. Identifies a duplicate when the provider sends no
 *  event id, and proves two deliveries were identical without storing either. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
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

/** Topics that should produce a stock sync. Anything else is recorded and ignored —
 *  answered 200 so the provider stops retrying an event we will never act on. */
const STOCK_TOPICS = ['stock', 'estoque', 'inventory', 'produto', 'product'];

function topicTriggersSync(eventType: string | null): boolean {
  if (eventType == null) return false;
  const lower = eventType.toLowerCase();
  return STOCK_TOPICS.some(topic => lower.includes(topic));
}

Deno.serve(async (req: Request) => {
  // Only POST. A GET on this URL is a scan, not a delivery.
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  // .../integration-webhook/:providerKey/:connectionId — parsed by a tested pure
  // function, which also validates the uuid shape. Without that validation a
  // malformed URL reached the database as a uuid comparison, failed on a cast
  // error and answered 500 — telling the provider to retry and raising an alert
  // for what was only a bad URL.
  const path = parseWebhookPath(new URL(req.url).pathname);
  if (!path) {
    return json({ error: 'URL de webhook inválida.' }, 404);
  }
  const { providerKey, connectionId } = path;

  // service_role throughout: there is no user session here, and the tenant is
  // derived from the connection row rather than from anything the caller sent.
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const rawBody = await req.text();

  try {
    // ── 1. Resolve the connection from the PATH, before trusting the body ────
    const { data: connection, error: connectionError } = await admin
      .from('integration_connections')
      .select('id, company_id, provider_key, status')
      .eq('id', connectionId)
      .maybeSingle<{ id: string; company_id: string; provider_key: string; status: string }>();

    if (connectionError) {
      // Our fault: we want the retry.
      return json({ error: 'Falha ao resolver a conexão.' }, 500);
    }

    // Unknown connection, or the URL names a different provider than the connection
    // holds — either way this delivery does not belong here. 404, and nothing is
    // recorded: writing rows for arbitrary URLs would let anyone fill the table.
    if (!connection || connection.provider_key !== providerKey) {
      return json({ error: 'Webhook não reconhecido.' }, 404);
    }

    const { data: webhookSecret } = await admin
      .from('integration_webhook_secrets')
      .select('secret')
      .eq('connection_id', connection.id)
      .eq('company_id', connection.company_id)
      .maybeSingle<{ secret: string }>();

    // ── 2. Authenticity ────────────────────────────────────────────────────
    const signatureHeader = firstHeader(req, SIGNATURE_HEADERS);
    const timestampHeader = firstHeader(req, TIMESTAMP_HEADERS);

    // The HMAC is computed BEFORE verifyWebhook, which is synchronous while
    // WebCrypto is not. An empty string when no secret exists means the signature
    // comparison cannot accidentally succeed, and verifyWebhook short-circuits on
    // the missing secret before ever comparing.
    const expectedHmac = webhookSecret?.secret
      ? await hmacSha256Hex(signaturePayload((timestampHeader ?? '').trim(), rawBody), webhookSecret.secret)
      : '';

    const verification = verifyWebhook({
      rawBody,
      signatureHeader,
      timestampHeader,
      // Comparison still happens inside verifyWebhook, in constant time.
      computeHmac: () => expectedHmac,
      secret: webhookSecret?.secret ?? null,
      nowMs: Date.now(),
    });

    if (!verification.ok) {
      const { rejection } = verification;
      console.log(
        JSON.stringify(
          buildSafeLog({
            event: 'webhook.rejected',
            connectionId: connection.id,
            provider: providerKey,
            status: rejection.status,
            errorKind: rejection.code,
            message: rejection.message,
          })
        )
      );
      // Nothing is recorded for an unauthenticated delivery: an attacker must not be
      // able to write audit rows by sending garbage.
      return json({ error: rejection.message, code: rejection.code }, rejection.status);
    }

    // ── 3. Identity and replay ─────────────────────────────────────────────
    const payloadHash = await sha256Hex(rawBody);

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      // A signed body that is not JSON is still authentic — recorded and ignored
      // rather than retried, since re-sending it will not make it parse.
      parsed = null;
    }

    const eventType =
      (parsed?.topic as string | undefined) ??
      (parsed?.type as string | undefined) ??
      (parsed?.event as string | undefined) ??
      null;

    const { externalEventId, source } = eventIdentity({
      providerEventId:
        firstHeader(req, EVENT_ID_HEADERS) ??
        (parsed?.id as string | undefined) ??
        (parsed?.event_id as string | undefined),
      payloadHash,
    });

    const willSync = topicTriggersSync(eventType);

    const { data: inserted, error: insertError } = await admin
      .from('integration_webhook_events')
      .insert({
        company_id: connection.company_id,
        connection_id: connection.id,
        provider_key: providerKey,
        event_type: eventType,
        external_event_id: externalEventId,
        // Body kept only while it may still be needed; pruned by cron after the
        // retention window (migration 045).
        payload: willSync ? parsed : null,
        payload_hash: payloadHash,
        signature_header: signatureHeader,
        provider_timestamp: new Date(verification.timestampMs).toISOString(),
        signature_valid: true,
        status: willSync ? 'received' : 'ignored',
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (insertError) {
      if (isDuplicateEventError(insertError)) {
        // Replay protection firing. Correct behaviour, and 200 so the provider stops
        // retrying something already handled.
        console.log(
          JSON.stringify(
            buildSafeLog({
              event: 'webhook.duplicate',
              connectionId: connection.id,
              provider: providerKey,
              message: `Evento já processado (${source}).`,
            })
          )
        );
        return json({ ok: true, duplicate: true });
      }
      return json({ error: 'Falha ao registrar o evento.' }, 500);
    }

    if (!willSync) {
      return json({ ok: true, ignored: true, reason: 'Tópico não aciona sincronização de estoque.' });
    }

    // ── 4. Enqueue, never execute ──────────────────────────────────────────
    // A webhook has a short timeout; a multi-page sync inline would time out, get
    // retried, and duplicate work. One pending job per connection: a burst of
    // deliveries must not become a queue of identical syncs.
    const { data: existing } = await admin
      .from('integration_sync_runs')
      .select('id')
      .eq('connection_id', connection.id)
      .in('status', ['pending', 'running'])
      .limit(1);

    let jobId: string | null = existing?.[0]?.id ?? null;

    if (jobId == null) {
      const { data: job, error: jobError } = await admin
        .from('integration_sync_runs')
        .insert({
          company_id: connection.company_id,
          connection_id: connection.id,
          sync_type: 'webhook',
          direction: 'inbound',
          entity_type: 'stock',
          trigger_source: 'webhook',
          status: 'pending',
        })
        .select('id')
        .maybeSingle<{ id: string }>();

      if (jobError) return json({ error: 'Falha ao agendar a sincronização.' }, 500);
      jobId = job?.id ?? null;
    }

    await admin
      .from('integration_webhook_events')
      .update({ job_id: jobId, status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', inserted!.id);

    console.log(
      JSON.stringify(
        buildSafeLog({
          event: 'webhook.accepted',
          connectionId: connection.id,
          provider: providerKey,
          jobId,
          message: eventType,
          context: { eventIdSource: source, coalescedIntoExistingJob: existing?.length ? true : false },
        })
      )
    );

    return json({ ok: true, jobId });
  } catch (thrown) {
    // Never echo the thrown value: it can carry headers or body content.
    console.log(
      JSON.stringify(
        buildSafeLog({
          event: 'webhook.error',
          connectionId,
          provider: providerKey,
          message: thrown instanceof Error ? thrown.message : 'Erro inesperado.',
        })
      )
    );
    return json({ error: 'Erro interno.' }, 500);
  }
});
