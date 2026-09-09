// Reconciliação do universo do inventário ativo com o catálogo classificado.
//
// O modelo de inventário deste projeto NÃO tem tabela de item por SKU: `inventory_brands` é a
// linha de contagem e guarda os agregados `total_sku` (universo) e `done_sku` (contados).
// "Pendente" é, por definição, `total_sku - done_sku`. Portanto, adicionar um SKU novo ao
// inventário ativo significa aumentar o `total_sku` da linha de contagem correspondente —
// não inserir linha em tabela nenhuma.
//
// Consequências que essa modelagem impõe, e que este módulo respeita:
//  - Idempotência sai de graça: `total_sku` é RECALCULADO do catálogo, não incrementado. Ler a
//    mesma planilha duas vezes dá o mesmo número; não existe item para duplicar.
//  - `done_sku` e `divergences` nunca são tocados: contagem já feita continua feita, e o
//    progresso cai sozinho quando o universo cresce (96/100 → 96/104), que é o correto.
//  - `total_sku` nunca DIMINUI aqui. Reduzir o universo apagaria escopo que a equipe já
//    contou ou planejou contar; encolher inventário é decisão humana, não efeito colateral
//    de uma importação.
//
// A ponte entre os dois módulos é por NOME (`product_lines.inventory_brand_names` →
// `inventory_brands.brand`), porque não existe FK: `inventory_brands.company_id` é text e
// `product_lines.company_id` é uuid. Só linha de contagem explicitamente mapeada é afetada —
// nada é adivinhado por semelhança de nome.

import { supabase } from '../supabase';
import { normalizeForMatch } from '../closingReports/observationClassifier';
import { listLines } from './productBrandService';

export interface InventoryScopeSyncResult {
  /** Linhas de contagem que tiveram o universo ampliado. */
  updatedBrands: { brand: string; from: number; to: number }[];
  /** SKUs somados ao universo do inventário ativo. */
  addedSkus: number;
  /** Linhas de produto com mapeamento para contagem, mas sem linha de contagem correspondente. */
  unmappedLines: string[];
  /** true quando não há inventário ativo: nada foi alterado. */
  skippedNoActiveInventory: boolean;
}

/** Nome normalizado para casar rótulo de linha de contagem: só caixa e espaços, sem acento —
 *  "Lancheiras e Necessários GC" e "Lancheiras e Necessaries GC" NÃO são o mesmo nome e não
 *  são unificados aqui de propósito (seria adivinhação). */
const normalizeBrandName = (value: string): string => normalizeForMatch(value);

/**
 * Recalcula o universo (`total_sku`) das linhas de contagem do inventário ATIVO a partir dos
 * produtos realmente associados a cada linha de produto.
 *
 * Um inventário é considerado ativo quando existe linha em `inventory_brands` para a empresa:
 * é essa tabela que representa o ciclo em andamento. Ciclos anteriores vivem em
 * `inventory_snapshots` / `inventory_brand_history` e não são lidos nem escritos por esta
 * função — histórico encerrado é imutável.
 */
export async function syncActiveInventoryScope(companyId: string): Promise<InventoryScopeSyncResult> {
  const result: InventoryScopeSyncResult = { updatedBrands: [], addedSkus: 0, unmappedLines: [], skippedNoActiveInventory: false };

  // Linhas de contagem do ciclo em andamento. Se não houver nenhuma, não há inventário ativo.
  const { data: countingLines, error: countingError } = await supabase
    .from('inventory_brands')
    .select('id, brand, total_sku, done_sku')
    .eq('company_id', companyId);
  if (countingError) throw countingError;
  if (!countingLines || countingLines.length === 0) {
    result.skippedNoActiveInventory = true;
    return result;
  }

  const countingByName = new Map<string, { id: string; brand: string; total_sku: number; done_sku: number }>();
  for (const line of countingLines) countingByName.set(normalizeBrandName(line.brand), line);

  const productLines = await listLines(companyId);
  const mapped = productLines.filter(l => l.active && l.inventoryBrandNames.length > 0);
  if (mapped.length === 0) return result;

  // Quantos produtos cada linha de produto tem hoje — uma contagem por linha, em paralelo,
  // nunca uma consulta por SKU.
  const counts = await Promise.all(
    mapped.map(async line => {
      const { count, error } = await supabase
        .from('product_brand_associations')
        .select('product_id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('line_id', line.id);
      if (error) throw error;
      return { line, count: count ?? 0 };
    })
  );

  // Uma linha de contagem pode ser alimentada por mais de uma linha de produto: soma antes de
  // comparar, para não gravar o total parcial da última que passou.
  const desiredByCountingId = new Map<string, number>();
  for (const { line, count } of counts) {
    for (const name of line.inventoryBrandNames) {
      const counting = countingByName.get(normalizeBrandName(name));
      if (!counting) { result.unmappedLines.push(`${line.name} → ${name}`); continue; }
      desiredByCountingId.set(counting.id, (desiredByCountingId.get(counting.id) ?? 0) + count);
    }
  }

  for (const [countingId, desired] of desiredByCountingId) {
    const counting = countingLines.find(l => l.id === countingId)!;
    // Só cresce. E nunca abaixo do que já foi contado, que seria um universo impossível.
    const next = Math.max(counting.total_sku, desired, counting.done_sku);
    if (next === counting.total_sku) continue;

    const { error } = await supabase
      .from('inventory_brands')
      .update({ total_sku: next, updated_at: new Date().toISOString() })
      .eq('id', countingId)
      .eq('company_id', companyId);
    if (error) throw error;

    result.updatedBrands.push({ brand: counting.brand, from: counting.total_sku, to: next });
    result.addedSkus += next - counting.total_sku;
  }

  return result;
}
