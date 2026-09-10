// Guardas de código-fonte da Fonte de Saldo por planilha. São as invariantes
// que nenhum teste de comportamento pega: a fonte é registrada pelo modelo
// persistido que já existe, a importação não toca no cadastro mestre nem no
// estoque do InventoryBlind, o workspace vem do JWT (nunca de argumento), e a
// leitura do arquivo não escreve nada.

import { describe, it, expect } from 'vitest';

const MODULE = import.meta.glob('/src/lib/integrations/stockSheet/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const SERVICE = MODULE['/src/lib/integrations/stockSheet/stockSheetSourceService.ts'];
const CONTRACT = MODULE['/src/lib/integrations/stockSheet/tinyStockSheetContract.ts'];
const PLAN = MODULE['/src/lib/integrations/stockSheet/tinyStockSheetPlan.ts'];

/** Guarda é sobre CÓDIGO, não sobre prosa: estes arquivos comentam de propósito
 *  o que NÃO fazem ("não toca products.stock_quantity", "sem grants"), e sem
 *  remover comentário a própria documentação derrubaria a guarda. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function sqlCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const MODULE_CODE = Object.fromEntries(
  Object.entries(MODULE).map(([path, source]) => [path, code(source)])
);

function migrationSource(): string {
  const entry = Object.entries(MIGRATIONS).find(([path]) =>
    path.includes('tiny_stock_sheet_balance_source')
  );
  return entry?.[1] ?? '';
}

describe('registro da fonte — migration só de dados', () => {
  const sql = migrationSource();

  it('a migration existe e registra a fonte no catálogo de providers', () => {
    expect(sql, 'migration da fonte não encontrada').toBeTruthy();
    expect(sql).toMatch(/INSERT INTO public\.integration_providers/);
    expect(sql).toContain("'tiny_stock_sheet'");
    expect(sql).toContain("'Tiny — Estoque diário'");
    expect(sql).toContain("'erp'");
    expect(sql).toContain("'available'");
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  it('não cria nem altera schema, RLS, policy, grant ou função', () => {
    const forbidden = [
      /CREATE TABLE/i,
      /ALTER TABLE/i,
      /CREATE POLICY/i,
      /DROP POLICY/i,
      /ENABLE ROW LEVEL SECURITY/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /CREATE (OR REPLACE )?FUNCTION/i,
      /CREATE INDEX/i,
      /CREATE TRIGGER/i,
    ];
    for (const pattern of forbidden) {
      expect(pattern.test(sqlCode(sql)), `a migration da fonte contém ${pattern}`).toBe(false);
    }
  });

  it('declara apenas a capability que a fonte tem de verdade', () => {
    expect(sql).toContain('"read_stock":true');
    expect(sql).not.toContain('write_stock');
    expect(sql).not.toContain('read_products');
    expect(sql).not.toContain('webhooks');
  });
});

describe('não altera cadastro mestre nem estoque do InventoryBlind', () => {
  it('nenhum arquivo da fonte escreve em products', () => {
    for (const [path, source] of Object.entries(MODULE_CODE)) {
      const writes = source.match(/from\('products'\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/g);
      expect(writes, `${path} escreve em products`).toBeNull();
    }
  });

  it('nenhum arquivo da fonte menciona stock_quantity, contagem ou movimentação', () => {
    for (const [path, source] of Object.entries(MODULE_CODE)) {
      for (const forbidden of [
        'stock_quantity',
        'inventory_items',
        'physical_count',
        'inventory_count',
        'integration_stock_adjustments',
      ]) {
        expect(source.includes(forbidden), `${path} referencia ${forbidden}`).toBe(false);
      }
    }
  });

  it('só três tabelas são acessadas diretamente; o resto passa pelos serviços já existentes', () => {
    const allowed = new Set([
      'integration_connections',
      'products',
      'integration_stock_levels',
      'integration_entity_links',
    ]);
    for (const [path, source] of Object.entries(MODULE_CODE)) {
      for (const match of source.matchAll(/from\('([a-z_]+)'\)/g)) {
        expect(allowed.has(match[1]), `${path} acessa ${match[1]} direto`).toBe(true);
      }
    }
  });
});

describe('isolamento por workspace', () => {
  it('company_id nunca é enviado pelo cliente — RLS resolve o tenant', () => {
    for (const [path, source] of Object.entries(MODULE_CODE)) {
      expect(source.includes('company_id:'), `${path} envia company_id`).toBe(false);
      expect(source.includes(".eq('company_id'"), `${path} filtra company_id`).toBe(false);
    }
  });

  it('a fonte é lida pelo provider_key, dentro do escopo da RLS', () => {
    expect(SERVICE).toMatch(/\.eq\('provider_key', TINY_STOCK_SHEET_PROVIDER_KEY\)/);
  });
});

describe('pureza dos módulos de contrato e de plano', () => {
  it('contrato e plano não importam o client Supabase', () => {
    for (const [name, source] of Object.entries({ contrato: CONTRACT, plano: PLAN })) {
      expect(source, `${name} deveria ser puro`).not.toMatch(/from '\.\.?\/(\.\.\/)?supabase'/);
    }
  });

  it('a associação usa a regra canônica do domínio, sem regra nova para o Tiny', () => {
    expect(PLAN).toMatch(/from '\.\.\/matching'/);
    expect(PLAN).toContain('resolveMatch(');
    // Nenhum fuzzy, nenhuma comparação por nome.
    expect(PLAN).not.toContain('fuzzy');
    expect(PLAN).not.toContain('localeCompare');
  });
});

describe('leitura do arquivo não escreve nada', () => {
  it('readTinyStockSheet não abre job, não mapeia e não grava saldo', () => {
    const start = SERVICE.indexOf('export async function readTinyStockSheet');
    expect(start).toBeGreaterThan(-1);
    const end = SERVICE.indexOf('\nexport ', start + 1);
    const body = SERVICE.slice(start, end === -1 ? undefined : end);
    for (const call of ['createJob', 'upsertLinks', 'saveStockLevels', 'recordItems', '.insert(', '.upsert(', '.update(']) {
      expect(body.includes(call), `readTinyStockSheet contém ${call}`).toBe(false);
    }
  });
});

describe('snapshot, nunca acumulação', () => {
  it('o saldo é gravado pelo repositório canônico do sync, não por escrita própria', () => {
    expect(SERVICE).toContain('createSupabaseSyncRepository');
    expect(SERVICE).toContain('repository.saveStockLevels(');
    const directWrite = SERVICE.match(
      /from\('integration_stock_levels'\)[\s\S]{0,120}?\.(insert|update|upsert|delete)\(/
    );
    expect(directWrite, 'a fonte escreve em integration_stock_levels por conta própria').toBeNull();
  });

  it('um saldo por produto: o depósito externo fica vazio, então reimportar substitui', () => {
    expect(SERVICE).toMatch(/warehouseExternalId: null/);
  });

  it('o histórico e a auditoria são os do domínio, sem tabela nova', () => {
    expect(SERVICE).toContain('repository.createJob(');
    expect(SERVICE).toContain('repository.recordItems(');
    expect(SERVICE).toContain('repository.updateJob(');
  });
});
