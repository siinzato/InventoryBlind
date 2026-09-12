// Guardas da ponte cadastro -> inventário. Mesmo padrão de inventoryCycleGuards.test.ts:
// invariantes que vivem na fiação entre serviço e telas, e que não dão para provar com
// função pura sem montar um Supabase falso.

import { describe, expect, it } from 'vitest';

const read = (glob: Record<string, string>, needle: string): string => {
  const entry = Object.entries(glob).find(([path]) => path.includes(needle));
  if (!entry) throw new Error(`arquivo não encontrado no glob: ${needle}`);
  return entry[1];
};

const SERVICES = import.meta.glob('../*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CYCLE = import.meta.glob('../../inventoryCycle/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const APP = import.meta.glob('../../../App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('taxonomySync', () => {
  const sync = read(SERVICES, 'taxonomySync');

  it('reutiliza syncActiveCycleItems — não existe segunda implementação', () => {
    expect(sync).toContain("from '../inventoryCycle/inventoryCycleService'");
    expect(sync).toContain('await syncActiveCycleItems(companyId, userId)');
    // Nenhuma escrita própria em inventory_items: a reconciliação é a de sempre.
    expect(sync).not.toContain('inventory_items');
  });

  it('nunca abre inventário: sem ciclo ativo, sai sem efeito', () => {
    expect(sync).toContain('const cycle = await getActiveCycle(companyId);');
    expect(sync).toContain('if (!cycle) return;');
    expect(sync).not.toContain('ensureActiveCycle');
  });

  it('coalesce pedidos em sequência — uma reconciliação, não uma por produto', () => {
    expect(sync).toContain('const running = new Map<string, Promise<void>>();');
    expect(sync).toContain('rerun.add(companyId)');
    expect(sync).toContain('while (rerun.has(companyId))');
  });

  it('isola workspace: fila e execução são por companyId', () => {
    expect(sync).toContain('running.get(companyId)');
    expect(sync).toContain('running.set(companyId, run)');
  });

  it('não usa intervalo nem recarga de página', () => {
    for (const proibido of ['setInterval', 'setTimeout', 'window.location', 'location.reload']) {
      expect(sync).not.toContain(proibido);
    }
  });
});

describe('productBrandService', () => {
  const service = read(SERVICES, 'productBrandService');

  it('toda mutação de cadastro avisa quem mantém cópia dos dados', () => {
    for (const fn of ['createBrand', 'updateBrand', 'setBrandActive', 'createLine', 'updateLine', 'setLineActive']) {
      const body = service.slice(service.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf('\n}\n'))).toContain('notifyTaxonomyChanged()');
    }
  });

  it('associação de produto reconcilia o inventário ativo', () => {
    for (const fn of ['bulkAssignProductAssociation', 'confirmProductAssociation']) {
      const body = service.slice(service.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf('\n}\n'))).toContain('await requestActiveCycleSync(companyId, userId)');
    }
  });

  it('cadastro continua em product_brands / product_lines — nada escrito em inventory_brands', () => {
    expect(service).not.toContain('inventory_brands');
  });
});

describe('App', () => {
  const app = read(APP, 'App.tsx');

  it('o Ranking recebe o universo com o cadastro; o Dashboard mantém o universo do inventário', () => {
    expect(app).toContain('brandsData={globaisCadastro.tabela}');
    expect(app).toContain('withRegisteredTaxonomy(mergeCurrentCycleCounts(lineUniverse, brandsData).lines');
    // O memo do Dashboard segue sem as entidades vazias.
    const dashboard = app.slice(app.indexOf('const globais = useMemo('), app.indexOf('const globaisCadastro'));
    expect(dashboard).not.toContain('withRegisteredTaxonomy');
  });

  it('relê os dados por aviso do serviço, sem F5 e sem polling', () => {
    expect(app).toContain('useEffect(() => subscribeTaxonomyChanged(() => { loadData(); }), [loadData]);');
  });

  it('o cadastro lido pelo App vem da fonte canônica', () => {
    expect(app).toContain("from './lib/productBrands/productBrandService'");
    expect(app).toContain('listBrands(companyId)');
    expect(app).toContain('listLines(companyId)');
  });
});

describe('ciclo', () => {
  it('withRegisteredTaxonomy não inventa item nem contagem — só acrescenta zeros', () => {
    const model = read(CYCLE, 'inventoryCycleModel');
    const fn = model.slice(model.indexOf('export function withRegisteredTaxonomy'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));

    expect(body).toContain('totalSku: 0');
    expect(body).toContain('doneSku: 0');
    expect(body).toContain('divergences: 0');
    expect(body).toContain('if (!brand.active || brandsWithActiveLine.has(brand.id)) continue;');
  });
});
