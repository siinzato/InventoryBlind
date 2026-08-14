# Edge Functions — deployment runbook

## Deploy

```bash
# Authenticated endpoints — JWT verification ON (the default).
npx supabase functions deploy integration-sync
npx supabase functions deploy integration-stock-write

# Webhook endpoint — JWT verification OFF, and this flag is REQUIRED.
npx supabase functions deploy integration-webhook --no-verify-jwt
```

### What each one does

| Function | Direction | Notes |
|---|---|---|
| `integration-sync` | Provider → InventoryBlind | Reads stock, maps, applies the conflict policy. Refuses outbound with a 409 pointing here. |
| `integration-stock-write` | InventoryBlind → Provider | The **only** path that changes an ERP balance. Sends approved adjustments, one at a time, each re-guarded against a freshly read balance. |
| `integration-webhook` | Provider → InventoryBlind | Verifies, records, enqueues. Never syncs inline. |

`integration-stock-write` is the sensitive one. Three properties worth keeping in
mind before changing it:

- **One adjustment per product per run.** Two approved adjustments on the same
  product are never sent together — the second's assumed balance predates the
  first's effect, so guarding it against the run's opening balance would compound
  both changes. The extras are deferred to the next run, not dropped.
- **Never batched at the provider.** Tiny answers a multi-record write with one
  envelope, so a partial failure cannot be attributed to a record. One call per
  adjustment costs requests and buys knowing which balances changed.
- **`sent` is not `confirmed`.** Sent means the provider accepted it. Confirmation
  is the next inbound sync agreeing the balance matches.

### Why `--no-verify-jwt` on the webhook, and why it is not a security hole

Tiny, Mercado Livre and every other provider deliver webhooks with **no Supabase
JWT** — they have never heard of our auth. With verification on, the platform
answers 401 before our code runs, the provider records a failed delivery, and
after enough failures it disables the subscription. The endpoint would look
deployed and be silently dead.

Turning platform JWT verification off does **not** make the endpoint
unauthenticated. Authentication moves into the function, where it is
provider-appropriate:

1. **HMAC signature** over the raw body, using the per-connection secret from
   `integration_webhook_secrets` (a table with no policy for `authenticated` —
   the browser cannot read it at all).
2. **Freshness window** — 5 minutes, with 1 minute of tolerance for a provider
   clock running ahead.
3. **Uniqueness** — a partial unique index on `payload_hash` makes a replay a
   23505 constraint violation rather than a second execution.

All three are required. A signature alone permits replay; a timestamp alone
permits forgery. This is verified in
`src/lib/integrations/webhooks/__tests__/webhooks.test.ts`.

A delivery that fails verification records **nothing** — an unauthenticated
caller must not be able to write rows into our tables, not even rejection rows,
or the endpoint becomes a way to fill the database for free.

## Required secrets

```bash
npx supabase secrets set --env-file ./supabase/.env.production
```

`integration-sync` reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. The first two are injected by the platform; the
service-role key must be set. It is used for exactly one query — reading
`integration_credentials` — and never for the data path, because `service_role`
bypasses RLS.

## Scheduling

Active. Migration 046 installed `pg_cron` and registered three jobs:

| Job | Schedule | What it does |
|---|---|---|
| `integration-enqueue-due-syncs` | `*/5 * * * *` | Creates a pending sync run for every connection whose interval has elapsed. |
| `integration-reap-stuck-jobs` | `*/15 * * * *` | Releases runs stuck in `running` past 30 minutes. Without it, one dead worker blocks that connection forever. |
| `integration-prune-webhook-payloads` | `17 3 * * *` | Drops processed webhook bodies after 7 days. The hash and event id stay, so replay protection still covers old deliveries. |

The per-connection cadence lives in `integration_connections.sync_interval_minutes`;
the 5-minute job is only how often we look at the clock.

Check state with:

```sql
select jobname, schedule, active from cron.job order by jobname;
select jobname, status, start_time, return_message
  from cron.job_run_details order by start_time desc limit 20;
```

Migration 045 still guards its own cron block behind an `IF EXISTS` check, so it
remains safe to apply to a project without the extension.
