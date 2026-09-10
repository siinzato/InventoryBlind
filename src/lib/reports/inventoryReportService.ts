// Emitir Relatório — a única camada de I/O da ferramenta, e ela só LÊ.
// Nenhuma escrita existe aqui de propósito: emitir folha de contagem não
// atualiza estoque, produto, contagem nem movimentação.

import { supabase } from '../supabase';
import type { ReportProduct } from './inventoryReportTypes';

const PAGE_SIZE = 1000;
/** Trava de segurança para não travar o navegador em catálogos gigantes. */
export const MAX_REPORT_PRODUCTS = 20_000;

interface AssociationEmbed {
  brand_id: string | null;
  line_id: string | null;
}

interface ProductRow {
  id: string;
  name: string | null;
  sku: string | null;
  ean: string | null;
  location: string | null;
  /** `product_id` é único em product_brand_associations, então o PostgREST
   *  devolve OBJETO (relação 1-1), não array — mas a forma depende de como o
   *  relacionamento é detectado, então as duas são aceitas aqui. */
  product_brand_associations: AssociationEmbed | AssociationEmbed[] | null;
}

function embeddedAssociation(embed: ProductRow['product_brand_associations']): AssociationEmbed | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export interface LoadProductsResult {
  products: ReportProduct[];
  /** true quando o catálogo excede MAX_REPORT_PRODUCTS e a leitura parou no limite. */
  truncated: boolean;
}

/**
 * Catálogo do workspace ativo em lotes de 1000, com a associação de
 * marca/linha embutida na mesma query — nunca uma query por produto.
 *
 * O `.eq('company_id')` é explícito além do RLS: a mesma disciplina do resto
 * do projeto, para nenhuma linha de outra empresa entrar na folha.
 * A ordenação por `id` é obrigatória — `.range()` sem `order by` não garante
 * ordem entre chamadas e páginas se sobrepõem.
 */
export async function loadReportProducts(companyId: string): Promise<LoadProductsResult> {
  const products: ReportProduct[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, sku, ean, location, product_brand_associations(brand_id, line_id)')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as ProductRow[];
    for (const row of page) {
      const association = embeddedAssociation(row.product_brand_associations);
      products.push({
        id: row.id,
        name: row.name ?? '',
        sku: row.sku ?? '',
        ean: row.ean,
        location: row.location,
        brandId: association?.brand_id ?? null,
        lineId: association?.line_id ?? null,
      });
    }

    if (page.length < PAGE_SIZE) return { products, truncated: false };
    if (products.length >= MAX_REPORT_PRODUCTS) {
      return { products: products.slice(0, MAX_REPORT_PRODUCTS), truncated: true };
    }
    from += PAGE_SIZE;
  }
}
