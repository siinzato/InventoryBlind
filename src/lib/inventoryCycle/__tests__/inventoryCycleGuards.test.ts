// Guardas de fonte: invariantes que vivem no serviço, na migration e no Dashboard, e que
// não dão para provar com função pura. Mesmo padrão de migrationGuards.test.ts.

import { describe, expect, it } from 'vitest';

/** So o SQL executavel: comentarios e literais de texto (corpos de COMMENT ON) fora.
 *  Sem isto, uma assercao passaria a casar com a propria prosa do cabecalho. */
const executableSql = (sql: string): string => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--.*/g, ' ')
  .replace(/'[^']*'/g, "''");

const read = (glob: Record<string, string>, needle: string): string => {
  const entry = Object.entries(glob).find(([path]) => path.includes(needle));
  if (!entry) throw new Error(`arquivo não encontrado no glob: ${needle}`);
  return entry[1];
};

const SERVICES = import.meta.glob('../*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MIGRATIONS = import.meta.glob('../../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const APP = import.meta.glob('../../../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const COUNTING = import.meta.glob('../../../components/counting/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('reconciliação do ciclo ativo', () => {
  const service = read(SERVICES, 'inventoryCycleService');

  it('a reconciliação atualiza só classificação — nunca contagem', () => {
    const sync = service.slice(service.indexOf('export async function syncActiveCycleItems'));
    const body = sync.slice(0, sync.indexOf('\n}\n'));
    // O patch de reclassificação carrega exatamente marca/linha e seus nomes.
    expect(body).toContain('patch: { brand_id: nextBrandId, brand_name: nextBrandName, line_id: nextLineId, line_name: nextLineName }');
    for (const forbidden of ['counted_quantity:', 'counted_at:', 'counted_by:', "status: 'counted'"]) {
      expect(body.includes(forbidden)).toBe(false);
    }
  });

  it('o inventário ativo é garantido: SKU importado nunca fica fora do universo', () => {
    // Não há tela para abrir inventário; se a empresa não tem um, a importação abre.
    expect(service).toContain('const cycle = await ensureActiveCycle(companyId, userId);');
    expect(service).toContain(".eq('status', 'active')");
  });

  it('SKU novo entra pendente, com o saldo do produto como esperado', () => {
    expect(service).toContain("status: 'pending'");
    expect(service).toContain('expected_quantity: product.stock_quantity');
  });

  it('encerrar exige que o ciclo esteja ativo, e não reabre nada', () => {
    const close = service.slice(service.indexOf('export async function closeCycle'));
    expect(close).toContain(".eq('status', 'active')");
    expect(close.includes("status: 'active'")).toBe(false);
  });

  it('leitura paginada: nenhuma query confia no teto de 1000 linhas do PostgREST', () => {
    expect(service).toContain('const FETCH_PAGE = 1000');
    expect((service.match(/\.range\(from, from \+ FETCH_PAGE - 1\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('a linha do item vem da classificação persistida, não de regra por título', () => {
    expect(service).toContain("from('product_brand_associations')");
    for (const forbidden of ['classifyProductTitle', 'includes(\'puffer\'', 'toLowerCase().includes']) {
      expect(service.includes(forbidden)).toBe(false);
    }
  });
});

describe('migration 112/113', () => {
  const m112 = read(MIGRATIONS, '112_inventory_sku_items');
  const m113 = read(MIGRATIONS, '113_inventory_items_closed_guard');

  it('um item por produto por ciclo — é o que torna a reimportação idempotente', () => {
    expect(m112).toContain('UNIQUE (cycle_id, product_id)');
  });

  it('no máximo um ciclo ativo por empresa', () => {
    expect(m112).toMatch(/CREATE UNIQUE INDEX[^;]+inventory_cycles \(company_id\) WHERE status = 'active'/s);
  });

  it('divergência é coluna gerada, nunca digitada', () => {
    expect(m112).toContain('divergence         boolean GENERATED ALWAYS AS (');
    expect(m112).toContain('counted_quantity IS DISTINCT FROM expected_quantity');
  });

  it('produto com item de inventário não pode ser apagado', () => {
    expect(m112).toContain('REFERENCES products(id) ON DELETE RESTRICT');
  });

  it('a view do Dashboard respeita RLS e agrupa por linha, senão por marca', () => {
    expect(m112).toContain('WITH (security_invoker = true)');
    expect(m112).toContain("COALESCE(i.line_id::text, 'brand:' || i.brand_id::text, 'sem-classificacao')");
    expect(executableSql(m112).includes('SECURITY DEFINER')).toBe(false);
  });

  it('nada do modelo agregado legado é alterado nas duas migrations', () => {
    const sql = executableSql(`${m112}
${m113}`);
    for (const legacy of ['inventory_brands', 'inventory_count_records', 'inventory_snapshots', 'inventory_brand_history', 'physical_count_items']) {
      expect(sql.includes(legacy)).toBe(false);
    }
  });

  it('inventário encerrado é bloqueado no banco, nas três operações', () => {
    expect(m113).toContain('BEFORE INSERT OR UPDATE OR DELETE ON inventory_items');
    expect(m113).toContain('IF v_status = \'closed\' THEN');
    expect(m113).toContain("IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN");
  });
});

describe('Dashboard principal: um único inventário', () => {
  const app = read(APP, 'App.tsx');

  it('a fonte é o universo atual com o trabalho já concluído do ciclo por cima', () => {
    const flat = app.replace(/\s+/g, ' ');
    expect(flat).toContain('computeGlobalStats(cycleLinesAsBrandData(mergeCurrentCycleCounts(lineUniverse, brandsData).lines))');
    expect(app).toContain('listLineUniverse(companyId)');
    // O agregado legado entra só como contagem já feita, nunca como universo de SKU:
    // é o que garante um único total no Dashboard.
    expect(flat.includes('computeGlobalStats(brandsData')).toBe(false);
    expect(flat.includes('cycleLinesAsBrandData(brandsData')).toBe(false);
  });

  it('nenhum nome de linha de contagem aparece escrito no Dashboard', () => {
    for (const legacy of ['Linha de Outlet e PET', 'Térmicos GC', 'GoCase Capas', 'Linha Puffer GC', 'Linha de Bases GC']) {
      expect(app.includes(legacy)).toBe(false);
    }
  });

  it('só existe uma chamada de computeGlobalStats — um universo, um total', () => {
    expect((app.match(/computeGlobalStats\(/g) ?? []).length).toBe(1);
  });
});

describe('nenhum segundo ambiente de contagem', () => {
  it('não há tela de contagem por SKU em paralelo às abas de contagem', () => {
    expect(Object.keys(COUNTING).some(p => /SkuCountTab/.test(p))).toBe(false);
    for (const [, source] of Object.entries(COUNTING)) {
      expect(source.includes('Contagem por SKU')).toBe(false);
      expect(source.includes('SkuCountTab')).toBe(false);
    }
  });

  it('Nova Contagem escolhe do inventário atual, não de uma lista de grupos própria', () => {
    const manual = read(COUNTING, 'ManualCountTab');
    expect(manual).toContain('listLineUniverse(companyId)');
    expect(manual).toContain('buildCycleLineRows(mergeCurrentCycleCounts(universe, brandsData).lines)');
    // Pendentes do dropdown = pendentes do inventário, não total digitado menos contado.
    expect(manual).toContain('(Pendentes: {g.pendingSku})');
    expect(manual.includes('b.total_sku - b.done_sku')).toBe(false);
    expect(manual.includes('{brandsData.map(')).toBe(false);
  });

  it('dropdown e painel ao vivo saem do mesmo grupo selecionado', () => {
    const manual = read(COUNTING, 'ManualCountTab');
    // O painel calcula pendentes como totalSku - contados; com estes dois, campo vazio
    // devolve exatamente o pendingSku que o dropdown mostra.
    expect(manual).toContain('contados: (selectedGroup?.doneSku ?? 0) + (parseInt(skusContados) || 0)');
    expect(read(COUNTING, 'CountSidePanel')).toContain('Math.max(0, stats.totalSku - stats.contados)');
  });

  it('a gravação da contagem manual continua na linha de contagem, sem apagar nem renomear', () => {
    const manual = read(COUNTING, 'ManualCountTab');
    expect(manual).toContain("from('inventory_brands')");
    expect(manual).toContain('brand_id: countingLine.id');
    // Nada de apagar linha nem renomear a linha em que a contagem foi registrada.
    expect(manual.includes('.delete()')).toBe(false);
    expect(/update\(\{\s*brand:/.test(manual)).toBe(false);
    // Linha que ainda não existia nasce zerada: contagem nenhuma é sobrescrita.
    expect(manual).toContain('done_sku: 0');
  });

  it('as abas de contagem existentes seguem intactas', () => {
    const center = read(COUNTING, 'CountManagementCenter');
    for (const label of ['Contagem Manual', 'Importar Contagem', 'Contagem Física Digital', 'Recontagem Automática']) {
      expect(center).toContain(label);
    }
  });
});
