import { describe, expect, it } from 'vitest';

// Mesmo mecanismo de taskMigration.test.ts/taskNotificationMigration.test.ts:
// sem um Postgres para apontar, a forma honesta de conferir que a barreira
// da Central de Execução Operacional não ficou só na UI é ler o SQL e
// confirmar que a validação está na função/policy.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const SQL = MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('task_operational_foundation')) ?? ''] ?? '';

function functionBody(name: string): string {
  const start = SQL.indexOf(`FUNCTION public.${name}(`);
  if (start === -1) return '';
  const end = SQL.indexOf('$fn$;', start);
  return end === -1 ? '' : SQL.slice(start, end);
}

describe('migration 072 — nada destrutivo: enums só crescem, colunas só se somam', () => {
  it('tasks.status mantém todo/in_progress/done/cancelled e soma paused/blocked/validated', () => {
    const constraint = SQL.slice(SQL.indexOf('ADD CONSTRAINT tasks_status_check'), SQL.indexOf(';', SQL.indexOf('ADD CONSTRAINT tasks_status_check')));
    ['todo', 'in_progress', 'paused', 'blocked', 'done', 'validated', 'cancelled'].forEach(v => expect(constraint).toContain(`'${v}'`));
  });

  it('task_assignees.status mantém todo/in_progress/done e soma paused/blocked', () => {
    const constraint = SQL.slice(SQL.indexOf('ADD CONSTRAINT task_assignees_status_check'), SQL.indexOf(';', SQL.indexOf('ADD CONSTRAINT task_assignees_status_check')));
    ['todo', 'in_progress', 'paused', 'blocked', 'done'].forEach(v => expect(constraint).toContain(`'${v}'`));
  });

  it('todas as colunas novas usam ADD COLUMN IF NOT EXISTS — nunca DROP/RENAME COLUMN', () => {
    expect(SQL).not.toMatch(/DROP COLUMN/);
    expect(SQL).not.toMatch(/RENAME COLUMN/);
    expect(SQL.match(/ADD COLUMN IF NOT EXISTS/g)?.length ?? 0).toBeGreaterThan(10);
  });
});

describe('migration 072 — task_set_my_status recusa transição a partir de pausada/bloqueada', () => {
  it('exige retomar/desbloquear antes de mudar o status pela via comum', () => {
    const body = functionBody('task_set_my_status');
    expect(body).toMatch(/v_current_status IN \('paused', 'blocked'\) THEN\s*\n\s*RAISE EXCEPTION/);
  });

  it('recusa alterar tarefa cancelada ou já validada', () => {
    const body = functionBody('task_set_my_status');
    expect(body).toMatch(/v_task_status IN \('cancelled', 'validated'\)/);
  });
});

describe('migration 072 — pausa/retomada só a própria participação e só nos estados certos', () => {
  it('task_pause_my_status só parte de in_progress', () => {
    const body = functionBody('task_pause_my_status');
    expect(body).toMatch(/v_current_status <> 'in_progress' THEN RAISE EXCEPTION/);
    expect(body).toMatch(/WHERE task_id = p_task_id AND user_id = v_uid/);
  });

  it('task_resume_my_status só parte de paused', () => {
    const body = functionBody('task_resume_my_status');
    expect(body).toMatch(/v_current_status <> 'paused' THEN RAISE EXCEPTION/);
  });

  it('pausa respeita task_module_settings.pause_note_required', () => {
    const body = functionBody('task_pause_my_status');
    expect(body).toMatch(/pause_note_required INTO v_note_required FROM task_module_settings/);
    expect(body).toMatch(/Informe o motivo da pausa/);
  });
});

describe('migration 072 — bloqueio exige motivo válido e "outro" exige descrição', () => {
  it('recusa motivo fora da lista padronizada', () => {
    const body = functionBody('task_block_my_status');
    ['falta_estoque', 'produto_nao_localizado', 'divergencia_sistema', 'endereco_bloqueado', 'material_avariado',
      'equipamento_indisponivel', 'sistema_indisponivel', 'aguardando_decisao', 'dependencia_outra_equipe',
      'falta_informacao', 'outro'].forEach(r => expect(body).toContain(`'${r}'`));
    expect(body).toMatch(/RAISE EXCEPTION 'Motivo de bloqueio inválido\.'/);
  });

  it('"outro" exige nota preenchida', () => {
    const body = functionBody('task_block_my_status');
    expect(body).toMatch(/p_reason = 'outro' AND \(p_note IS NULL OR btrim\(p_note\) = ''\)/);
  });

  it('não bloqueia tarefa já concluída, cancelada/validada, nem já bloqueada', () => {
    const body = functionBody('task_block_my_status');
    expect(body).toMatch(/v_task_status IN \('cancelled', 'validated'\)/);
    expect(body).toMatch(/v_current_status = 'blocked' THEN RAISE EXCEPTION/);
    expect(body).toMatch(/v_current_status = 'done' THEN RAISE EXCEPTION/);
  });

  it('valida que o responsável esperado pertence à mesma empresa', () => {
    const body = functionBody('task_block_my_status');
    expect(body).toMatch(/p_expected_resolver AND company_id = v_company/);
  });
});

describe('migration 072 — desbloqueio: a própria pessoa ou a gestão (painel de exceções)', () => {
  it('só gestão pode desbloquear em nome de outro responsável', () => {
    const body = functionBody('task_unblock_status');
    expect(body).toMatch(/p_user_id <> v_uid AND v_role NOT IN \('owner', 'admin', 'manager'\)/);
  });

  it('só desbloqueia quem estava de fato bloqueado', () => {
    const body = functionBody('task_unblock_status');
    expect(body).toMatch(/v_current_status <> 'blocked' THEN RAISE EXCEPTION/);
  });

  it('limpa os campos de bloqueio ao desbloquear', () => {
    const body = functionBody('task_unblock_status');
    expect(body).toMatch(/block_reason = NULL, block_note = NULL, blocked_at = NULL, blocked_by = NULL/);
  });
});

describe('migration 072 — validação e reabertura são decisão da liderança, não do responsável', () => {
  it('task_validate exige papel de gestão, tarefa concluída e requires_validation=true', () => {
    const body = functionBody('task_validate');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\)/);
    expect(body).toMatch(/NOT v_task\.requires_validation THEN RAISE EXCEPTION/);
    expect(body).toMatch(/v_task\.status <> 'done' THEN RAISE EXCEPTION/);
  });

  it('task_reopen exige motivo, só a partir de concluída/validada, e contabiliza reopened_count', () => {
    const body = functionBody('task_reopen');
    expect(body).toMatch(/p_reason IS NULL OR btrim\(p_reason\) = ''/);
    expect(body).toMatch(/v_task\.status NOT IN \('done', 'validated'\) THEN RAISE EXCEPTION/);
    expect(body).toMatch(/reopened_count = reopened_count \+ 1/);
  });

  it('reabertura de tarefa pessoal só pelo criador; corporativa só pela gestão', () => {
    const body = functionBody('task_reopen');
    expect(body).toMatch(/v_task\.created_by <> v_uid THEN RAISE EXCEPTION 'Somente o criador pode reabrir/);
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\) THEN RAISE EXCEPTION 'Somente gestores podem reabrir/);
  });
});

describe('migration 072 — trigger de agregação nunca sobrescreve cancelled NEM validated', () => {
  it('guarda de saída cobre os dois estados', () => {
    const body = functionBody('task_assignees_recompute_status');
    expect(body).toMatch(/v_current_status IN \('cancelled', 'validated'\) THEN\s*\n\s*RETURN NULL/);
  });

  it('prioridade do agregado: bloqueada > pausada > em execução > a fazer', () => {
    const body = functionBody('task_assignees_recompute_status');
    const caseStart = body.indexOf('status = CASE');
    const caseBlock = body.slice(caseStart, body.indexOf('END', caseStart));
    const orderOf = (needle: string) => caseBlock.indexOf(needle);
    expect(orderOf("WHEN v_blocked > 0 THEN 'blocked'")).toBeLessThan(orderOf("WHEN v_paused > 0 THEN 'paused'"));
    expect(orderOf("WHEN v_paused > 0 THEN 'paused'")).toBeLessThan(orderOf("WHEN v_started > 0 THEN 'in_progress'"));
  });
});

describe('migration 072 — task_bulk_assign exige gestão e valida empresa (mesmo padrão de task_create)', () => {
  it('exige owner/admin/manager', () => {
    const body = functionBody('task_bulk_assign');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\) THEN RAISE EXCEPTION 'Somente gestores podem distribuir/);
  });

  it('valida que todos os responsáveis pertencem à empresa antes de inserir', () => {
    const body = functionBody('task_bulk_assign');
    expect(body).toMatch(/WHERE id = ANY\(p_assignee_ids\) AND company_id = v_company/);
  });

  it('não duplica responsável já existente na tarefa (mesma checagem NOT EXISTS de task_create)', () => {
    const body = functionBody('task_bulk_assign');
    expect(body).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM task_assignees WHERE task_id = v_task_id AND user_id = u\)/);
  });
});

describe('migration 072 — task_module_settings só a gestão altera; helpers de segmento nunca expostos', () => {
  it('sem policy de INSERT/UPDATE direto em task_module_settings — só a RPC', () => {
    expect(SQL).not.toMatch(/CREATE POLICY "task_module_settings_(insert|update)"/);
  });

  it('task_module_settings_upsert exige papel de gestão', () => {
    const body = functionBody('task_module_settings_upsert');
    expect(body).toMatch(/v_role NOT IN \('owner', 'admin', 'manager'\)/);
  });

  it('helpers de segmento de tempo são revogados até de authenticated — só uso interno', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.task_close_open_time_segment\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.task_open_time_segment\(uuid, uuid, uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
  });
});

describe('migration 072 — task_time_segments é append-only para o cliente', () => {
  it('só tem policy de SELECT — todo INSERT/UPDATE passa pelos helpers internos', () => {
    expect(SQL).toMatch(/CREATE POLICY "task_time_segments_select"/);
    expect(SQL).not.toMatch(/CREATE POLICY "task_time_segments_(insert|update)"/);
  });

  it('select usa o mesmo helper de visibilidade das outras tabelas satélite', () => {
    expect(SQL).toMatch(/CREATE POLICY "task_time_segments_select" ON task_time_segments FOR SELECT TO authenticated\s*\n\s*USING \(task_is_visible_to_me\(task_id\)\)/);
  });
});

describe('migration 072 — task_templates é catálogo global somente leitura', () => {
  it('select liberado para authenticated, sem policy de escrita', () => {
    expect(SQL).toMatch(/CREATE POLICY "task_templates_select" ON task_templates FOR SELECT TO authenticated USING \(true\)/);
    expect(SQL).not.toMatch(/CREATE POLICY "task_templates_(insert|update|delete)"/);
  });

  it('semeia os 13 modelos do pedido', () => {
    ['cyclic_inventory', 'address_audit', 'replenishment', 'receiving', 'conference', 'pending_picking',
      'damage_handling', 'organization_5s', 'supply_count', 'equipment_check', 'divergence_handling',
      'shift_closing', 'generic'].forEach(key => expect(SQL).toContain(`'${key}'`));
  });

  it('tool_key só referencia rotas reais confirmadas na análise (full-manager/nfe-conference/spreadsheet-comparator)', () => {
    const insertBlock = SQL.slice(SQL.indexOf('INSERT INTO task_templates'), SQL.indexOf('ON CONFLICT (key) DO NOTHING'));
    const toolKeys = [...insertBlock.matchAll(/'(full-manager|nfe-conference|spreadsheet-comparator|label-generator|barcode-lab|cubagem|embalagem)'/g)].map(m => m[1]);
    toolKeys.forEach(k => expect(['full-manager', 'nfe-conference', 'spreadsheet-comparator', 'label-generator', 'barcode-lab']).toContain(k));
  });
});

describe('migration 072 — grants: só authenticated, nunca anon/service_role', () => {
  it('toda GRANT EXECUTE das RPCs novas é só para authenticated', () => {
    const grants = SQL.match(/GRANT EXECUTE ON FUNCTION public\.task_\w+\([^)]*\) TO \w+/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    grants.forEach(g => expect(g).toMatch(/TO authenticated$/));
  });

  it('nenhum GRANT/REVOKE real (não comentário) concede algo a service_role', () => {
    const grantsAndRevokes = SQL.match(/^(GRANT|REVOKE)[^\n]*/gm) ?? [];
    expect(grantsAndRevokes.length).toBeGreaterThan(0);
    grantsAndRevokes.forEach(stmt => expect(stmt).not.toMatch(/service_role/));
  });
});
