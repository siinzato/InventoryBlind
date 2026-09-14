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
  // O repositório usa CRLF. Normalizar para LF é o que faz os recortes por fim de função
  // abaixo funcionarem: com CRLF o `indexOf('\n}\n')` não casa e a fatia devolve o
  // arquivo inteiro — a asserção passa a ler código de outra função.
  return entry[1].replace(/\r\n/g, '\n');
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

  // O Ranking lista o que está CADASTRADO, então precisa enxergar marca/linha que ainda
  // não tem produto; o Dashboard mede o que o inventário tem. São duas leituras da mesma
  // base, não duas fontes: por isso a guarda deixou de contar chamadas e passou a exigir
  // que toda chamada nasça do universo do ciclo.
  it('um universo, um total: todo computeGlobalStats parte da mesma base do ciclo', () => {
    const calls = app.match(/computeGlobalStats\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);

    const flat = app.replace(/\s+/g, ' ');
    const bases = flat.match(/computeGlobalStats\(cycleLinesAsBrandData\( ?([a-zA-Z]+)\(/g) ?? [];
    expect(bases.length).toBe(calls.length);
    for (const base of bases) {
      expect(['mergeCurrentCycleCounts', 'withRegisteredTaxonomy'].some(fn => base.includes(fn))).toBe(true);
    }
  });

  // As entidades acrescentadas ao universo do Ranking entram todas com zero — é o que
  // garante que criar uma linha não mexa em progresso, acuracidade nem denominador.
  it('o Dashboard continua medindo só o universo do inventário', () => {
    const dashboard = app.slice(app.indexOf('const globais = useMemo('), app.indexOf('const globaisCadastro'));
    expect(dashboard).not.toContain('withRegisteredTaxonomy');
    expect(dashboard).toContain('mergeCurrentCycleCounts(lineUniverse, brandsData).lines');
  });

  // …mas a tabela "Controle por linha" responde a outra pergunta — quais linhas existem —
  // e por isso lista o universo de exibição. Os KPIs e o total de SKU do cabeçalho
  // continuam em `globais`: criar uma linha não move indicador nenhum.
  it('a listagem do Dashboard enxerga o cadastro; os indicadores não', () => {
    expect(app).toContain('globaisCadastro.tabela.slice(0, 5)');
    expect(app.includes('globais.tabela.slice(0, 5)')).toBe(false);
    expect(app).toContain('{globais.totalSku.toLocaleString(\'pt-BR\')}');
    expect(app).toContain('value: `${globais.progresso.toFixed(1)}%`');
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

  // A tela deixou de carregar o universo por conta própria: quem prepara é o App, que é
  // também quem reage ao cadastro de marca/linha. Enquanto ela tinha a sua própria
  // leitura, o dropdown ficava com um retrato mais velho que o do Dashboard — foi
  // exatamente o bug da entidade recém-criada que não aparecia na Contagem Manual.
  it('Nova Contagem escolhe do universo preparado pelo App, não de uma lista própria', () => {
    const manual = read(COUNTING, 'ManualCountTab');
    expect(manual).toContain('buildCycleLineRows(countingUniverse)');
    expect(manual.includes('listLineUniverse')).toBe(false);
    expect(manual.includes('mergeCurrentCycleCounts')).toBe(false);
    // …e o App é quem monta esse universo, do ciclo + taxonomia ativa cadastrada.
    const app = read(APP, 'App.tsx').replace(/\s+/g, ' ');
    expect(app).toContain('const countingUniverse = useMemo( () => withRegisteredTaxonomy( mergeCurrentCycleCounts(lineUniverse, brandsData).lines, taxonomy.brands, taxonomy.lines, { includeParentBrands: true },');
    expect(app).toContain('countingUniverse={countingUniverse}');
  });

  // O universo operacional só é verdade se o ciclo estiver conferido com a classificação
  // atual: produto associado depois da última importação fica no ciclo com `line_id`
  // nulo, some do universo e volta como entidade vazia. Reconciliar ANTES de ler é o que
  // impede "Pendentes: 0" numa linha que tem produtos.
  it('o ciclo é reconciliado antes de o universo ser lido — uma vez, no App', () => {
    const app = read(APP, 'App.tsx');
    const sync = app.indexOf('await requestActiveCycleSync(companyId, profile?.id ?? null)');
    const leitura = app.indexOf('setLineUniverse(await listLineUniverse(companyId))');
    expect(sync).toBeGreaterThan(-1);
    expect(leitura).toBeGreaterThan(sync);
    // Reutiliza a sincronização coalescida existente — nada de mecanismo próprio.
    expect(app).toContain("import { requestActiveCycleSync, subscribeTaxonomyChanged } from './lib/productBrands/taxonomySync'");
    // Sem polling: a releitura é por aviso pontual, não por intervalo.
    expect(app.includes('setInterval(')).toBe(false);
  });

  it('falha ou espera na reconciliação nunca vira universo zerado apresentado como verdade', () => {
    const app = read(APP, 'App.tsx');
    expect(app).toContain('const [universeReconciled, setUniverseReconciled] = useState<boolean | null>(null)');
    expect(app).toContain('universeReconciled={universeReconciled}');

    const manual = read(COUNTING, 'ManualCountTab');
    expect(manual).toContain('disabled={universeReconciled !== true}');
    expect(manual).toContain('universeReconciled === true && groups.map(');
    // E nada é gravado sobre um universo que ainda não foi conferido.
    expect(manual).toContain('if (universeReconciled !== true) return;');
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

  // Entidade recém-cadastrada existe no seletor, mas contar exige SKU: sem esta trava o
  // inventário passaria a ter contado mais do que possui.
  it('não se registra contagem positiva em entidade sem nenhum SKU', () => {
    const manual = read(COUNTING, 'ManualCountTab');
    expect(manual).toContain('selectedGroup.totalSku === 0 && (parseInt(skusContados) || 0) > 0');
    expect(manual).toContain('Esta linha ainda não possui SKUs associados.');
  });

  it('as abas de contagem existentes seguem intactas', () => {
    const center = read(COUNTING, 'CountManagementCenter');
    for (const label of ['Contagem Manual', 'Importar Contagem', 'Contagem Física Digital', 'Recontagem Automática']) {
      expect(center).toContain(label);
    }
  });
});
