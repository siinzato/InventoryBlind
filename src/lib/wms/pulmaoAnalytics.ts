// Indicadores gerenciais do pulmão.
//
// Tudo é conta sobre dado já registrado: endereços, saldo e histórico. Nenhuma consulta
// aqui, nenhum saldo paralelo, nenhum número estimado.
//
// ── A distinção que o módulo precisa manter ─────────────────────────────────────────
//
// Ocupação por ENDEREÇO e ocupação por CAPACIDADE são coisas diferentes, e misturar as
// duas é o erro clássico: "70% ocupado" pode significar 7 de 10 vagas com alguma coisa
// dentro, ou 70% do volume declarado consumido. A primeira sempre dá para calcular; a
// segunda só existe onde alguém declarou `capacity_boxes`.
//
// Por isso `capacity` é um bloco separado e ANULÁVEL. Sem capacidade declarada em vaga
// nenhuma, ele é `null` — e a tela diz que não há base, em vez de mostrar 0% ou 100%,
// que seriam as duas leituras erradas do mesmo vazio.

import { bucketOf, daysSince, type AgeBucket } from './stockInsights';
import type { StockPlacement } from './stockInsights';
import type { StorageBin } from './wmsService';

export type MovementType = 'entrada' | 'saida' | 'transferencia';

/** Movimento, no mínimo que os indicadores precisam. */
export interface AnalyticsMovement {
  id: string;
  movementType: MovementType;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  fromCode: string | null;
  toCode: string | null;
  boxes: number;
  createdAt: string;
  createdBy: string | null;
  operatorName: string | null;
}

// ── Ocupação ─────────────────────────────────────────────────────────────────────────

export interface BinOccupancySummary {
  total: number;
  occupied: number;
  free: number;
  blocked: number;
  /** Fração de 0 a 1 sobre o total de endereços. Sempre calculável. */
  occupiedRatio: number;
}

export interface CapacitySummary {
  /** Endereços que declararam capacidade — o denominador é só deles. */
  declaredBins: number;
  totalBoxes: number;
  usedBoxes: number;
  freeBoxes: number;
  usedRatio: number;
}

export function occupancySummary(bins: StorageBin[], placements: StockPlacement[]): BinOccupancySummary {
  const comSaldo = new Set(placements.filter(p => p.boxes > 0).map(p => p.binCode));
  const total = bins.length;
  const occupied = bins.filter(b => comSaldo.has(b.code)).length;
  const blocked = bins.filter(b => b.blocked).length;
  return {
    total,
    occupied,
    // Livre é "sem mercadoria", incluindo bloqueado vazio: bloqueio não é ocupação.
    free: total - occupied,
    blocked,
    occupiedRatio: total > 0 ? occupied / total : 0,
  };
}

/** `null` quando NENHUM endereço declarou capacidade — não há denominador e inventar um
 *  transformaria "não sabemos" em "0%" ou "100%", que são afirmações diferentes. */
export function capacitySummary(bins: StorageBin[], placements: StockPlacement[]): CapacitySummary | null {
  const declaradas = bins.filter(b => b.capacityBoxes != null);
  if (declaradas.length === 0) return null;

  const codigos = new Set(declaradas.map(b => b.code));
  const totalBoxes = declaradas.reduce((acc, b) => acc + (b.capacityBoxes ?? 0), 0);
  const usedBoxes = placements
    .filter(p => codigos.has(p.binCode))
    .reduce((acc, p) => acc + p.boxes, 0);

  return {
    declaredBins: declaradas.length,
    totalBoxes,
    usedBoxes,
    freeBoxes: Math.max(0, totalBoxes - usedBoxes),
    usedRatio: totalBoxes > 0 ? usedBoxes / totalBoxes : 0,
  };
}

// ── Movimentação ─────────────────────────────────────────────────────────────────────

export interface MovementSummary {
  entradas: number;
  saidas: number;
  transferencias: number;
  total: number;
  /** Caixas movimentadas, por tipo. Contagem de documentos não é volume. */
  boxesIn: number;
  boxesOut: number;
  boxesMoved: number;
}

export function movementSummary(movements: AnalyticsMovement[]): MovementSummary {
  const s: MovementSummary = {
    entradas: 0, saidas: 0, transferencias: 0, total: movements.length,
    boxesIn: 0, boxesOut: 0, boxesMoved: 0,
  };
  for (const m of movements) {
    if (m.movementType === 'entrada') { s.entradas += 1; s.boxesIn += m.boxes; }
    else if (m.movementType === 'saida') { s.saidas += 1; s.boxesOut += m.boxes; }
    else { s.transferencias += 1; s.boxesMoved += m.boxes; }
  }
  return s;
}

export interface Tally { key: string; label: string; count: number; boxes: number }

const rank = (mapa: Map<string, Tally>, limit: number): Tally[] =>
  [...mapa.values()]
    .sort((a, b) => b.count - a.count || b.boxes - a.boxes || a.label.localeCompare(b.label))
    .slice(0, limit);

/** Operador sem nome visível aparece como "—", nunca com o uuid cru: identificador
 *  interno na tela não informa ninguém e vaza estrutura à toa. */
export function byOperator(movements: AnalyticsMovement[], limit = 10): Tally[] {
  const mapa = new Map<string, Tally>();
  for (const m of movements) {
    const key = m.createdBy ?? 'sem-autor';
    const atual = mapa.get(key) ?? { key, label: m.operatorName ?? '—', count: 0, boxes: 0 };
    atual.count += 1;
    atual.boxes += m.boxes;
    if (m.operatorName) atual.label = m.operatorName;
    mapa.set(key, atual);
  }
  return rank(mapa, limit);
}

/** Um movimento toca até DOIS endereços (transferência). Os dois contam — a pergunta é
 *  "qual vaga mais se mexeu", não "de onde saiu". */
export function byBin(movements: AnalyticsMovement[], limit = 10): Tally[] {
  const mapa = new Map<string, Tally>();
  const soma = (code: string | null, boxes: number) => {
    if (!code) return;
    const atual = mapa.get(code) ?? { key: code, label: code, count: 0, boxes: 0 };
    atual.count += 1;
    atual.boxes += boxes;
    mapa.set(code, atual);
  };
  for (const m of movements) {
    soma(m.fromCode, m.boxes);
    soma(m.toCode, m.boxes);
  }
  return rank(mapa, limit);
}

/** Movimentos por dia, para a série do período. Dias sem movimento entram com zero —
 *  buraco na série some no gráfico e mente sobre a cadência. */
export function byDay(movements: AnalyticsMovement[], fromISO: string, toISO: string): Array<{ day: string; count: number }> {
  const contagem = new Map<string, number>();
  for (const m of movements) {
    const dia = m.createdAt.slice(0, 10);
    contagem.set(dia, (contagem.get(dia) ?? 0) + 1);
  }

  const serie: Array<{ day: string; count: number }> = [];
  const inicio = new Date(fromISO.slice(0, 10) + 'T00:00:00Z').getTime();
  const fim = new Date(toISO.slice(0, 10) + 'T00:00:00Z').getTime();
  // Teto defensivo: período absurdo não vira série de milhares de pontos.
  for (let t = inicio, i = 0; t <= fim && i < 400; t += 86_400_000, i += 1) {
    const dia = new Date(t).toISOString().slice(0, 10);
    serie.push({ day: dia, count: contagem.get(dia) ?? 0 });
  }
  return serie;
}

// ── Permanência ──────────────────────────────────────────────────────────────────────

export interface AgingRow {
  binCode: string;
  sku: string;
  productName: string;
  boxes: number;
  units: number;
  days: number;
  bucket: AgeBucket;
  firstStoredAt: string;
}

/** Posições mais antigas primeiro. É a lista que responde "o que está encalhado". */
export function agingRows(placements: StockPlacement[], now: number, limit = 50): AgingRow[] {
  return placements
    .map(p => {
      const days = daysSince(p.firstStoredAt, now);
      return {
        binCode: p.binCode,
        sku: p.sku,
        productName: p.productName,
        boxes: p.boxes,
        units: p.units,
        days,
        bucket: bucketOf(days),
        firstStoredAt: p.firstStoredAt,
      };
    })
    .sort((a, b) => b.days - a.days || a.binCode.localeCompare(b.binCode))
    .slice(0, limit);
}

/** Caixas por faixa de permanência — volume, não contagem de linhas: duas posições de
 *  1 caixa não pesam o mesmo que uma de 40. */
export function boxesByBucket(placements: StockPlacement[], now: number): Record<AgeBucket, number> {
  const r: Record<AgeBucket, number> = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
  for (const p of placements) r[bucketOf(daysSince(p.firstStoredAt, now))] += p.boxes;
  return r;
}

export interface SkuFootprint {
  productId: string;
  sku: string;
  productName: string;
  boxes: number;
  units: number;
  bins: number;
  oldestDays: number;
}

/** Quem mais ocupa espaço. Em CAIXAS, que é a medida que todo endereço tem — percentual
 *  de capacidade só existiria onde a capacidade foi declarada. */
export function skuFootprint(placements: StockPlacement[], now: number, limit = 20): SkuFootprint[] {
  const mapa = new Map<string, SkuFootprint>();
  for (const p of placements) {
    const atual = mapa.get(p.productId) ?? {
      productId: p.productId, sku: p.sku, productName: p.productName,
      boxes: 0, units: 0, bins: 0, oldestDays: 0,
    };
    atual.boxes += p.boxes;
    atual.units += p.units;
    atual.bins += 1;
    atual.oldestDays = Math.max(atual.oldestDays, daysSince(p.firstStoredAt, now));
    mapa.set(p.productId, atual);
  }
  return [...mapa.values()]
    .sort((a, b) => b.boxes - a.boxes || a.sku.localeCompare(b.sku))
    .slice(0, limit);
}

// ── Exportação ───────────────────────────────────────────────────────────────────────

/**
 * CSV com separador `;`.
 *
 * Ponto e vírgula porque o Excel em português usa a vírgula como separador DECIMAL: com
 * `,` a planilha abre tudo numa coluna só. O BOM que o `downloadCsvText` acrescenta é a
 * outra metade — sem ele o Excel come os acentos.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const campo = (v: string | number | null): string => {
    const s = v == null ? '' : String(v);
    // Aspas duplicadas dentro de aspas: a regra do CSV. Sem isso um nome de produto com
    // `;` ou quebra de linha desloca todas as colunas seguintes.
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map(linha => linha.map(campo).join(';')).join('\r\n');
}

const dia = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR');

export const csvOccupancy = (bins: StorageBin[], placements: StockPlacement[]): string => {
  const porVaga = new Map<string, { boxes: number; skus: number }>();
  for (const p of placements) {
    const a = porVaga.get(p.binCode) ?? { boxes: 0, skus: 0 };
    a.boxes += p.boxes;
    a.skus += 1;
    porVaga.set(p.binCode, a);
  }
  return toCsv(
    ['Endereco', 'Situacao', 'Capacidade (cx)', 'Caixas', 'SKUs distintos'],
    bins.map(b => {
      const o = porVaga.get(b.code);
      return [
        b.code,
        b.blocked ? 'Bloqueado' : o ? 'Ocupado' : 'Livre',
        b.capacityBoxes ?? 'nao declarada',
        o?.boxes ?? 0,
        o?.skus ?? 0,
      ];
    }),
  );
};

export const csvPlacements = (placements: StockPlacement[], now: number): string =>
  toCsv(
    ['Endereco', 'SKU', 'Produto', 'Caixas', 'Un/caixa', 'Unidades', 'Guardado em', 'Dias'],
    agingRows(placements, now, placements.length).map(r => [
      r.binCode, r.sku, r.productName, r.boxes,
      r.units && r.boxes ? Math.round(r.units / r.boxes) : '',
      r.units, dia(r.firstStoredAt), r.days,
    ]),
  );

export const csvSkuFootprint = (placements: StockPlacement[], now: number): string =>
  toCsv(
    ['SKU', 'Produto', 'Caixas', 'Unidades', 'Enderecos', 'Dias parado'],
    skuFootprint(placements, now, placements.length).map(r => [
      r.sku, r.productName, r.boxes, r.units, r.bins, r.oldestDays,
    ]),
  );

export const csvMovements = (movements: AnalyticsMovement[]): string =>
  toCsv(
    ['Data', 'Tipo', 'SKU', 'Produto', 'Origem', 'Destino', 'Caixas', 'Operador'],
    movements.map(m => [
      new Date(m.createdAt).toLocaleString('pt-BR'),
      m.movementType, m.sku, m.productName,
      m.fromCode, m.toCode, m.boxes, m.operatorName ?? '',
    ]),
  );
