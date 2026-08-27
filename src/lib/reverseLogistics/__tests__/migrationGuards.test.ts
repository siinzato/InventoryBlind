import { describe, expect, it } from 'vitest';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_083 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('083_reverse_logistics')) ?? ''] ?? '';

const MIGRATION_084 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('084_reverse_logistics_phase2')) ?? ''] ?? '';

const MIGRATION_085 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('085_reverse_logistics_tiny_sync')) ?? ''] ?? '';

const MIGRATION_086 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('086_reverse_logistics_nfe_xml')) ?? ''] ?? '';

const MIGRATION_090 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('090_returns_origin_channel')) ?? ''] ?? '';

const MIGRATION_091 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('091_return_functions_grant_cleanup')) ?? ''] ?? '';

const MIGRATION_092 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('092_returns_origin_guard_search_path')) ?? ''] ?? '';

describe('migration 083 — logística reversa', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_083.length).toBeGreaterThan(0);
  });

  it('cria as 4 tabelas e as 3 RPCs', () => {
    for (const table of ['returns', 'return_items', 'return_attachments', 'return_stock_movements']) {
      expect(MIGRATION_083).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(MIGRATION_083).toContain('CREATE OR REPLACE FUNCTION public.returns_transition_status(');
    expect(MIGRATION_083).toContain('CREATE OR REPLACE FUNCTION public.return_items_set_inspection(');
    expect(MIGRATION_083).toContain('CREATE OR REPLACE FUNCTION public.return_items_decide_destination(');
  });

  it('nenhuma das 4 tabelas novas tem policy de DELETE — nunca uma exclusão definitiva', () => {
    expect(MIGRATION_083).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/);
  });

  it('return_stock_movements não tem policy de INSERT/UPDATE/DELETE para authenticated — só a RPC escreve', () => {
    expect(MIGRATION_083).not.toMatch(/CREATE POLICY "return_stock_movements_(insert|update|delete)"/);
    expect(MIGRATION_083).toContain('CREATE POLICY "return_stock_movements_select"');
  });

  it('cada item só pode gerar uma movimentação — UNIQUE(return_item_id)', () => {
    expect(MIGRATION_083).toContain('CREATE UNIQUE INDEX IF NOT EXISTS return_stock_movements_item_idx ON return_stock_movements (return_item_id)');
  });

  it('a segunda chamada de destinação no mesmo item é rejeitada (trava de idempotência)', () => {
    expect(MIGRATION_083).toContain("IF v_item.destination_status = 'moved' THEN");
    expect(MIGRATION_083).toMatch(/RAISE EXCEPTION 'Este item já teve a destinação processada/);
  });

  it('products.stock_quantity só é escrito dentro do branch restock', () => {
    const stockWrites = [...MIGRATION_083.matchAll(/UPDATE products SET stock_quantity/g)];
    expect(stockWrites).toHaveLength(1);
    const idx = MIGRATION_083.indexOf('UPDATE products SET stock_quantity');
    const before = MIGRATION_083.slice(Math.max(0, idx - 200), idx);
    expect(before).toContain("IF p_destination = 'restock' THEN");
  });

  it("restock sem produto identificado é rejeitado", () => {
    expect(MIGRATION_083).toContain("IF p_destination = 'restock' AND v_item.product_id IS NULL THEN");
  });

  it('a máquina de estados só avança um passo por vez, mais cancelar de qualquer estado não-terminal', () => {
    expect(MIGRATION_083).toContain("(v_status = 'received' AND p_to_status = 'in_conference')");
    expect(MIGRATION_083).toContain("(v_status = 'in_conference' AND p_to_status = 'in_inspection')");
    expect(MIGRATION_083).toContain("(v_status = 'in_inspection' AND p_to_status = 'awaiting_destination')");
    expect(MIGRATION_083).toContain("(v_status = 'awaiting_destination' AND p_to_status = 'finalized')");
    expect(MIGRATION_083).toContain("IF v_status IN ('finalized','cancelled') THEN");
  });

  it('finalizar exige que todos os itens já tenham destinação processada', () => {
    expect(MIGRATION_083).toContain("destination_status <> 'moved'");
    expect(MIGRATION_083).toMatch(/não é possível finalizar/);
  });

  it('justificativa obrigatória (≥5 caracteres) nos 3 pontos exigidos pelo pedido', () => {
    const reasonChecks = [...MIGRATION_083.matchAll(/char_length\(v_reason\) < 5/g)];
    // cancelar, correção de inspeção pós-inspeção, e destinos discard/technical_assistance/return_to_supplier
    expect(reasonChecks.length).toBeGreaterThanOrEqual(3);
  });

  it('correção de inspeção já registrada exige justificativa', () => {
    expect(MIGRATION_083).toContain('v_already_inspected AND char_length(v_reason) < 5');
  });

  it('aprovar retorno ao estoque e aprovar descarte exigem owner/admin/manager', () => {
    expect(MIGRATION_083).toContain("IF p_destination IN ('restock','discard') THEN");
    expect(MIGRATION_083).toContain("v_role NOT IN ('owner','admin','manager')");
  });

  it('cancelar exige owner/admin/manager', () => {
    expect(MIGRATION_083).toMatch(/IF p_to_status = 'cancelled' THEN\s+IF v_role IS NULL OR v_role NOT IN \('owner','admin','manager'\)/);
  });

  it('todas as tabelas usam company_id uuid + get_my_company_id(), não a convenção text legada', () => {
    const matches = [...MIGRATION_083.matchAll(/company_id\s+uuid NOT NULL DEFAULT get_my_company_id\(\)::uuid REFERENCES companies\(id\)/g)];
    // 4 tabelas + 1 menção no comentário de cabeçalho explicando a convenção.
    expect(matches.length).toBe(5);
  });

  it('produtos, vendas, NF-e e ordens de compra são só referenciados por FK opcional, nunca alterados', () => {
    expect(MIGRATION_083).toContain('product_id                  uuid REFERENCES products(id) ON DELETE SET NULL');
    expect(MIGRATION_083).toContain('linked_sale_id          uuid REFERENCES sales_records(id) ON DELETE SET NULL');
    expect(MIGRATION_083).toContain('linked_nfe_invoice_id   uuid REFERENCES nfe_invoices(id) ON DELETE SET NULL');
    expect(MIGRATION_083).toContain('linked_purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL');
    expect(MIGRATION_083).not.toMatch(/ALTER TABLE (products|sales_records|nfe_invoices|purchase_orders)/);
  });

  it('as 3 RPCs são revogadas de anon/PUBLIC e liberadas só para authenticated', () => {
    for (const fn of [
      'returns_transition_status(uuid, text, text)',
      'return_items_set_inspection(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text)',
      'return_items_decide_destination(uuid, text, text)',
    ]) {
      expect(MIGRATION_083).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC`);
      expect(MIGRATION_083).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM anon`);
      expect(MIGRATION_083).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    }
  });

  it('gera auditoria em toda transição de status, inspeção e destinação', () => {
    expect(MIGRATION_083).toContain("'reverse_logistics.status_changed'");
    expect(MIGRATION_083).toContain("'reverse_logistics.cancelled'");
    expect(MIGRATION_083).toContain("'reverse_logistics.item_inspected'");
    expect(MIGRATION_083).toContain("'reverse_logistics.destination_decided'");
  });

  it('bucket de anexos é privado e restrito por pasta de company_id', () => {
    expect(MIGRATION_083).toContain("VALUES ('return-attachments', 'return-attachments', false)");
    expect(MIGRATION_083).toContain("(storage.foldername(name))[1] = get_my_company_id()");
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_083).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe('migration 084 — logística reversa Fase 2', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_084.length).toBeGreaterThan(0);
  });

  it('cria as 9 tabelas novas', () => {
    for (const table of [
      'return_checklist_templates', 'return_checklist_template_items', 'return_item_checklist_responses',
      'return_condition_grades', 'return_destination_rules', 'return_approval_settings',
      'return_approval_requests', 'return_service_orders', 'return_quarantine_holds',
    ]) {
      expect(MIGRATION_084).toContain(`CREATE TABLE ${table} (`);
    }
  });

  it('nenhuma tabela nova tem policy de DELETE — nunca uma exclusão definitiva', () => {
    expect(MIGRATION_084).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/);
  });

  it('respostas de checklist são imutáveis — sem policy de INSERT/UPDATE/DELETE para authenticated', () => {
    expect(MIGRATION_084).not.toMatch(/CREATE POLICY return_item_checklist_responses_(insert|update|delete)/);
    expect(MIGRATION_084).toContain('CREATE POLICY return_item_checklist_responses_select');
  });

  it('índice único parcial permite 1 movimentação transitória além da final, mas nunca 2 finais', () => {
    expect(MIGRATION_084).toContain('ALTER TABLE return_stock_movements ADD COLUMN is_transitional boolean NOT NULL DEFAULT false');
    expect(MIGRATION_084).toContain('CREATE UNIQUE INDEX return_stock_movements_final_item_idx');
    expect(MIGRATION_084).toContain('ON return_stock_movements(return_item_id) WHERE NOT is_transitional');
  });

  it('pedido de aprovação: no máximo 1 pendente por item+tipo (idempotência)', () => {
    expect(MIGRATION_084).toContain('CREATE UNIQUE INDEX return_approval_requests_pending_idx');
    expect(MIGRATION_084).toContain("ON return_approval_requests(return_item_id, approval_type) WHERE status = 'pending'");
  });

  it('hold de quarentena: no máximo 1 aberto por item', () => {
    expect(MIGRATION_084).toContain('CREATE UNIQUE INDEX return_quarantine_holds_open_idx');
    expect(MIGRATION_084).toContain('ON return_quarantine_holds(return_item_id) WHERE released_at IS NULL');
  });

  it('a RPC de lote nunca aceita discard/restock como ação — nem chega a validar esses valores', () => {
    const match = MIGRATION_084.match(/IF p_action NOT IN \(([^)]+)\) THEN/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/discard|restock/);
    expect(match![1]).toContain('assign_responsible');
    expect(match![1]).toContain('send_to_quarantine');
  });

  it('a RPC de lote falha inteira (RAISE EXCEPTION) se qualquer item for inválido — sem aplicação parcial', () => {
    expect(MIGRATION_084).toMatch(/FOREACH v_item_id IN ARRAY p_item_ids LOOP[\s\S]*RAISE EXCEPTION[\s\S]*END LOOP/);
  });

  it('restock continua rejeitado sem produto identificado (regressão zero da Fase 1)', () => {
    expect(MIGRATION_084).toContain("IF p_destination = 'restock' AND v_item.product_id IS NULL THEN");
  });

  it('restock é rejeitado com quarentena aberta', () => {
    expect(MIGRATION_084).toMatch(/p_destination = 'restock' AND EXISTS \(\s*SELECT 1 FROM return_quarantine_holds WHERE return_item_id = p_item_id AND released_at IS NULL/);
  });

  it('destinação decidida duas vezes continua rejeitada, agora também bloqueando in_treatment', () => {
    expect(MIGRATION_084).toContain("IF v_item.destination_status IN ('moved','in_treatment') THEN");
  });

  it('assistência/recondicionamento concluídos liberam o item para nova decisão de destinação', () => {
    expect(MIGRATION_084).toMatch(/IF p_to_status IN \('completed','no_repair'\) THEN\s+UPDATE return_items SET\s+destination_status\s+= 'pending'/);
  });

  it('aprovar/rejeitar um pedido exige owner/admin/manager', () => {
    expect(MIGRATION_084).toContain("IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN\n    RAISE EXCEPTION 'Apenas owner, admin ou manager podem decidir uma aprovação.';");
  });

  it('liberar quarentena exige owner/admin/manager e justificativa ≥5 caracteres', () => {
    expect(MIGRATION_084).toContain("IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN\n    RAISE EXCEPTION 'Apenas owner, admin ou manager podem liberar quarentena.';");
    expect(MIGRATION_084).toMatch(/Liberar quarentena exige justificativa/);
  });

  it('as 6 RPCs novas são revogadas de anon/PUBLIC e liberadas só para authenticated', () => {
    for (const fn of [
      'return_items_request_approval(uuid,text,text)',
      'return_items_decide_approval(uuid,boolean,text)',
      'return_service_orders_transition_status(uuid,text,text)',
      'return_items_release_quarantine(uuid,text)',
      'return_items_batch_apply(uuid[],text,jsonb)',
    ]) {
      expect(MIGRATION_084).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      expect(MIGRATION_084).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon`);
      expect(MIGRATION_084).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`);
    }
  });

  it('todas as tabelas novas usam a convenção company_id uuid + get_my_company_id(), exceto return_approval_settings (1 linha por empresa, company_id é a PK)', () => {
    const matches = [...MIGRATION_084.matchAll(/company_id uuid NOT NULL DEFAULT get_my_company_id\(\)::uuid REFERENCES companies\(id\) ON DELETE CASCADE/g)];
    expect(matches.length).toBe(8);
    expect(MIGRATION_084).toContain('company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE');
  });

  it('não faz DROP/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_084).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('produtos/return_items só são lidos ou atualizados nos campos esperados, nunca ALTER de tabelas de outros módulos', () => {
    expect(MIGRATION_084).not.toMatch(/ALTER TABLE (products|sales_records|nfe_invoices|purchase_orders)/);
  });
});

describe('migration 085 — sincronização de restock com o Olist Tiny', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_085.length).toBeGreaterThan(0);
  });

  it('integration_stock_adjustments.origin ganha "reverse_logistics" sem remover os 4 valores existentes', () => {
    expect(MIGRATION_085).toContain(
      "CHECK (origin IN ('physical_count','manual','reconciliation','conflict_resolution','reverse_logistics'))"
    );
  });

  it('não altera o CHECK de movement_reason — "return" já existia desde a migration 044', () => {
    expect(MIGRATION_085).not.toMatch(/movement_reason.*CHECK/);
  });

  it('return_items ganha erp_sync_adjustment_id nullable, referenciando integration_stock_adjustments', () => {
    expect(MIGRATION_085).toContain(
      'ALTER TABLE return_items ADD COLUMN IF NOT EXISTS erp_sync_adjustment_id uuid'
    );
    expect(MIGRATION_085).toContain('REFERENCES integration_stock_adjustments(id) ON DELETE SET NULL');
  });

  it('return_items_decide_destination ganha 2 parâmetros novos com DEFAULT — retrocompatível', () => {
    expect(MIGRATION_085).toContain(
      'CREATE OR REPLACE FUNCTION public.return_items_decide_destination(\n' +
      '  p_item_id uuid, p_destination text, p_reason text DEFAULT NULL::text,\n' +
      '  p_sync_to_erp boolean DEFAULT false, p_connection_id uuid DEFAULT NULL::uuid\n)'
    );
  });

  it('a sincronização só é tentada quando a destinação é restock e p_sync_to_erp é verdadeiro', () => {
    expect(MIGRATION_085).toContain("IF p_destination = 'restock' THEN");
    expect(MIGRATION_085).toContain('IF p_sync_to_erp AND p_connection_id IS NOT NULL THEN');
  });

  it('sem vínculo de produto ou depósito no Tiny: levanta alerta e NUNCA insere o lançamento (mutuamente exclusivo)', () => {
    const guardIdx = MIGRATION_085.indexOf('IF v_erp_product_external IS NULL OR v_erp_warehouse_external IS NULL THEN');
    const alertIdx = MIGRATION_085.indexOf("PERFORM integration_raise_alert(\n            v_item.company_id, p_connection_id, 'unmapped_deposits'");
    const elseIdx = MIGRATION_085.indexOf('ELSE', alertIdx);
    const insertIdx = MIGRATION_085.indexOf('INSERT INTO integration_stock_adjustments (', elseIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(alertIdx).toBeGreaterThan(guardIdx);
    expect(elseIdx).toBeGreaterThan(alertIdx);
    expect(insertIdx).toBeGreaterThan(elseIdx);
  });

  it('a indisponibilidade do vínculo/ERP nunca bloqueia a destinação interna — não há RAISE EXCEPTION no bloco de sincronização', () => {
    const start = MIGRATION_085.indexOf('IF p_sync_to_erp AND p_connection_id IS NOT NULL THEN');
    const end = MIGRATION_085.indexOf("v_is_transitional := p_destination IN");
    const syncBlock = MIGRATION_085.slice(start, end);
    expect(syncBlock).not.toMatch(/RAISE EXCEPTION/);
  });

  it('idempotência: chave determinística por item + ON CONFLICT DO NOTHING — clique duplicado nunca gera 2 lançamentos', () => {
    expect(MIGRATION_085).toContain("'return_item:' || v_item.id::text");
    expect(MIGRATION_085).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });

  it('a própria aprovação da destinação já aprova o envio — approved_by/approved_at gravados no insert, sem 2ª etapa de aprovação', () => {
    expect(MIGRATION_085).toContain('approved_by, approved_at, requested_by, sync_status, idempotency_key');
    expect(MIGRATION_085).toMatch(/auth\.uid\(\), now\(\), auth\.uid\(\), 'pending'/);
  });

  it('a 5ª assinatura de return_items_decide_destination é revogada de anon/PUBLIC e liberada só para authenticated', () => {
    const fn = 'return_items_decide_destination(uuid, text, text, boolean, uuid)';
    expect(MIGRATION_085).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`);
    expect(MIGRATION_085).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon`);
    expect(MIGRATION_085).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
  });

  it('não faz DROP TABLE/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_085).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('não faz ALTER TABLE em tabelas de outros módulos além de integration_stock_adjustments/return_items', () => {
    const alters = [...MIGRATION_085.matchAll(/ALTER TABLE (\w+)/g)].map(m => m[1]);
    for (const table of alters) {
      expect(['integration_stock_adjustments', 'return_items']).toContain(table);
    }
  });
});

describe('migration 086 — localizar devolução por XML de NF-e', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_086.length).toBeGreaterThan(0);
  });

  it('returns.source_type ganha "nfe_xml" sem remover os 8 valores existentes', () => {
    expect(MIGRATION_086).toContain(
      "CHECK (source_type IN ('order','nfe','sku','barcode','serial','tracking','external_ref','manual','nfe_xml'))"
    );
  });

  it('returns ganha 3 colunas nullable para o XML — chave, texto bruto e hash', () => {
    for (const col of ['return_nfe_invoice_key text', 'return_nfe_raw_xml text', 'return_nfe_xml_hash text']) {
      expect(MIGRATION_086).toContain(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it('duas garantias independentes de não-reuso — índice único parcial por chave e por hash', () => {
    expect(MIGRATION_086).toContain('ON returns (company_id, return_nfe_invoice_key) WHERE return_nfe_invoice_key IS NOT NULL');
    expect(MIGRATION_086).toContain('ON returns (company_id, return_nfe_xml_hash) WHERE return_nfe_xml_hash IS NOT NULL');
  });

  it('valida a chave de acesso com 44 dígitos antes de qualquer insert', () => {
    const checkIdx = MIGRATION_086.indexOf("char_length(v_key) <> 44");
    const firstInsertIdx = MIGRATION_086.indexOf('INSERT INTO returns');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(firstInsertIdx);
  });

  it('rejeita XML duplicado por chave OU por hash antes de qualquer insert', () => {
    const dupCheckIdx = MIGRATION_086.indexOf('Esta NF-e já foi utilizada em outra devolução.');
    const firstInsertIdx = MIGRATION_086.indexOf('INSERT INTO returns');
    expect(dupCheckIdx).toBeGreaterThan(-1);
    expect(dupCheckIdx).toBeLessThan(firstInsertIdx);
  });

  it('valida quantidade (>0 e ≤ declarada) de TODOS os itens antes de inserir a devolução — sem criação parcial', () => {
    const validationLoopIdx = MIGRATION_086.indexOf('a quantidade recebida deve ser maior que zero');
    const excessIdx = MIGRATION_086.indexOf('ultrapassa a quantidade declarada');
    const firstInsertIdx = MIGRATION_086.indexOf('INSERT INTO returns');
    expect(validationLoopIdx).toBeGreaterThan(-1);
    expect(excessIdx).toBeGreaterThan(-1);
    expect(validationLoopIdx).toBeLessThan(firstInsertIdx);
    expect(excessIdx).toBeLessThan(firstInsertIdx);
  });

  it('unresolved é derivado automaticamente — true quando a NF-e original não foi encontrada', () => {
    expect(MIGRATION_086).toContain('(p_original_nfe_invoice_id IS NULL)');
  });

  it('a nova RPC é revogada de anon/PUBLIC e liberada só para authenticated', () => {
    const fn = 'returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb)';
    expect(MIGRATION_086).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`);
    expect(MIGRATION_086).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon`);
    expect(MIGRATION_086).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
  });

  it('não faz DROP TABLE/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_086).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });

  it('não faz ALTER TABLE fora de returns', () => {
    const alters = [...MIGRATION_086.matchAll(/ALTER TABLE (\w+)/g)].map(m => m[1]);
    for (const table of alters) {
      expect(table).toBe('returns');
    }
  });

  it('não consulta serviço externo (SEFAZ/ERP) durante a leitura — só nfe_invoices local', () => {
    expect(MIGRATION_086).not.toMatch(/https?:\/\/|net\.http|pg_net/i);
  });
});

describe('migration 090 — canal de origem da devolução', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_090.length).toBeGreaterThan(0);
  });

  it('returns ganha 2 colunas aditivas — FK opcional para integration_connections + estado de confiança', () => {
    expect(MIGRATION_090).toContain(
      'ADD COLUMN IF NOT EXISTS origin_channel_connection_id uuid\n    REFERENCES integration_connections(id) ON DELETE SET NULL'
    );
    expect(MIGRATION_090).toContain(
      "ADD COLUMN IF NOT EXISTS origin_source text\n    CHECK (origin_source IN ('confirmada','mapeada','manual','ambigua','nao_identificada'))"
    );
  });

  it('nenhuma tabela de pedidos/canal é criada — só ALTER TABLE em returns, e a única CREATE TABLE inexistente aqui', () => {
    expect(MIGRATION_090).not.toMatch(/CREATE TABLE/i);
    const alters = [...MIGRATION_090.matchAll(/ALTER TABLE (\w+)/g)].map(m => m[1]);
    for (const table of alters) {
      expect(table).toBe('returns');
    }
  });

  it('reaproveita integration_connections/fiscal_entities já existentes — nenhuma tabela de canal nova', () => {
    expect(MIGRATION_090).toContain('REFERENCES integration_connections(id)');
    expect(MIGRATION_090).not.toMatch(/CREATE TABLE.*channel/i);
  });

  it('guarda cross-tenant: um trigger valida que a conta de canal pertence à mesma empresa antes de gravar', () => {
    expect(MIGRATION_090).toContain('CREATE OR REPLACE FUNCTION public.returns_check_origin_channel_connection()');
    expect(MIGRATION_090).toContain('CREATE TRIGGER returns_origin_channel_guard');
    expect(MIGRATION_090).toMatch(/WHERE id = NEW\.origin_channel_connection_id AND company_id = NEW\.company_id/);
  });

  it('a RPC antiga (8 parâmetros) é removida antes de recriar com os 2 parâmetros novos — nunca deixa 2 sobrecargas ambíguas para o PostgREST', () => {
    const dropIdx = MIGRATION_090.indexOf(
      'DROP FUNCTION IF EXISTS public.returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, jsonb)'
    );
    const createIdx = MIGRATION_090.indexOf('CREATE OR REPLACE FUNCTION public.returns_create_from_nfe_xml(');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });

  it('os 2 parâmetros novos da RPC têm DEFAULT NULL, no final da lista — retrocompatível com chamadas antigas', () => {
    expect(MIGRATION_090).toContain('p_origin_channel_connection_id uuid DEFAULT NULL,\n  p_origin_source text DEFAULT NULL,\n  p_items jsonb');
  });

  it('a RPC valida que a conta de canal pertence à mesma empresa antes de inserir', () => {
    const guardIdx = MIGRATION_090.indexOf(
      'IF p_origin_channel_connection_id IS NOT NULL AND NOT EXISTS'
    );
    const insertIdx = MIGRATION_090.indexOf('INSERT INTO returns (');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(insertIdx);
  });

  it('a nova assinatura (10 parâmetros) é revogada de anon/PUBLIC e liberada só para authenticated', () => {
    const fn = 'returns_create_from_nfe_xml(text, text, text, uuid, text, text, text, uuid, text, jsonb)';
    expect(MIGRATION_090).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`);
    expect(MIGRATION_090).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon`);
    expect(MIGRATION_090).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
  });

  it('não faz DROP TABLE/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_090).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe('migration 091 — limpeza pós-aplicação encontrada pelo advisor de segurança', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_091.length).toBeGreaterThan(0);
  });

  it('returns_check_origin_channel_connection deixa de ser SECURITY DEFINER, seguindo o mesmo padrão de integration_connections_check_fiscal_entity (087)', () => {
    const idx = MIGRATION_091.indexOf('CREATE OR REPLACE FUNCTION public.returns_check_origin_channel_connection()');
    expect(idx).toBeGreaterThan(-1);
    const body = MIGRATION_091.slice(idx, idx + 400);
    expect(body).not.toContain('SECURITY DEFINER');
  });

  it('remove a sobrecarga morta de 3 parâmetros de return_items_decide_destination, nunca chamada pelo cliente', () => {
    expect(MIGRATION_091).toContain(
      'DROP FUNCTION IF EXISTS public.return_items_decide_destination(uuid, text, text)'
    );
  });

  it('não remove a sobrecarga de 5 parâmetros — só a antiga', () => {
    expect(MIGRATION_091).not.toContain('return_items_decide_destination(uuid, text, text, boolean, uuid)');
  });

  it('não faz DROP TABLE/TRUNCATE/DELETE FROM em nenhuma tabela', () => {
    expect(MIGRATION_091).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe('migration 092 — search_path fixo no trigger de canal de origem, mesmo padrão da 089', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_092.length).toBeGreaterThan(0);
  });

  it('fixa o search_path, sem SECURITY DEFINER, mesmo padrão de integration_connections_check_fiscal_entity (089)', () => {
    expect(MIGRATION_092).toContain('SET search_path = public');
    expect(MIGRATION_092).not.toContain('SECURITY DEFINER');
  });
});
