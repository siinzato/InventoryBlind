import { describe, expect, it } from 'vitest';

// Mesmo mecanismo já usado por physicalCountAdmin.test.ts: sem um Postgres
// para apontar, a forma honesta de verificar que uma RPC privilegiada recusa
// papel errado, empresa errada ou evento não suportado é conferir que a
// barreira está escrita na função. Não substitui um teste de integração —
// pega a remoção acidental de uma barreira, que é o risco realista aqui.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function migrationText(fragment: string): string {
  const path = Object.keys(MIGRATIONS).find(p => p.includes(fragment));
  return path ? MIGRATIONS[path] : '';
}

/** Corpo de uma função, do CREATE OR REPLACE até o fim do bloco ($$; ou $fn$;). */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION ${name}(`) !== -1
    ? sql.indexOf(`FUNCTION ${name}(`)
    : sql.indexOf(`FUNCTION public.${name}(`);
  if (start === -1) return '';
  const endDollar = sql.indexOf('$$;', start);
  const endFn = sql.indexOf('$fn$;', start);
  const candidates = [endDollar, endFn].filter(i => i !== -1);
  if (candidates.length === 0) return '';
  return sql.slice(start, Math.min(...candidates));
}

const M063 = migrationText('advanced_settings_api_keys');
// Renomeado localmente pra 064b: outra sessão já usava 064 para
// legal_acceptances neste mesmo dia — busca pelo fragmento do nome, não pelo
// prefixo numérico, então uma renumeração futura não quebra o teste.
const M064 = migrationText('advanced_settings_webhooks');
const M065 = migrationText('advanced_settings_webhook_hooks');

describe('migration 063 — api_keys', () => {
  it('nunca cria uma coluna para guardar a chave em texto puro', () => {
    // Só key_hash e key_prefix — nenhuma coluna "key" ou "plaintext" na tabela.
    const tableStart = M063.indexOf('CREATE TABLE IF NOT EXISTS api_keys');
    const tableEnd = M063.indexOf(');', tableStart);
    const tableDdl = M063.slice(tableStart, tableEnd);
    expect(tableDdl).toContain('key_hash');
    expect(tableDdl).not.toMatch(/plaintext|raw_key/i);
  });

  it('api_key_create exige owner ou admin', () => {
    const body = functionBody(M063, 'api_key_create');
    expect(body).toMatch(/get_my_role\(\)/);
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
  });

  it('api_key_create resolve company_id do servidor, nunca de um parâmetro', () => {
    const body = functionBody(M063, 'api_key_create');
    expect(body).toMatch(/get_my_company_id\(\)/);
    expect(body).not.toMatch(/p_company_id/);
  });

  it('api_key_revoke exige owner ou admin e escopa por empresa', () => {
    const body = functionBody(M063, 'api_key_revoke');
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/AND company_id = v_company/);
  });

  it('RLS de SELECT exige owner/admin da própria empresa', () => {
    expect(M063).toMatch(/company_id::text = get_my_company_id\(\) AND get_my_role\(\) IN \('owner','admin'\)/);
  });
});

describe('migration 064 — webhooks', () => {
  it('segredo do webhook fica em tabela sem policy de SELECT para authenticated', () => {
    expect(M064).toMatch(/REVOKE ALL ON company_webhook_secrets FROM authenticated, anon/);
  });

  it('company_webhook_create valida HTTPS e a lista fechada de eventos', () => {
    const body = functionBody(M064, 'company_webhook_create');
    expect(body).toMatch(/https:\/\//);
    expect(body).toMatch(/company_webhook_allowed_events\(\)/);
  });

  it('company_webhook_enqueue_event nunca é executável pelo cliente autenticado', () => {
    expect(M064).toMatch(/REVOKE ALL ON FUNCTION company_webhook_enqueue_event\(uuid, text, jsonb\) FROM PUBLIC, anon, authenticated/);
  });

  it('reentrega é limitada a 3 tentativas, nunca um loop infinito', () => {
    const body = functionBody(M064, 'company_webhook_record_attempt');
    expect(body).toMatch(/v_attempts >= 3/);
    expect(body).toMatch(/'exhausted'/);
  });

  it('a fila usa FOR UPDATE SKIP LOCKED (dois workers nunca pegam a mesma entrega)', () => {
    const body = functionBody(M064, 'company_webhook_claim_due_deliveries');
    expect(body).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it('segredo do cron nunca é executável por authenticated/anon', () => {
    expect(M064).toMatch(/REVOKE ALL ON FUNCTION company_webhook_verify_cron_secret\(text\) FROM PUBLIC, anon, authenticated/);
  });
});

describe('migration 065 — hooks nas RPCs de contagem física', () => {
  it('pc_finalize_session enfileira o evento sem poder derrubar a finalização', () => {
    const body = functionBody(M065, 'public.pc_finalize_session');
    expect(body).toMatch(/company_webhook_enqueue_event/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*NULL;/);
  });

  it('pc_approve_session enfileira o evento sem poder derrubar a aprovação', () => {
    const body = functionBody(M065, 'public.pc_approve_session');
    expect(body).toMatch(/company_webhook_enqueue_event/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*NULL;/);
  });

  it('preserva a checagem de empresa/exclusão já existente (não regride a 059)', () => {
    for (const fn of ['public.pc_finalize_session', 'public.pc_approve_session']) {
      const body = functionBody(M065, fn);
      expect(body).toMatch(/Session belongs to another company/);
      expect(body).toMatch(/Esta contagem foi removida do histórico\./);
    }
  });
});
