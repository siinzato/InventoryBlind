// Monta a cobertura de contagem a partir do que JÁ existe no banco.
//
// Nenhuma tabela nova: a data da última contagem de cada SKU é reunida das duas origens
// que o sistema já grava — o inventário por SKU (migration 112) e o motor de contagem
// física (migration 039). Fazer isso por leitura, e não por uma coluna
// `products.last_counted_at`, evita criar um campo que precisaria ser mantido em sincronia
// por gatilho em dois fluxos diferentes; quando a ciclagem programada entrar, aí sim vale
// materializar.
//
// Só SELECT. Este módulo não escreve em lugar nenhum.

import { supabase } from '../supabase';
import { resolveBalance, type AbcClass, type CoverageItem } from './coverageDomain';

const FETCH_PAGE = 1000;

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  location: string | null;
  price: number | null;
  stock_quantity: number | null;
}

async function fetchCatalog(companyId: string): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, location, price, stock_quantity')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as ProductRow[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
  }
  return rows;
}

/** Classe ABC vigente por produto. A tabela guarda uma linha por apuração, então vence a
 *  `classification_date` mais recente — a ordenação crescente faz a última sobrescrever
 *  as anteriores no mapa. */
async function fetchAbcClasses(companyId: string): Promise<Map<string, AbcClass>> {
  const mapa = new Map<string, AbcClass>();
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('product_abc_xyz_classifications')
      .select('product_id, abc_class, classification_date')
      .eq('company_id', companyId)
      .order('classification_date', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { product_id: string; abc_class: string | null }[];
    for (const row of page) {
      const classe = row.abc_class;
      mapa.set(row.product_id, classe === 'A' || classe === 'B' || classe === 'C' ? classe : null);
    }
    if (page.length < FETCH_PAGE) break;
  }
  return mapa;
}

/** Guarda a data mais recente por produto, venha de qual origem vier. */
function registrar(mapa: Map<string, string>, productId: string, quando: string | null) {
  if (!quando) return;
  const atual = mapa.get(productId);
  if (!atual || quando > atual) mapa.set(productId, quando);
}

/** Última contagem por produto, unindo as duas origens.
 *
 *  `physical_count_items` não tem carimbo próprio de quando a contagem foi registrada —
 *  a RPC atualiza `physical_quantity` e `updated_at` na mesma operação, então `updated_at`
 *  de um item COM quantidade física é a melhor data disponível. Item sem quantidade é
 *  ignorado: sessão aberta e abandonada não conta como contagem. */
async function fetchLastCounts(companyId: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();

  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('product_id, counted_at')
      .eq('company_id', companyId)
      .eq('status', 'counted')
      .not('counted_at', 'is', null)
      .order('product_id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { product_id: string; counted_at: string | null }[];
    page.forEach(row => registrar(mapa, row.product_id, row.counted_at));
    if (page.length < FETCH_PAGE) break;
  }

  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('physical_count_items')
      .select('product_id, updated_at')
      .eq('company_id', companyId)
      .not('physical_quantity', 'is', null)
      .order('product_id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { product_id: string; updated_at: string | null }[];
    page.forEach(row => registrar(mapa, row.product_id, row.updated_at));
    if (page.length < FETCH_PAGE) break;
  }

  return mapa;
}

/** Saldo por produto segundo a Fonte de Saldo — a foto da última importação de estoque.
 *
 *  Por que ler isto aqui: a Fonte de Saldo grava o saldo que importa todo dia, mas não
 *  escreve em `products.stock_quantity`, porque conciliar a foto com o cadastro canônico é
 *  uma decisão explícita separada. O resultado é que existe saldo atualizado no sistema e
 *  o catálogo pode estar zerado. Esta tela só LÊ essa foto para conseguir exibir valor
 *  parado; nada aqui concilia, grava ou promove a foto a saldo oficial.
 *
 *  Os níveis chegam por depósito (`external_warehouse_id`), então os depósitos de um mesmo
 *  produto são SOMADOS — é o mesmo princípio do motor de sincronização: comparar um
 *  depósito isolado com o total do sistema inventa divergência que não existe.
 *
 *  Entre CONEXÕES diferentes, porém, vence a mais recente em vez de somar. Duas conexões
 *  relatando o mesmo produto são duas opiniões sobre o mesmo saldo, não dois estoques:
 *  somá-las dobraria a quantidade. */
async function fetchSnapshotBalances(companyId: string): Promise<Map<string, number>> {
  const produtoPorLink = new Map<string, string>();
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('integration_entity_links')
      .select('id, internal_id')
      .eq('company_id', companyId)
      .eq('entity_type', 'product')
      .not('internal_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as { id: string; internal_id: string | null }[];
    for (const row of page) {
      if (row.internal_id) produtoPorLink.set(row.id, row.internal_id);
    }
    if (page.length < FETCH_PAGE) break;
  }
  if (produtoPorLink.size === 0) return new Map();

  // Somatório por (produto, conexão), guardando a observação mais recente do grupo.
  const porConexao = new Map<string, { produto: string; soma: number; observado: string }>();
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('integration_stock_levels')
      .select('entity_link_id, connection_id, quantity, observed_at')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + FETCH_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as {
      entity_link_id: string; connection_id: string; quantity: number | null; observed_at: string | null;
    }[];
    for (const row of page) {
      const produto = produtoPorLink.get(row.entity_link_id);
      if (!produto) continue;
      const chave = `${produto}|${row.connection_id}`;
      const grupo = porConexao.get(chave) ?? { produto, soma: 0, observado: '' };
      grupo.soma += Number(row.quantity ?? 0);
      const quando = row.observed_at ?? '';
      if (quando > grupo.observado) grupo.observado = quando;
      porConexao.set(chave, grupo);
    }
    if (page.length < FETCH_PAGE) break;
  }

  const porProduto = new Map<string, { soma: number; observado: string }>();
  for (const grupo of porConexao.values()) {
    const atual = porProduto.get(grupo.produto);
    if (!atual || grupo.observado > atual.observado) {
      porProduto.set(grupo.produto, { soma: grupo.soma, observado: grupo.observado });
    }
  }

  const saldos = new Map<string, number>();
  porProduto.forEach((valor, produto) => saldos.set(produto, valor.soma));
  return saldos;
}

export async function fetchCoverageItems(companyId: string): Promise<CoverageItem[]> {
  const [catalogo, classes, contagens, saldos] = await Promise.all([
    fetchCatalog(companyId),
    fetchAbcClasses(companyId),
    fetchLastCounts(companyId),
    // A foto da Fonte de Saldo é complemento, não requisito: se ela falhar, a cobertura
    // por SKU — que é o número principal da tela — continua correta. Derrubar a tela
    // inteira por causa do valor seria trocar um dado a menos por nenhum dado.
    fetchSnapshotBalances(companyId).catch(err => {
      console.error('[Coverage] saldo da fonte', err);
      return new Map<string, number>();
    }),
  ]);

  return catalogo.map(p => {
    const saldo = resolveBalance(p.stock_quantity, saldos.get(p.id) ?? null);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      location: p.location,
      abc: classes.get(p.id) ?? null,
      lastCountedAt: contagens.get(p.id) ?? null,
      value: (p.price ?? 0) * saldo.quantity,
      balanceFrom: saldo.from,
    };
  });
}
