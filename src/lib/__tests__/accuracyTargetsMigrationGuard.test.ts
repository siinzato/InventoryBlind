import { describe, expect, it } from 'vitest';

// Mesmo mecanismo já usado em adminSales/closingReports/purchaseOrders: sem Postgres
// para apontar, confere que a isolação por empresa, a barreira de papel e o CHECK que
// impede piso >= meta continuam escritos na migration 126.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const M126 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('126_accuracy_targets')) ?? ''] ?? '';

describe('migration 126 — meta de acuracidade por empresa', () => {
  it('existe e não está vazia', () => {
    expect(M126.length).toBeGreaterThan(0);
  });

  it('a empresa vem do banco, não do cliente', () => {
    expect(M126).toContain('DEFAULT get_my_company_id()::uuid');
  });

  it('toda policy isola por empresa', () => {
    const policies = M126.match(/CREATE POLICY[^;]+;/g) ?? [];
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(p).toContain("(company_id)::text = get_my_company_id()");
    }
  });

  it('escrita exige papel — leitura não', () => {
    const policies = M126.match(/CREATE POLICY[^;]+;/g) ?? [];
    const escrita = policies.filter(p => /FOR (INSERT|UPDATE)/.test(p));
    expect(escrita.length).toBe(2);
    for (const p of escrita) expect(p).toContain('get_my_role()');
    const leitura = policies.filter(p => /FOR SELECT/.test(p));
    expect(leitura.length).toBe(1);
    expect(leitura[0]).not.toContain('get_my_role()');
  });

  it('não existe policy de DELETE — apagar a meta não é operação com significado', () => {
    expect(M126).not.toMatch(/CREATE POLICY[^;]+FOR DELETE/);
  });

  // A regra que mais importa: sem ela, uma empresa que baixasse a meta para 75
  // herdaria o piso de 80 e a faixa de atenção ficaria vazia.
  it('o banco recusa piso maior ou igual à meta', () => {
    expect(M126).toContain('CHECK (warning_floor_pct < target_pct)');
  });

  it('os defaults são os mesmos do código — empresa sem linha não muda de comportamento', () => {
    expect(M126).toMatch(/target_pct\s+numeric\(5,2\)\s+NOT NULL DEFAULT 95/);
    expect(M126).toMatch(/warning_floor_pct\s+numeric\(5,2\)\s+NOT NULL DEFAULT 80/);
  });
});
