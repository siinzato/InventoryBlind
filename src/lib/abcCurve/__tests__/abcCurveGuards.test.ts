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

// Garantias do Wizard e da página que não são função pura — mesmo mecanismo estático acima.
const PAGE = COMPONENTS[Object.keys(COMPONENTS).find(p => p.endsWith('AbcCurvePage.tsx')) ?? ''] ?? '';

describe('wizard — bloqueios de mapeamento e de limites', () => {
  it('bloqueia o avanço de cada passo quando falta campo obrigatório', () => {
    expect(WIZARD).toContain('disabled={!vendas.file || vendasMissing.length > 0}');
    expect(WIZARD).toContain('disabled={!precos.file || precosMissing.length > 0}');
    expect(WIZARD).toContain('estoqueMissing.length === 0');
    // E a prévia não é gerada com mapeamento incompleto, com o nome do campo na mensagem.
    expect(WIZARD).toMatch(/Mapeie os campos obrigatórios antes de gerar a prévia/);
  });

  it('bloqueia política comercial inválida antes de importar e antes da prévia', () => {
    // Fase 2: a validação passou de dois limiares para a política inteira, no mesmo lugar.
    expect(WIZARD).toContain('const thresholdError = validateAbcPolicy(policy)');
    expect(WIZARD).toContain('thresholdError !== null');
    expect(WIZARD).toContain('const invalidPolicy = validateAbcPolicy(policy)');
  });

  it('importedCount usa as linhas VÁLIDAS de cada arquivo, nunca rawRows.length', () => {
    expect(WIZARD).toContain('importedCount: preview.validRows.vendas');
    expect(WIZARD).toContain('importedCount: preview.validRows.precos');
    expect(WIZARD).toContain('importedCount: preview.validRows.estoque');
    expect(WIZARD).not.toMatch(/importedCount: (precos|estoque|vendas)\.rawRows\.length/);
    // O ABC do Tiny não participa do cálculo: nenhuma linha "importada".
    expect(WIZARD).not.toMatch(/importedCount: abcTiny\.rowCount/);
  });

  it('avisos do estoque duplicado chegam à contagem de avisos da análise', () => {
    expect(WIZARD).toContain('warnings.push(...stockResult.warnings)');
  });

  it('a prévia mostra contagem antes da lista de avisos, com lista limitada', () => {
    expect(WIZARD).toMatch(/warnings\.length\.toLocaleString\('pt-BR'\)/);
    expect(WIZARD).toContain('max-h-32 overflow-y-auto');
    expect(WIZARD).toContain('preview.warnings.slice(0, 20)');
  });
});

describe('página — sem recálculo na UI e sem dado de análise/workspace anterior', () => {
  it('não reavalia recomendação nem reclassifica em tela', () => {
    expect(PAGE).not.toMatch(/evaluateRecommendation|buildSkuSnapshots|classifyInPlace/);
  });

  it('as contas pesadas passam por useMemo', () => {
    // Espaço normalizado: algumas dessas chamadas quebram linha por largura.
    const flat = PAGE.replace(/\s+/g, ' ');
    for (const fn of ['buildPareto', 'buildAbcDistribution', 'buildCurveComparison', 'filterSnapshots', 'observedProfit']) {
      const memoized = flat.includes(`useMemo(() => ${fn}(`) || flat.includes(`useMemo( () => ${fn}(`);
      expect(memoized, `${fn} deve estar dentro de useMemo`).toBe(true);
    }
  });

  it('troca de workspace limpa análises, snapshots, filtros e paginação', () => {
    const effect = PAGE.slice(PAGE.indexOf('useEffect(() => {\n    setAnalyses([]);'), PAGE.indexOf('}, [companyId]);'));
    expect(effect).toContain('setAnalyses([])');
    expect(effect).toContain('setSnapshots([])');
    expect(effect).toContain('setRecommendations([])');
    expect(effect).toContain('setBatches([])');
    expect(effect).toContain('setFilters(EMPTY_PRODUCT_FILTERS)');
    expect(effect).toContain('setPage(0)');
  });

  it('troca de análise reseta página, expandidos e filtros', () => {
    const effect = PAGE.slice(PAGE.indexOf("if (!selectedId)"), PAGE.indexOf('}, [companyId, selectedId]);'));
    expect(effect).toContain('setPage(0)');
    expect(effect).toContain('setExpandedSnapshotId(null)');
    expect(effect).toContain('setExpandedGroup(null)');
    expect(effect).toContain('setFilters(EMPTY_PRODUCT_FILTERS)');
  });

  it('a paginação fatia o conjunto filtrado, não a lista completa', () => {
    expect(PAGE).toContain('filtered.slice(safePage * PAGE_SIZE');
    expect(PAGE).toContain('Math.ceil(filtered.length / PAGE_SIZE)');
    expect(PAGE).not.toMatch(/snapshots\.slice\(page \* PAGE_SIZE/);
  });

  it('o contador mostra "filtrados de total" quando há filtro', () => {
    expect(PAGE).toContain('${fmtInt(filtered.length)} de ${fmtInt(snapshots.length)} SKUs');
  });

  it('preserva as quatro visões de Produtos e os detalhes expansíveis', () => {
    for (const view of ['Resumo', 'Comercial', 'Rentabilidade', 'Classificação']) {
      expect(PAGE).toContain(`label: '${view}'`);
    }
    expect(PAGE).toContain('abc-curve-product-detail-');
  });

  it('diz explicitamente que o ABC do Tiny não participa do cálculo', () => {
    // Fase 2: o texto passou a distinguir referência aproveitada de referência sem
    // correspondência, mas as duas continuam dizendo que ela não entra no cálculo.
    expect(PAGE).toContain('Curva ABC do Tiny — referência utilizada no comparativo');
    expect(PAGE).toContain('Curva ABC do Tiny — referência sem dados comparáveis');
    expect(PAGE).toMatch(/Não participa do cálculo desta análise/);
  });

  it('não usa IA e não introduz dependência de gráfico', () => {
    expect(PAGE).not.toMatch(/anthropic|openai|claude-|gpt-|messages\.create/i);
    expect(PAGE).not.toMatch(/from 'recharts'|from 'chart\.js'|from 'd3'/);
  });
});

describe('serviço — leitura completa dos snapshots', () => {
  it('pagina a leitura em blocos, com desempate estável, em vez de aceitar o corte de 1000 linhas', () => {
    expect(SERVICE).toContain('const FETCH_PAGE = 1000;');
    const fn = SERVICE.slice(SERVICE.indexOf('export async function listSkuSnapshots'), SERVICE.indexOf('export async function listRecommendations'));
    expect(fn).toContain('.range(from, from + FETCH_PAGE - 1)');
    expect(fn).toContain(".order('sku', { ascending: true })");
    expect(fn).toContain('if (page.length < FETCH_PAGE) return rows;');
  });

  it('não busca snapshot por SKU (nada de N+1)', () => {
    expect(SERVICE).not.toMatch(/from\('abc_curve_sku_snapshots'\)[\s\S]{0,120}\.eq\('sku'/);
  });
});
