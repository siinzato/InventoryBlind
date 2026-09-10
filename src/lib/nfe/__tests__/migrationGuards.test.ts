import { describe, expect, it } from 'vitest';

// Reproduz por que "Remover do histórico"/"Restaurar" falhava: a migration 062 (que cria
// nfe_admin_archive_invoice/nfe_admin_restore_invoice/nfe_admin_hard_delete_draft_invoice e as
// colunas deleted_at/deleted_by/deletion_reason em nfe_invoices) existe como arquivo local mas
// nunca foi aplicada no banco remoto compartilhado — confirmado consultando pg_proc e
// information_schema.columns no projeto Supabase real: nenhuma das três funções existe e
// nfe_invoices não tem deleted_at. Sem a RPC, o PostgREST devolve "function not found" e o
// modal (AdminReasonModal) cai no fallback genérico "Não foi possível concluir a ação". Este
// teste não substitui a aplicação da migration (isso não é testável sem Postgres); ele trava a
// definição da migration em disco para que ela não seja reescrita ou perdida antes de ser
// aplicada, mesmo mecanismo já usado em adminSales/closingReports/migrationGuards.test.ts.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MIGRATION_062 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('062_nfe_admin_controls')) ?? ''] ?? '';

describe('migration 062 — controles administrativos de NF-e (arquivar/restaurar/excluir)', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_062.length).toBeGreaterThan(0);
  });

  it('cria as três RPCs que a tela de NF-e chama (nfeService.ts)', () => {
    expect(MIGRATION_062).toContain('CREATE OR REPLACE FUNCTION public.nfe_admin_archive_invoice(');
    expect(MIGRATION_062).toContain('CREATE OR REPLACE FUNCTION public.nfe_admin_restore_invoice(');
    expect(MIGRATION_062).toContain('CREATE OR REPLACE FUNCTION public.nfe_admin_hard_delete_draft_invoice(');
  });

  it('adiciona deleted_at/deleted_by/deletion_reason em nfe_invoices (arquivamento, não exclusão)', () => {
    expect(MIGRATION_062).toContain('ADD COLUMN IF NOT EXISTS deleted_at      timestamptz');
    expect(MIGRATION_062).toContain('ADD COLUMN IF NOT EXISTS deleted_by      uuid');
    expect(MIGRATION_062).toContain('ADD COLUMN IF NOT EXISTS deletion_reason text');
  });

  it('arquivar/restaurar exigem owner/admin e justificativa mínima de 5 caracteres', () => {
    const roleChecks = MIGRATION_062.match(/v_role NOT IN \('owner','admin'\)/g) ?? [];
    const reasonChecks = MIGRATION_062.match(/char_length\(v_reason\) < 5/g) ?? [];
    // archive, restore, hard-delete e correct-count — as 4 RPCs que exigem justificativa.
    expect(roleChecks.length).toBeGreaterThanOrEqual(4);
    expect(reasonChecks.length).toBeGreaterThanOrEqual(4);
  });

  it('exclusão definitiva só é aceita para nota not_started, sem eventos e sem itens conferidos', () => {
    expect(MIGRATION_062).toContain("v_before.status <> 'not_started'");
    expect(MIGRATION_062).toContain('v_events > 0');
    expect(MIGRATION_062).toContain('v_counted > 0');
  });

  it('arquivar/restaurar/excluir nunca apagam XML, itens ou eventos fora do caso permitido', () => {
    expect(MIGRATION_062).not.toMatch(/DELETE FROM nfe_invoice_items/);
    expect(MIGRATION_062).not.toMatch(/DELETE FROM nfe_count_events/);
    // A única linha que apaga a nota em si é a exclusão definitiva, condicionada acima.
    const deleteInvoiceMatches = MIGRATION_062.match(/DELETE FROM nfe_invoices/g) ?? [];
    expect(deleteInvoiceMatches.length).toBe(1);
  });

  it('as três RPCs são revogadas de anon/PUBLIC e liberadas só para authenticated', () => {
    for (const fn of [
      'nfe_admin_archive_invoice(uuid, text)',
      'nfe_admin_restore_invoice(uuid, text)',
      'nfe_admin_hard_delete_draft_invoice(uuid, text)',
    ]) {
      expect(MIGRATION_062).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC`);
      expect(MIGRATION_062).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM anon`);
      expect(MIGRATION_062).toContain(`GRANT  EXECUTE ON FUNCTION public.${fn} TO authenticated`);
    }
  });

  it('gera evento de auditoria para arquivar, restaurar e excluir', () => {
    expect(MIGRATION_062).toContain("'nfe.invoice_archived'");
    expect(MIGRATION_062).toContain("'nfe.invoice_restored'");
    expect(MIGRATION_062).toContain("'nfe.invoice_hard_deleted'");
  });
});
