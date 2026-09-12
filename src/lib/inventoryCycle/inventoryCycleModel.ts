// Modelo por SKU do inventário: tipos e derivações PURAS. Nada de I/O aqui.
//
// A linha é só agrupamento: total, contados, pendentes, progresso e acuracidade de uma
// linha são a soma dos seus itens, nunca um número digitado. Por isso este módulo não tem
// fórmula própria de acuracidade — reaproveita `computeAccuracy` (migration 001 do
// domínio, usada pelo modelo agregado desde sempre) para que Dashboard, ranking e
// histórico continuem calculando a mesma coisa.

import { computeAccuracy } from '../blindAIAgentAlgorithm';
import type { BrandData } from '../domainTypes';

export type InventoryCycleStatus = 'active' | 'closed';
export type InventoryItemStatus = 'pending' | 'counted';

export interface InventoryCycle {
  id: string;
  companyId: string;
  name: string;
  status: InventoryCycleStatus;
  countingModel: 'sku';
  startedAt: string;
  closedAt: string | null;
  notes: string | null;
}

export interface InventoryItem {
  id: string;
  cycleId: string;
  productId: string;
  sku: string;
  productName: string;
  location: string | null;
  brandId: string | null;
  brandName: string | null;
  lineId: string | null;
  lineName: string | null;
  status: InventoryItemStatus;
  expectedQuantity: number | null;
  countedQuantity: number | null;
  countedAt: string | null;
  countedByName: string | null;
  observation: string | null;
  divergence: boolean;
}

/** Uma linha do agrupamento, como a view devolve. */
export interface CycleLineSummary {
  groupKey: string;
  lineId: string | null;
  brandId: string | null;
  label: string;
  totalSku: number;
  doneSku: number;
  divergences: number;
}

/** Linha pronta para exibição, com o que é derivado já derivado. */
export interface CycleLineRow extends CycleLineSummary {
  pendingSku: number;
  progress: number;
  accuracy: number | null;
  concluded: boolean;
}

export const UNCLASSIFIED_LABEL = 'Sem classificação';

/** Progresso da linha. Mesma conta do modelo agregado, com o mesmo teto de 100%. */
export function lineProgress(doneSku: number, totalSku: number): number {
  if (totalSku <= 0) return 0;
  return Math.min(100, (doneSku / totalSku) * 100);
}

/** Ordena por volume e, no empate, por rótulo — determinístico, sem depender da ordem
 *  em que o banco devolveu os grupos. */
export function buildCycleLineRows(summaries: CycleLineSummary[]): CycleLineRow[] {
  return [...summaries]
    .map(s => {
      const progress = lineProgress(s.doneSku, s.totalSku);
      return {
        ...s,
        pendingSku: Math.max(0, s.totalSku - s.doneSku),
        progress,
        accuracy: computeAccuracy(s.doneSku, s.divergences),
        concluded: s.totalSku > 0 && s.doneSku >= s.totalSku,
      };
    })
    .sort((a, b) => (b.totalSku !== a.totalSku ? b.totalSku - a.totalSku : a.label.localeCompare(b.label, 'pt-BR')));
}

/**
 * Converte o agrupamento por linha na mesma forma que o Dashboard já consome
 * (`BrandData`), para que `computeGlobalStats` — e tudo que vive dele: resumo executivo,
 * prioridades, ranking, BlindAI — passe a funcionar por linha de produto sem nenhuma
 * fórmula duplicada. `order_index` só serve à ordenação do modelo agregado; aqui a ordem
 * já vem resolvida por volume.
 */
export function cycleLinesAsBrandData(summaries: CycleLineSummary[]): BrandData[] {
  return buildCycleLineRows(summaries).map((row, index) => ({
    id: row.groupKey,
    brand: row.label,
    total_sku: row.totalSku,
    done_sku: row.doneSku,
    divergences: row.divergences,
    order_index: index,
    created_at: '',
    updated_at: '',
  }));
}

export interface CycleTotals {
  totalSku: number;
  doneSku: number;
  pendingSku: number;
  divergences: number;
  progress: number;
  accuracy: number | null;
  lines: number;
}

export function cycleTotals(summaries: CycleLineSummary[]): CycleTotals {
  const totalSku = summaries.reduce((acc, s) => acc + s.totalSku, 0);
  const doneSku = summaries.reduce((acc, s) => acc + s.doneSku, 0);
  const divergences = summaries.reduce((acc, s) => acc + s.divergences, 0);
  return {
    totalSku,
    doneSku,
    pendingSku: Math.max(0, totalSku - doneSku),
    divergences,
    progress: lineProgress(doneSku, totalSku),
    accuracy: computeAccuracy(doneSku, divergences),
    lines: summaries.length,
  };
}

/** Divergência é derivada do próprio item, igual à coluna gerada da migration 112 — a UI
 *  mostra o mesmo critério do banco, em vez de um segundo julgamento. */
export function itemHasDivergence(item: Pick<InventoryItem, 'status' | 'expectedQuantity' | 'countedQuantity'>): boolean {
  return item.status === 'counted'
    && item.expectedQuantity !== null
    && item.countedQuantity !== item.expectedQuantity;
}

export interface ItemFilters {
  search: string;
  /** groupKey da linha, 'all' para todas. */
  group: string;
  status: 'all' | 'pending' | 'counted' | 'divergent';
}

export const EMPTY_ITEM_FILTERS: ItemFilters = { search: '', group: 'all', status: 'all' };

/** Filtro local da lista de contagem. Nunca muta a entrada. */
export function filterItems(items: InventoryItem[], filters: ItemFilters): InventoryItem[] {
  const term = filters.search.trim().toLowerCase();
  return items.filter(item => {
    if (filters.group !== 'all' && groupKeyOf(item) !== filters.group) return false;
    if (filters.status === 'pending' && item.status !== 'pending') return false;
    if (filters.status === 'counted' && item.status !== 'counted') return false;
    if (filters.status === 'divergent' && !item.divergence) return false;
    if (term && !`${item.sku} ${item.productName}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

/** Mesma chave de agrupamento da view: linha, senão marca, senão sem classificação. */
export function groupKeyOf(item: Pick<InventoryItem, 'lineId' | 'brandId'>): string {
  if (item.lineId) return item.lineId;
  if (item.brandId) return `brand:${item.brandId}`;
  return 'sem-classificacao';
}

export function groupLabelOf(item: Pick<InventoryItem, 'lineName' | 'brandName'>): string {
  return item.lineName ?? item.brandName ?? UNCLASSIFIED_LABEL;
}

// ── Ciclo atual: trabalho já concluído no modelo agregado ──────────────────────────────
//
// O ciclo em andamento foi contado ANTES de o catálogo ser reorganizado, e foi registrado
// como um total por LINHA DE CONTAGEM, sem identificar quais SKUs foram contados. Esse
// dado é real e não pode ser perdido, mas também não pode ser esticado até virar
// granularidade que ele nunca teve: não existe registro de QUAIS produtos foram contados,
// então nenhum produto é marcado como contado individualmente.
//
// O que sobrevive é o número por linha. A tabela abaixo é o único lugar onde a
// correspondência "linha de contagem -> agrupamento atual" está escrita, porque ela só
// existe no nome — nenhuma coluna do banco liga uma coisa à outra. Não é uma lista de
// linhas do Dashboard: as linhas continuam vindo do catálogo, e uma linha nova aparece
// sozinha. Só o trabalho JÁ FEITO precisa desta ponte, e só enquanto este ciclo durar.

export interface CurrentCycleCarry {
  /** `inventory_brands.brand` — a linha em que o operador registrou a contagem. */
  countingLine: string;
  /** Rótulo do agrupamento atual (nome da linha ou, sem linhas, da marca). */
  group: string;
}

/** Correspondências diretas, e somente as diretas. Ficam de fora, por decisão explícita:
 *
 *  - `Linha de Outlet e PET` (402 SKUs, 24 contados): agregava duas linhas que hoje são
 *    separadas e o registro não diz quantos couberam a cada uma. Outlet e Linha PET
 *    entram no Dashboard com todos os seus SKUs pendentes, para recontagem.
 *  - `Térmicos GC` (97 contados, 41 divergências): a contagem foi feita quando garrafas,
 *    copos e taças térmicas estavam todos no mesmo grupo. Depois da correção da família
 *    térmica — Garrafas Térmicas e Copos Térmicos separadas —, o número por linha não diz
 *    quantos couberam a cada uma, e só uma recontagem dá resultado confiável. A contagem
 *    continua registrada em `inventory_brands` e no histórico; só não conta como progresso
 *    do ciclo atual.
 *  - as demais 19 linhas de contagem, que não têm contagem nenhuma para transportar.
 */
export const CURRENT_CYCLE_CARRIES: CurrentCycleCarry[] = [
  { countingLine: 'Nillkin', group: 'Nillkin' },
  { countingLine: 'Linha Joy GC', group: 'Joy' },
  // Tote Moon foi consolidada em Tote na reorganização; os 2 contados são produtos Tote.
  { countingLine: 'Linha Tote Moon GC', group: 'Tote' },
];

const sameLabel = (a: string, b: string): boolean =>
  a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'base' }) === 0;

export interface MergedCurrentCycle {
  lines: CycleLineSummary[];
  /** Contagem transportada por agrupamento — o que o relatório precisa afirmar. */
  carried: { group: string; doneSku: number; divergences: number }[];
  /** Correspondência declarada que não achou par: nada é transportado às cegas. */
  unresolved: string[];
}

/**
 * Junta o universo atual (um item por produto, agrupado pela linha já classificada) com o
 * trabalho já concluído no ciclo em andamento.
 *
 *  - total de cada linha = universo ATUAL do catálogo, então SKU novo entra como pendente
 *    e linha que estava 100% volta a "em andamento" em vez de fingir conclusão;
 *  - contados = o que o ciclo tem de real: contagem por SKU (se houver) somada à contagem
 *    por linha já registrada, limitada ao total — nunca acima do universo;
 *  - divergências acompanham os contados e nunca passam deles;
 *  - progresso e acuracidade continuam saindo das fórmulas de sempre, a partir daqui.
 *
 * Nenhum produto novo herda contagem: o número transportado é da LINHA, e o que não foi
 * contado permanece pendente.
 */
export function mergeCurrentCycleCounts(
  universe: CycleLineSummary[],
  countingLines: Pick<BrandData, 'brand' | 'done_sku' | 'divergences'>[],
  carries: CurrentCycleCarry[] = CURRENT_CYCLE_CARRIES,
): MergedCurrentCycle {
  const carried: MergedCurrentCycle['carried'] = [];
  const unresolved: string[] = [];

  // Linha de contagem com o mesmo nome de um agrupamento atual não precisa de tabela:
  // a correspondência é o próprio nome. É isso que faz uma contagem registrada hoje em
  // `Ventosa` ou `Outlet` chegar ao Dashboard sem ninguém declarar nada — e o que
  // dispensa lista fixa. As correspondências explícitas acima vêm depois e vencem.
  const effective = new Map<string, CurrentCycleCarry>();
  for (const line of countingLines) {
    if (universe.some(group => sameLabel(group.label, line.brand))) {
      effective.set(line.brand.trim().toLowerCase(), { countingLine: line.brand, group: line.brand });
    }
  }
  for (const carry of carries) {
    effective.set(carry.countingLine.trim().toLowerCase(), carry);
  }

  const pending = [...effective.values()].map(carry => {
    const source = countingLines.find(line => sameLabel(line.brand, carry.countingLine));
    const targets = universe.filter(group => sameLabel(group.label, carry.group));
    // Sem par exato dos dois lados, ou com rótulo ambíguo, nada é transportado.
    if (!source || targets.length !== 1) {
      unresolved.push(carry.countingLine);
      return null;
    }
    return { groupKey: targets[0].groupKey, doneSku: source.done_sku, divergences: source.divergences };
  }).filter((entry): entry is { groupKey: string; doneSku: number; divergences: number } => entry !== null);

  const lines = universe.map(group => {
    const extra = pending.filter(entry => entry.groupKey === group.groupKey);
    if (extra.length === 0) return group;

    const doneSku = Math.min(
      group.totalSku,
      group.doneSku + extra.reduce((sum, entry) => sum + Math.max(0, entry.doneSku), 0),
    );
    const divergences = Math.min(
      doneSku,
      group.divergences + extra.reduce((sum, entry) => sum + Math.max(0, entry.divergences), 0),
    );
    carried.push({ group: group.label, doneSku: doneSku - group.doneSku, divergences: divergences - group.divergences });
    return { ...group, doneSku, divergences };
  });

  return { lines, carried, unresolved };
}

// ── Universo de EXIBIÇÃO: cadastro + inventário ────────────────────────────────────────
//
// A view agrega os ITENS do inventário, então uma marca ou linha recém-criada — que ainda
// não tem nenhum produto associado — simplesmente não existe nela. Isso é correto para
// medir o inventário e errado para listar o que está cadastrado: a linha existe, só está
// vazia. As funções abaixo juntam as duas coisas SEM criar taxonomia paralela: as
// entidades vêm de `product_brands`/`product_lines`, a mesma fonte canônica da tela
// Linhas e Marcas, e a chave de agrupamento é a mesma da view.

export interface RegisteredBrand {
  id: string;
  name: string;
  active: boolean;
}

export interface RegisteredLine {
  id: string;
  brandId: string;
  name: string;
  active: boolean;
}

/**
 * Acrescenta ao universo as entidades cadastradas que ainda não aparecem nele, sempre com
 * zero: 0 SKU, 0 contado, 0 divergência.
 *
 * Por que isso não mexe em métrica nenhuma: linha com `totalSku = 0` soma 0 em todos os
 * totais, tem progresso 0, acuracidade `null` (`computeAccuracy` exige `doneSku > 0`) e
 * fica de fora de destaques, prioridades e atenção, que exigem amostra. Ela existe para
 * ser listada e navegada, não para produzir dado operacional.
 *
 * Entidade INATIVA não entra: desativar tira a marca/linha das opções de vínculo futuro,
 * mas não apaga histórico — se ainda houver produto dela no inventário, o grupo continua
 * vindo da view normalmente, com seus números reais.
 */
export function withRegisteredTaxonomy(
  universe: CycleLineSummary[],
  brands: RegisteredBrand[],
  lines: RegisteredLine[],
): CycleLineSummary[] {
  const rows = [...universe];
  const presentLineIds = new Set(universe.map(group => group.lineId).filter((id): id is string => !!id));
  const presentKeys = new Set(universe.map(group => group.groupKey));

  const activeLines = lines.filter(line => line.active);

  for (const line of activeLines) {
    if (presentLineIds.has(line.id)) continue;
    rows.push({
      groupKey: line.id,
      lineId: line.id,
      brandId: line.brandId,
      label: line.name,
      totalSku: 0,
      doneSku: 0,
      divergences: 0,
    });
  }

  // Marca entra por si mesma só quando não tem nenhuma linha ativa — é exatamente o
  // critério da view, que agrupa pela marca quando o item não tem linha.
  const brandsWithActiveLine = new Set(activeLines.map(line => line.brandId));
  for (const brand of brands) {
    if (!brand.active || brandsWithActiveLine.has(brand.id)) continue;
    const key = `brand:${brand.id}`;
    if (presentKeys.has(key)) continue;
    rows.push({
      groupKey: key,
      lineId: null,
      brandId: brand.id,
      label: brand.name,
      totalSku: 0,
      doneSku: 0,
      divergences: 0,
    });
  }

  return rows;
}
