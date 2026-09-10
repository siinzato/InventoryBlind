// Heatmap de Estoque — enriquecimento das áreas com o que foi realmente contado.
//
// As métricas do heatmap (total, concluídos, divergências, acuracidade) sempre vieram
// de inventory_brands e sempre foram reais. O que NÃO era real eram os atributos ao
// redor: responsável, SKUs divergentes e locais físicos vinham de generateMockHeatmapData,
// derivados do ÍNDICE da marca no array — nomes de pessoas de uma lista fixa, SKUs no
// formato `SKU-ABC-1000` e endereços `Rua A / Vão 2` que nunca existiram.
//
// Este módulo troca aquilo pela fonte que já existia e não estava sendo usada:
// inventory_count_records (quem contou, observações, quando) e
// inventory_count_import_items (SKU, local e status item a item). Quando uma marca ainda
// não tem contagem registrada, devolve vazio — a tela já sabe mostrar "Não definido" e
// esconder as listas, o que é o comportamento correto para "ainda não foi contado".

import { supabase } from './supabase';
import type { LocalFisico } from './heatmapTypes';

export interface BrandCountDetail {
  /** Operador(es) do registro de contagem mais recente da marca. */
  responsavel: string;
  observacoes: string;
  ultimaAtualizacao: string | null;
  /** SKUs reais cujo status na contagem não fechou. */
  produtosDivergentes: string[];
  /** Locais distintos onde os itens da marca foram contados. */
  locaisFisicos: LocalFisico[];
}

/** Teto de SKUs divergentes por marca levados para a tela.
 *
 *  O modal lista os SKUs em linha; uma marca com centenas de divergências viraria uma
 *  lista impossível de ler e um payload grande sem ganho. O número de divergências
 *  continua vindo inteiro de inventory_brands — este teto é só da amostra exibida. */
const MAX_DIVERGENT_SKUS = 50;

/** Teto de locais distintos por marca. Mesmo motivo. */
const MAX_LOCATIONS = 20;

interface CountRecordRow {
  id: string;
  brand_id: string;
  operator_1: string | null;
  operator_2: string | null;
  observacoes: string | null;
  created_at: string | null;
}

interface ImportItemRow {
  count_record_id: string;
  sku: string | null;
  produto_nome: string | null;
  local: string | null;
  status: string | null;
  responsavel: string | null;
}

function joinOperators(row: CountRecordRow): string {
  const names = [row.operator_1, row.operator_2].map(n => n?.trim()).filter((n): n is string => !!n);
  return names.join(' e ');
}

/** Detalhes reais por marca, indexados por `inventory_brands.id`.
 *
 *  Duas leituras, não uma por marca: a tela abre com todas as marcas de uma vez, e um
 *  round-trip por marca transformaria a abertura do heatmap em dezenas de requisições. */
export async function getBrandCountDetails(companyId: string): Promise<Map<string, BrandCountDetail>> {
  const details = new Map<string, BrandCountDetail>();
  if (!companyId) return details;

  const { data: records, error: recordsError } = await supabase
    .from('inventory_count_records')
    .select('id, brand_id, operator_1, operator_2, observacoes, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (recordsError) {
    console.error('[heatmap] falha ao carregar contagens:', recordsError.message);
    return details;
  }

  // Mais recente por marca. A query já vem ordenada desc, então o primeiro que aparece
  // para cada brand_id é o vigente.
  const latestByBrand = new Map<string, CountRecordRow>();
  for (const row of (records ?? []) as CountRecordRow[]) {
    if (!latestByBrand.has(row.brand_id)) latestByBrand.set(row.brand_id, row);
  }
  if (latestByBrand.size === 0) return details;

  const recordIds = [...latestByBrand.values()].map(r => r.id);
  const recordToBrand = new Map<string, string>();
  for (const [brandId, row] of latestByBrand) recordToBrand.set(row.id, brandId);

  // Só itens que não fecharam: 'correct' não é divergência e ocuparia o payload à toa.
  const { data: items, error: itemsError } = await supabase
    .from('inventory_count_import_items')
    .select('count_record_id, sku, produto_nome, local, status, responsavel')
    .eq('company_id', companyId)
    .in('count_record_id', recordIds)
    .in('status', ['divergent', 'missing', 'surplus']);

  if (itemsError) {
    console.error('[heatmap] falha ao carregar itens da contagem:', itemsError.message);
  }

  const skusByBrand = new Map<string, string[]>();
  const locationsByBrand = new Map<string, Set<string>>();
  const itemResponsibleByBrand = new Map<string, string>();

  for (const item of ((items ?? []) as ImportItemRow[])) {
    const brandId = recordToBrand.get(item.count_record_id);
    if (brandId == null) continue;

    const label = item.sku?.trim() || item.produto_nome?.trim();
    if (label) {
      const list = skusByBrand.get(brandId) ?? [];
      if (list.length < MAX_DIVERGENT_SKUS && !list.includes(label)) list.push(label);
      skusByBrand.set(brandId, list);
    }

    const local = item.local?.trim();
    if (local) {
      const set = locationsByBrand.get(brandId) ?? new Set<string>();
      if (set.size < MAX_LOCATIONS) set.add(local);
      locationsByBrand.set(brandId, set);
    }

    // Fallback de responsável: quando a contagem foi importada, o operador costuma vir
    // no item e não no cabeçalho do registro.
    const responsible = item.responsavel?.trim();
    if (responsible && !itemResponsibleByBrand.has(brandId)) {
      itemResponsibleByBrand.set(brandId, responsible);
    }
  }

  for (const [brandId, record] of latestByBrand) {
    const locations = [...(locationsByBrand.get(brandId) ?? [])];

    details.set(brandId, {
      responsavel: joinOperators(record) || itemResponsibleByBrand.get(brandId) || '',
      observacoes: record.observacoes?.trim() ?? '',
      ultimaAtualizacao: record.created_at,
      produtosDivergentes: skusByBrand.get(brandId) ?? [],
      locaisFisicos: locations.map<LocalFisico>((nome, index) => ({
        id: `${brandId}-local-${index}`,
        nome,
        descricao: 'Local registrado na contagem',
      })),
    });
  }

  return details;
}
