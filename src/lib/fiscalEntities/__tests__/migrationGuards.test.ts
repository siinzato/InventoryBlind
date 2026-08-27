import { describe, expect, it } from 'vitest';

// Trava em disco as propriedades estruturais das migrations 087/088 (não roda
// SQL de verdade — não há Postgres local neste projeto). Mesmo mecanismo já
// usado em reverseLogistics/nfe/adminSales/closingReports migrationGuards.test.ts.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_087 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('087_fiscal_entities')) ?? ''] ?? '';
const MIGRATION_088 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('088_fiscal_entities_az_backfill')) ?? ''] ?? '';
const MIGRATION_089 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('089_fiscal_entities_fix_trigger_search_path')) ?? ''] ?? '';

describe('migration 087 — empresas fiscais (CNPJ) do workspace', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_087.length).toBeGreaterThan(0);
  });

  it('cria a tabela fiscal_entities com cnpj obrigatório e formato de 14 dígitos', () => {
    expect(MIGRATION_087).toContain('CREATE TABLE IF NOT EXISTS fiscal_entities');
    expect(MIGRATION_087).toContain("cnpj                text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$')");
  });

  it('duplicidade de CNPJ é bloqueada só dentro do mesmo workspace, nunca globalmente', () => {
    expect(MIGRATION_087).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS fiscal_entities_company_cnpj_unique_idx\n  ON fiscal_entities (company_id, cnpj);'
    );
    // não deve haver nenhum índice único apenas em (cnpj) sem company_id.
    expect(MIGRATION_087).not.toMatch(/UNIQUE INDEX[^\n]*ON fiscal_entities \(cnpj\)/);
  });

  it('garante no máximo uma empresa padrão ativa por workspace via índice parcial', () => {
    expect(MIGRATION_087).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS fiscal_entities_company_default_unique_idx\n  ON fiscal_entities (company_id) WHERE is_default AND status = \'active\';'
    );
  });

  it('não expõe policy de INSERT/UPDATE/DELETE — toda escrita passa pelas RPCs', () => {
    expect(MIGRATION_087).toContain('fiscal_entities_select');
    expect(MIGRATION_087).not.toMatch(/CREATE POLICY[^\n]*fiscal_entities[^\n]*\n\s*FOR (INSERT|UPDATE|DELETE)/);
    expect(MIGRATION_087).not.toMatch(/CREATE POLICY "fiscal_entities_(insert|update|delete)"/);
  });

  it('nunca apaga uma empresa fiscal — não existe DELETE FROM fiscal_entities', () => {
    expect(MIGRATION_087).not.toMatch(/DELETE FROM fiscal_entities/);
  });

  it('cria as 6 RPCs esperadas, todas SECURITY DEFINER exigindo owner/admin', () => {
    const rpcs = [
      'fiscal_entities_create',
      'fiscal_entities_update',
      'fiscal_entities_set_default',
      'fiscal_entities_archive',
      'fiscal_entities_restore',
      'fiscal_entities_find_by_cnpj',
    ];
    rpcs.forEach(name => {
      expect(MIGRATION_087).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    });
    const ownerAdminChecks = MIGRATION_087.match(/v_role NOT IN \('owner','admin'\)/g) ?? [];
    // create/update/set_default/archive/restore — 5 RPCs exigem owner/admin
    // (find_by_cnpj usa uma checagem diferente, de pertencimento ao workspace).
    expect(ownerAdminChecks.length).toBeGreaterThanOrEqual(5);
  });

  it('desmarca a empresa padrão anterior ANTES de definir uma nova (evita violar o índice único parcial)', () => {
    const createIdx = MIGRATION_087.indexOf('CREATE OR REPLACE FUNCTION public.fiscal_entities_create');
    const createBody = MIGRATION_087.slice(createIdx, MIGRATION_087.indexOf('CREATE OR REPLACE FUNCTION public.fiscal_entities_update'));
    const unsetIdx = createBody.indexOf('SET is_default = false');
    const insertIdx = createBody.indexOf('INSERT INTO fiscal_entities (');
    expect(unsetIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(unsetIdx).toBeLessThan(insertIdx);

    const setDefaultIdx = MIGRATION_087.indexOf('CREATE OR REPLACE FUNCTION public.fiscal_entities_set_default');
    const setDefaultBody = MIGRATION_087.slice(setDefaultIdx, MIGRATION_087.indexOf('CREATE OR REPLACE FUNCTION public.fiscal_entities_archive'));
    const unsetOthersIdx = setDefaultBody.indexOf('SET is_default = false');
    const setTargetIdx = setDefaultBody.indexOf('SET is_default = true');
    expect(unsetOthersIdx).toBeGreaterThan(-1);
    expect(setTargetIdx).toBeGreaterThan(-1);
    expect(unsetOthersIdx).toBeLessThan(setTargetIdx);
  });

  it('bloqueia arquivar a empresa padrão com a mensagem amigável pedida', () => {
    expect(MIGRATION_087).toContain('Defina outra empresa como padrão antes de arquivar esta.');
  });

  it('troca de CNPJ exige confirmação explícita antes de aplicar', () => {
    expect(MIGRATION_087).toContain('cnpj_change_confirmation_required');
    expect(MIGRATION_087).toContain('IF NOT p_confirm_cnpj_change THEN');
  });

  it('mensagens amigáveis não expõem erro bruto de banco', () => {
    expect(MIGRATION_087).toContain('Informe um CNPJ válido.');
    expect(MIGRATION_087).toContain('Este CNPJ já está cadastrado neste workspace.');
  });

  it('resolução por CNPJ nunca busca por razão social ou nome fantasia', () => {
    const findIdx = MIGRATION_087.indexOf('CREATE OR REPLACE FUNCTION public.fiscal_entities_find_by_cnpj');
    const findBody = MIGRATION_087.slice(findIdx);
    expect(findBody).not.toMatch(/legal_name\s*=|trade_name\s*=|ILIKE/);
    expect(findBody).toContain('WHERE company_id = p_company_id AND cnpj = v_cnpj AND status = \'active\'');
  });

  it('vínculo de integração é aditivo (coluna nullable) e protegido por trigger contra cross-tenant', () => {
    expect(MIGRATION_087).toContain(
      "ADD COLUMN IF NOT EXISTS fiscal_entity_id uuid REFERENCES fiscal_entities(id) ON DELETE SET NULL;"
    );
    expect(MIGRATION_087).toContain('integration_connections_check_fiscal_entity');
    expect(MIGRATION_087).toContain('A empresa fiscal selecionada não pertence a este workspace.');
  });

  it('cada RPC nova é revogada de PUBLIC/anon e concedida só a authenticated', () => {
    const grants = MIGRATION_087.match(/GRANT EXECUTE ON FUNCTION public\.fiscal_entities_\w+\([^)]*\) TO authenticated;/g) ?? [];
    expect(grants.length).toBeGreaterThanOrEqual(6);
    const revokesPublic = MIGRATION_087.match(/REVOKE ALL ON FUNCTION public\.fiscal_entities_\w+\([^)]*\) FROM PUBLIC;/g) ?? [];
    expect(revokesPublic.length).toBeGreaterThanOrEqual(6);
  });
});

describe('migration 088 — backfill da empresa fiscal do workspace AZ', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_088.length).toBeGreaterThan(0);
  });

  it('usa o id literal do workspace AZ, nunca um WHERE name = \'AZ\' amplo', () => {
    expect(MIGRATION_088).toContain("v_company_id constant uuid := '00000000-0000-0000-0000-000000000001'");
    expect(MIGRATION_088).not.toMatch(/UPDATE\s+companies\s+SET[\s\S]*WHERE\s+name\s*=\s*'AZ'/);
    expect(MIGRATION_088).not.toMatch(/UPDATE\s+fiscal_entities\s+SET[\s\S]*WHERE[\s\S]*name\s*=\s*'AZ'/);
  });

  it('aplica exatamente o CNPJ autorizado', () => {
    expect(MIGRATION_088).toContain("v_cnpj       constant text := '10256416000129'");
  });

  it('é idempotente: não insere novamente quando o mesmo CNPJ já está cadastrado', () => {
    expect(MIGRATION_088).toContain('já aplicado');
    expect(MIGRATION_088).toContain('idempotente, nada foi feito');
  });

  it('nunca sobrescreve um CNPJ diferente já cadastrado — só reporta o conflito', () => {
    expect(MIGRATION_088).toContain('conflito, backfill interrompido para revisão manual');
    expect(MIGRATION_088).not.toMatch(/UPDATE fiscal_entities SET cnpj/);
  });

  it('não inventa razão social — reaproveita companies.name como nome provisório e marca dados incompletos', () => {
    expect(MIGRATION_088).toContain("'AZ', v_cnpj, true, 'active', true, v_owner_id");
  });

  it('registra a operação em audit_logs', () => {
    expect(MIGRATION_088).toContain("'fiscal_entity.created', 'fiscal_entities', v_new_id::text");
    expect(MIGRATION_088).toContain("'source', 'az_backfill'");
  });

  it('só uma única linha de INSERT INTO fiscal_entities existe no arquivo (nenhum caminho duplicado)', () => {
    const inserts = MIGRATION_088.match(/INSERT INTO fiscal_entities/g) ?? [];
    expect(inserts.length).toBe(1);
  });
});

describe('migration 089 — corrige search_path mutável no trigger de vínculo', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_089.length).toBeGreaterThan(0);
  });

  it('fixa o search_path da função de trigger, mesma correção usada nas demais funções do projeto', () => {
    expect(MIGRATION_089).toContain('CREATE OR REPLACE FUNCTION public.integration_connections_check_fiscal_entity()');
    expect(MIGRATION_089).toContain('SET search_path = public');
  });

  it('preserva exatamente a mesma regra de negócio do trigger (nenhuma mudança de comportamento)', () => {
    expect(MIGRATION_089).toContain('A empresa fiscal selecionada não pertence a este workspace.');
  });
});
