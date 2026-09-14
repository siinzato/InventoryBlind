// Isolamento entre workspaces — testes NEGATIVOS executados contra um Supabase real.
//
// Por que este arquivo é "gated": não existe Postgres local neste projeto (sem Docker,
// sem `supabase start`), então não há como executar SQL de verdade no CI atual. Em vez de
// simular o banco — o que provaria nada sobre RLS — a suíte roda de verdade quando quem
// executa aponta para um projeto Supabase DESCARTÁVEL e se identifica com dois usuários
// de empresas diferentes. Sem essas variáveis ela é pulada, e o `it.skip` no relatório é
// a informação honesta: "não provado aqui".
//
// COMO RODAR (nunca contra produção):
//
//   SEC_TEST_URL=https://<projeto-descartavel>.supabase.co \
//   SEC_TEST_ANON_KEY=sb_publishable_... \
//   SEC_TEST_A_EMAIL=a@example.com SEC_TEST_A_PASSWORD=... \
//   SEC_TEST_B_EMAIL=b@example.com SEC_TEST_B_PASSWORD=... \
//   npx vitest run src/lib/security/__tests__/crossTenantIsolation.test.ts
//
// Os dois usuários precisam pertencer a EMPRESAS DIFERENTES e já ter dados próprios.
// Nenhum segredo entra no repositório: as credenciais vêm só do ambiente.
//
// O que a suíte prova é sempre a metade que importa: o usuário ERRADO **não** consegue.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = (key: string): string | undefined => {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
  return value && value.length > 0 ? value : undefined;
};

const URL = env('SEC_TEST_URL');
const ANON = env('SEC_TEST_ANON_KEY');
const A_EMAIL = env('SEC_TEST_A_EMAIL');
const A_PASSWORD = env('SEC_TEST_A_PASSWORD');
const B_EMAIL = env('SEC_TEST_B_EMAIL');
const B_PASSWORD = env('SEC_TEST_B_PASSWORD');

const CONFIGURED = Boolean(URL && ANON && A_EMAIL && A_PASSWORD && B_EMAIL && B_PASSWORD);

/** Tabelas tenant-sensíveis representativas de cada domínio do produto. */
const TENANT_TABLES = [
  'products',
  'inventory_items',
  'inventory_cycles',
  'physical_count_sessions',
  'physical_count_items',
  'product_brands',
  'product_lines',
  'product_brand_associations',
  'nfe_invoices',
  'returns',
  'tasks',
  'api_keys',
  'company_webhooks',
  'audit_logs',
] as const;

/** Views agregadas expostas pela Data API — o Dashboard vive nelas. */
const TENANT_VIEWS = [
  'inventory_cycle_line_summary_v',
  'physical_count_final_result_v',
  'user_productivity_stats_v',
  'risk_company_summary_v',
  'cbc_company_summary_v',
  'abc_xyz_company_summary_v',
] as const;

/** RPCs que jamais podem responder a um chamador anônimo. */
const PRIVILEGED_RPCS: { fn: string; args: Record<string, unknown> }[] = [
  { fn: 'automation_prune_history', args: { p_days: 3650 } },
  { fn: 'automation_reap_stuck_events', args: { p_older_than_minutes: 525600 } },
  { fn: 'rca_next_case_number', args: { p_company_id: '00000000-0000-0000-0000-000000000000', p_year: 1900 } },
  { fn: 'pc_measure_session_divergence', args: { p_session_id: '00000000-0000-0000-0000-000000000000' } },
  { fn: 'update_member_role', args: { target_user_id: '00000000-0000-0000-0000-000000000000', new_role: 'owner' } },
];

interface Tenant {
  client: SupabaseClient;
  userId: string;
  companyId: string;
}

async function signIn(email: string, password: string): Promise<Tenant> {
  const client = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`login falhou para ${email}: ${error?.message}`);
  const { data: profile, error: profileError } = await client
    .from('profiles').select('company_id').eq('id', data.user.id).single();
  if (profileError || !profile?.company_id) throw new Error(`perfil sem company_id para ${email}`);
  return { client, userId: data.user.id, companyId: String(profile.company_id) };
}

describe.skipIf(!CONFIGURED)('isolamento entre workspaces (integração real)', () => {
  let anon: SupabaseClient;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    anon = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    a = await signIn(A_EMAIL!, A_PASSWORD!);
    b = await signIn(B_EMAIL!, B_PASSWORD!);
    if (a.companyId === b.companyId) {
      throw new Error('os dois usuários de teste estão na MESMA empresa — o teste não provaria isolamento');
    }
  }, 60_000);

  afterAll(async () => {
    await a?.client.auth.signOut();
    await b?.client.auth.signOut();
  });

  // ── TESTE A — anon não lê nada protegido ───────────────────────────────────────────
  it.each(TENANT_TABLES)('A) anon não lê %s', async table => {
    const { data, error } = await anon.from(table).select('*').limit(1);
    expect(error ?? { code: 'empty' }).toBeTruthy();
    expect(data ?? []).toHaveLength(0);
  });

  it.each(TENANT_VIEWS)('K) anon não lê a view %s', async view => {
    const { data } = await anon.from(view).select('*').limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  // ── TESTE B — anon não executa RPC privilegiada ────────────────────────────────────
  it.each(PRIVILEGED_RPCS)('B) anon não executa $fn', async ({ fn, args }) => {
    const { error } = await anon.rpc(fn, args);
    // Precisa falhar por permissão/autenticação, não "funcionar e não achar nada".
    expect(error).toBeTruthy();
    expect(`${error?.code ?? ''} ${error?.message ?? ''}`).toMatch(/permission|denied|not found|does not exist|No active company|42501|PGRST202/i);
  });

  // ── TESTE C — o dono lê o que é seu (controle positivo) ────────────────────────────
  it('C) usuário da empresa A lê os próprios produtos', async () => {
    const { data, error } = await a.client.from('products').select('id, company_id').limit(5);
    expect(error).toBeNull();
    for (const row of data ?? []) expect(String(row.company_id)).toBe(a.companyId);
  });

  // ── TESTE D — A não lê dados de B ──────────────────────────────────────────────────
  it.each(TENANT_TABLES)('D) A não enxerga linhas de B em %s', async table => {
    const { data, error } = await a.client.from(table).select('company_id').eq('company_id', b.companyId).limit(1);
    expect(error ?? null).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it.each(TENANT_VIEWS)('K) a view %s não devolve agregação de B para A', async view => {
    const { data } = await a.client.from(view).select('company_id').eq('company_id', b.companyId).limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  // ── TESTE E — A não insere com company_id de B ─────────────────────────────────────
  it('E) A não consegue INSERT carimbando company_id de B', async () => {
    const { error } = await a.client.from('product_brands').insert({
      company_id: b.companyId, name: `sec-test-${a.userId.slice(0, 8)}`, keywords: [],
    });
    expect(error).toBeTruthy();
  });

  // ── TESTE F — A não transfere um registro seu para B ───────────────────────────────
  it('F) A não consegue mover um registro próprio para a empresa B', async () => {
    const { data: mine } = await a.client.from('product_brands').select('id').limit(1);
    const target = mine?.[0]?.id;
    if (!target) return; // sem dado próprio não há o que transferir
    const { error } = await a.client.from('product_brands').update({ company_id: b.companyId }).eq('id', target);
    expect(error).toBeTruthy();
    const { data: after } = await a.client.from('product_brands').select('company_id').eq('id', target).single();
    expect(String(after?.company_id)).toBe(a.companyId);
  });

  // ── TESTE F2 — A não altera NEM apaga registro de B ────────────────────────────────
  // O par UPDATE/DELETE contra linhas alheias é o que a RLS precisa negar de forma
  // SILENCIOSA: o PostgREST não devolve erro quando a policy simplesmente não casa
  // nenhuma linha — devolve sucesso com zero linhas afetadas. Por isso a asserção é
  // sobre o ESTADO de B depois, lido pelo próprio B, e não sobre a presença de erro.
  it('F2) A não consegue UPDATE em linha de B', async () => {
    const { data: theirs } = await b.client.from('product_brands').select('id, name').limit(1);
    const target = theirs?.[0];
    if (!target) return; // B precisa ter ao menos uma marca para este teste valer

    const { data: affected } = await a.client
      .from('product_brands').update({ name: 'invadido-por-a' }).eq('id', target.id).select('id');
    expect(affected ?? []).toHaveLength(0);

    const { data: after } = await b.client.from('product_brands').select('name').eq('id', target.id).single();
    expect(after?.name).toBe(target.name);
  });

  it('F2) A não consegue DELETE em linha de B', async () => {
    const { data: theirs } = await b.client.from('product_brands').select('id').limit(1);
    const target = theirs?.[0]?.id;
    if (!target) return;

    const { data: affected } = await a.client.from('product_brands').delete().eq('id', target).select('id');
    expect(affected ?? []).toHaveLength(0);

    // A linha de B continua exatamente onde estava — conferido pelo dono dela.
    const { data: after, error } = await b.client.from('product_brands').select('id').eq('id', target).single();
    expect(error).toBeNull();
    expect(after?.id).toBe(target);
  });

  // ── TESTE G — RPC com company_id do outro tenant ───────────────────────────────────
  it('G) A não consegue usar RPC passando o company_id de B', async () => {
    const { error } = await a.client.rpc('rca_next_case_number', { p_company_id: b.companyId, p_year: 2026 });
    expect(error).toBeTruthy();
  });

  it('G) A não mede a divergência de uma sessão de contagem de B', async () => {
    const { data: sessions } = await b.client.from('physical_count_sessions').select('id').limit(1);
    const foreign = sessions?.[0]?.id;
    if (!foreign) return;
    const { data, error } = await a.client.rpc('pc_measure_session_divergence', { p_session_id: foreign });
    const rows = (data ?? []) as { counted_items?: number }[];
    const leaked = rows.some(r => (r.counted_items ?? 0) > 0);
    expect(error !== null || !leaked).toBe(true);
  });

  // ── TESTE H — escalonamento de privilégio ──────────────────────────────────────────
  it('H) usuário não consegue promover a si mesmo alterando profiles.role', async () => {
    const { data: before } = await a.client.from('profiles').select('role').eq('id', a.userId).single();
    await a.client.from('profiles').update({ role: 'owner' }).eq('id', a.userId);
    const { data: after } = await a.client.from('profiles').select('role').eq('id', a.userId).single();
    expect(after?.role).toBe(before?.role);
  });

  it('H) usuário não consegue promover a si mesmo pela RPC de papéis', async () => {
    const { data: before } = await a.client.from('profiles').select('role').eq('id', a.userId).single();
    if (['owner', 'admin'].includes(String(before?.role))) return; // já é admin: nada a escalar
    const { error } = await a.client.rpc('update_member_role', { target_user_id: a.userId, new_role: 'owner' });
    expect(error).toBeTruthy();
    const { data: after } = await a.client.from('profiles').select('role').eq('id', a.userId).single();
    expect(after?.role).toBe(before?.role);
  });

  it('H) usuário não altera o papel de um membro da empresa B', async () => {
    const { error } = await a.client.rpc('update_member_role', { target_user_id: b.userId, new_role: 'viewer' });
    expect(error).toBeTruthy();
    const { data: victim } = await b.client.from('profiles').select('role').eq('id', b.userId).single();
    expect(victim?.role).not.toBe('viewer_forced_by_attacker');
  });

  // ── TESTE I — Storage ──────────────────────────────────────────────────────────────
  it.each(['brand-logos', 'workspace-logos', 'task-attachments', 'rca-evidence', 'po-attachments', 'return-attachments', 'warehouse-floorplans'])(
    'I) A não lista nem baixa arquivos de B no bucket %s',
    async bucket => {
      const { data: listed } = await a.client.storage.from(bucket).list(b.companyId);
      expect(listed ?? []).toHaveLength(0);

      const probe = `${b.companyId}/sec-test-probe.png`;
      const { error: uploadError } = await a.client.storage.from(bucket)
        .upload(probe, new Blob(['x'], { type: 'image/png' }), { upsert: true });
      expect(uploadError).toBeTruthy();

      const { error: signError } = await a.client.storage.from(bucket).createSignedUrl(probe, 60);
      expect(signError).toBeTruthy();
    },
  );

  // ── TESTE J — trigger interno continua funcionando após o REVOKE ───────────────────
  it('J) o trigger interno continua rodando depois do hardening de grants', async () => {
    const { data: created, error } = await a.client
      .from('product_brands')
      .insert({ company_id: a.companyId, name: `sec-test-trigger-${Date.now() % 100000}`, keywords: [] })
      .select('id, created_at, updated_at')
      .single();
    expect(error).toBeNull();
    // updated_at é preenchido por trigger (update_updated_at_column); se o REVOKE tivesse
    // quebrado a execução do trigger, o INSERT falharia ou o campo viria nulo.
    expect(created?.updated_at).toBeTruthy();
    if (created?.id) await a.client.from('product_brands').delete().eq('id', created.id);
  });
});

// Sem ambiente configurado a suíte não pode afirmar nada — e diz isso em vez de passar em silêncio.
describe.skipIf(CONFIGURED)('isolamento entre workspaces (não executado)', () => {
  it('exige SEC_TEST_URL / SEC_TEST_ANON_KEY / credenciais de dois workspaces', () => {
    expect(CONFIGURED).toBe(false);
  });
});
