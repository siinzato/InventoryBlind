import { describe, expect, it } from 'vitest';

// Mesmo mecanismo estático usado em migrationGuards.test.ts de outros módulos: sem Postgres para
// apontar, confere isolamento do Inventário e ausência de IA a partir do próprio código-fonte.
const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SOURCES = import.meta.glob('/src/lib/abcCurve/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const COMPONENTS = import.meta.glob('/src/components/abcCurve/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const MIGRATION_078 = MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('078_abc_curve')) ?? ''] ?? '';
const SERVICE = SOURCES[Object.keys(SOURCES).find(p => p.endsWith('abcCurveService.ts')) ?? ''] ?? '';
const ENGINE = SOURCES[Object.keys(SOURCES).find(p => p.endsWith('abcCurveEngine.ts')) ?? ''] ?? '';
const WIZARD = COMPONENTS[Object.keys(COMPONENTS).find(p => p.endsWith('AbcCurveImportWizard.tsx')) ?? ''] ?? '';

describe('migration 078 — isolamento do Inventário', () => {
  it('existe e não está vazia', () => {
    expect(MIGRATION_078.length).toBeGreaterThan(0);
  });

  it('não escreve em products/inventory_*/physical_count_* (só referência de FK)', () => {
    expect(MIGRATION_078).not.toMatch(/UPDATE (products|inventory_\w+|physical_count_\w+)/i);
    expect(MIGRATION_078).not.toMatch(/ALTER TABLE (products|inventory_\w+|physical_count_\w+)/i);
    expect(MIGRATION_078).not.toMatch(/INSERT INTO (products|inventory_\w+|physical_count_\w+)/i);
  });

  it('isola as 4 tabelas novas por empresa em todas as policies', () => {
    const policyBlocks = MIGRATION_078.match(/CREATE POLICY[^;]+;/g) ?? [];
    const abcPolicies = policyBlocks.filter(b => b.includes('abc_curve_'));
    expect(abcPolicies.length).toBeGreaterThan(0);
    for (const block of abcPolicies) {
      expect(block).toContain("company_id::text = get_my_company_id()");
    }
  });

  it('não cria tabela com nome usado pela classificação ABC/XYZ de Inventário (migration 030)', () => {
    expect(MIGRATION_078).not.toMatch(/CREATE TABLE[^;]*product_abc_xyz/i);
  });
});

describe('camada de serviço/engine — sem escrita no Inventário, sem IA', () => {
  it('abcCurveService não referencia tabelas do Inventário', () => {
    expect(SERVICE).not.toMatch(/from\('inventory_\w+'\)/);
    expect(SERVICE).not.toMatch(/from\('physical_count_\w+'\)/);
  });

  it('abcCurveService só lê (nunca grava) em products', () => {
    const productsCalls = SERVICE.match(/from\('products'\)[^;]*/g) ?? [];
    expect(productsCalls.length).toBeGreaterThan(0);
    for (const call of productsCalls) {
      expect(call).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });

  it('nenhum arquivo do módulo chama modelo de IA/LLM', () => {
    for (const src of [SERVICE, ENGINE, WIZARD]) {
      expect(src).not.toMatch(/anthropic|openai|claude-|gpt-|messages\.create/i);
    }
  });
});

describe('wizard — origem via API visível e desabilitada', () => {
  it('mostra "Conectar ERP via API" desabilitado com texto "Em breve"', () => {
    expect(WIZARD).toMatch(/Conectar ERP via API/);
    expect(WIZARD).toMatch(/Em breve/);
    expect(WIZARD).toMatch(/disabled/);
  });
});
