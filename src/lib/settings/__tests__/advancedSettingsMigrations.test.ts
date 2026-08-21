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
const M067 = migrationText('advanced_settings_api_key_lifecycle');
const M068 = migrationText('advanced_settings_webhook_maturity');

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

describe('migration 067 — ciclo de vida da chave de API', () => {
  it('continua sem gravar a chave em texto puro', () => {
    expect(M067).not.toMatch(/ADD COLUMN[^;]*plaintext|ADD COLUMN[^;]*raw_key/i);
  });

  it('api_key_create exige owner/admin e resolve a empresa no servidor', () => {
    const body = functionBody(M067, 'api_key_create');
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/get_my_company_id\(\)/);
    expect(body).not.toMatch(/p_company_id/);
  });

  it('api_key_create recusa expiração no passado', () => {
    const body = functionBody(M067, 'api_key_create');
    expect(body).toMatch(/p_expires_at <= now\(\)/);
  });

  it('parâmetros novos têm DEFAULT (uma chamada só com p_name continua válida)', () => {
    expect(M067).toMatch(/p_description text\s+DEFAULT NULL/);
    expect(M067).toMatch(/p_expires_at\s+timestamptz DEFAULT NULL/);
  });

  it('api_key_delete só alcança chave já revogada, da própria empresa', () => {
    const body = functionBody(M067, 'api_key_delete');
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/company_id = v_company/);
    expect(body).toMatch(/revoked_at IS NOT NULL/);
  });
});

describe('migration 068 — maturidade dos webhooks', () => {
  it('mantém os dois eventos da v1 no catálogo (nenhum webhook existente perde evento)', () => {
    const body = functionBody(M068, 'company_webhook_allowed_events');
    expect(body).toMatch(/'physical_count\.finalized'/);
    expect(body).toMatch(/'physical_count\.approved'/);
  });

  it('reentrega continua limitada — 5 tentativas, nunca um loop infinito', () => {
    const body = functionBody(M068, 'company_webhook_record_attempt');
    expect(body).toMatch(/v_max_attempts constant integer := 5/);
    expect(body).toMatch(/'exhausted'/);
  });

  it('falha não recuperável encerra a entrega em vez de retentar', () => {
    const body = functionBody(M068, 'company_webhook_record_attempt');
    expect(body).toMatch(/coalesce\(p_retryable, true\) = false/);
  });

  it('record_attempt nunca é executável pelo cliente autenticado', () => {
    expect(M068).toMatch(/REVOKE ALL ON FUNCTION company_webhook_record_attempt\(uuid, boolean, integer, text, integer, boolean\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
  });

  it('a entrega de teste nasce adiada, para o cron não duplicar o disparo imediato', () => {
    const body = functionBody(M068, 'company_webhook_send_test');
    expect(body).toMatch(/next_attempt_at/);
    expect(body).toMatch(/interval '30 seconds'/);
    // A barreira de papel/empresa da 064 continua no lugar.
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/id = p_id AND company_id = v_company/);
  });

  it('o teste síncrono revalida papel/empresa e nunca alcança entrega de evento real', () => {
    const body = functionBody(M068, 'company_webhook_claim_test_delivery');
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/d\.company_id = v_company/);
    expect(body).toMatch(/d\.event_type = 'webhook\.test'/);
  });

  it('company_webhook_set_active escopa por empresa', () => {
    const body = functionBody(M068, 'company_webhook_set_active');
    expect(body).toMatch(/NOT IN \('owner','admin'\)/);
    expect(body).toMatch(/AND company_id = v_company/);
  });

  it('os hooks novos nunca podem derrubar a operação principal', () => {
    for (const fn of ['public.pc_start_session', 'public.pc_admin_delete_session', 'public.pc_finalize_session']) {
      const body = functionBody(M068, fn);
      expect(body).toMatch(/company_webhook_enqueue_event/);
      expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s*\n\s*NULL;/);
    }
  });

  it('preserva as barreiras já existentes nas RPCs redeclaradas', () => {
    expect(functionBody(M068, 'public.pc_start_session')).toMatch(/Session belongs to another company/);
    expect(functionBody(M068, 'public.pc_admin_delete_session')).toMatch(/Esta contagem pertence a outra empresa\./);
    expect(functionBody(M068, 'public.pc_admin_delete_session')).toMatch(/A justificativa precisa ter pelo menos 5 caracteres\./);
    expect(functionBody(M068, 'public.pc_finalize_session')).toMatch(/Cannot finalize: % item\(s\) not yet counted/);
  });
});
