// Curva ABC — motor de cálculo puro (sem I/O). Agrega vendas por SKU, junta com preços/custos
// e estoque (snapshot próprio do módulo, nunca o do Inventário), calcula CMV/lucro/margem e
// classifica em três curvas ABC independentes (giro, faturamento, lucro). Nada aqui grava dado
// nem lê o módulo de Inventário — os inputs chegam já parseados da planilha.

import { normalizeSku, parseNumber, type RawRow } from './abcCurveParsing';

export interface VendaRow {
  produto?: string;
  sku?: string;
  quantidade?: string | number;
  valor?: string | number;
  frete?: string | number;
}

export interface PrecoCustoRow {
  descricao?: string;
  sku?: string;
  preco?: string | number;
  precoPromocional?: string | number;
  custo?: string | number;
}

export interface EstoqueRow {
  sku?: string;
  estoqueDisponivel?: string | number;
  estoqueReservado?: string | number;
  comprasEmTransito?: string | number;
  leadTimeDias?: string | number;
  estoqueSeguranca?: string | number;
}

export interface RowIssue {
  rowIndex: number;
  message: string;
}

export type CostState = 'NORMAL' | 'SEM_CUSTO' | 'PREJUIZO';
export type AbcClass = 'A' | 'B' | 'C' | null;

export interface SkuSnapshot {
  sku: string;
  productName: string | null;
  quantity: number;
  revenue: number;
  freight: number;
  avgPrice: number | null;
  listPrice: number | null;
  promoPrice: number | null;
  cost: number | null;
  cogs: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  realizedMarkup: number | null;
  priceRealization: number | null;
  turnoverClass: AbcClass;
  revenueClass: AbcClass;
  profitClass: AbcClass;
  costState: CostState;
  stockAvailable: number | null;
  stockReserved: number | null;
  stockInTransit: number | null;
  leadTimeDays: number | null;
  safetyStock: number | null;
  dailyDemand: number | null;
  coverageDays: number | null;
  reorderPoint: number | null;
  suggestedPurchase: number | null;
}

export interface AggregatedSales {
  sku: string;
  productName: string | null;
  quantity: number;
  revenue: number;
  freight: number;
}

// Agrega linhas repetidas pelo mesmo SKU (normalizando só espaços nas extremidades). SKU ausente
// bloqueia a linha (registrada em errors) — vendas exigem SKU, diferente da lista de preços.
export const aggregateVendas = (rows: RawRow[]): { aggregated: AggregatedSales[]; errors: RowIssue[] } => {
  const errors: RowIssue[] = [];
  const bySku = new Map<string, AggregatedSales>();

  rows.forEach((row, idx) => {
    const sku = normalizeSku(row.sku);
    const quantidade = parseNumber(row.quantidade);
    const valor = parseNumber(row.valor);

    if (!sku) {
      errors.push({ rowIndex: idx, message: 'SKU ausente no arquivo de vendas.' });
      return;
    }
    if (quantidade === null || valor === null) {
      errors.push({ rowIndex: idx, message: 'Quantidade ou faturamento ausente.' });
      return;
    }

    const freight = parseNumber(row.frete) ?? 0;
    const existing = bySku.get(sku);
    if (existing) {
      existing.quantity += quantidade;
      existing.revenue += valor;
      existing.freight += freight;
    } else {
      bySku.set(sku, {
        sku,
        productName: row.produto ? String(row.produto).trim() : null,
        quantity: quantidade,
        revenue: valor,
        freight,
      });
    }
  });

  return { aggregated: Array.from(bySku.values()), errors };
};

// Linhas sem SKU na lista de preços são ignoradas e viram aviso — nunca agrupadas como produto vazio.
export const buildPricingMap = (rows: RawRow[]): { map: Map<string, { listPrice: number | null; promoPrice: number | null; cost: number | null }>; warnings: string[] } => {
  const map = new Map<string, { listPrice: number | null; promoPrice: number | null; cost: number | null }>();
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    const sku = normalizeSku(row.sku);
    if (!sku) {
      warnings.push(`Preços/custos linha ${idx + 1}: sem SKU, ignorada.`);
      return;
    }
    if (map.has(sku)) warnings.push(`Preços/custos: SKU "${sku}" duplicado, mantida a última ocorrência.`);
    map.set(sku, {
      listPrice: parseNumber(row.preco),
      promoPrice: parseNumber(row.precoPromocional),
      cost: parseNumber(row.custo),
    });
  });

  return { map, warnings };
};

export interface StockInfo {
  stockAvailable: number | null; stockReserved: number | null; stockInTransit: number | null;
  leadTimeDays: number | null; safetyStock: number | null;
}

export const buildStockMap = (rows: RawRow[]): Map<string, StockInfo> => {
  const map = new Map<string, StockInfo>();
  rows.forEach(row => {
    const sku = normalizeSku(row.sku);
    if (!sku) return;
    map.set(sku, {
      stockAvailable: parseNumber(row.estoqueDisponivel),
      stockReserved: parseNumber(row.estoqueReservado),
      stockInTransit: parseNumber(row.comprasEmTransito),
      leadTimeDays: parseNumber(row.leadTimeDias),
      safetyStock: parseNumber(row.estoqueSeguranca),
    });
  });
  return map;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface BuildSnapshotsInput {
  vendas: AggregatedSales[];
  pricing: Map<string, { listPrice: number | null; promoPrice: number | null; cost: number | null }>;
  stock: Map<string, StockInfo> | null;
  periodDays: number;
  thresholdA?: number;
  thresholdB?: number;
}

// Monta um snapshot por SKU com métricas de rentabilidade + estoque (quando houver) + as três
// classes ABC (giro/faturamento/lucro), calculadas de forma independente entre si.
export const buildSkuSnapshots = ({ vendas, pricing, stock, periodDays, thresholdA = 80, thresholdB = 95 }: BuildSnapshotsInput): SkuSnapshot[] => {
  const snapshots: SkuSnapshot[] = vendas.map(v => {
    const priceInfo = pricing.get(v.sku) ?? null;
    const stockInfo = stock?.get(v.sku) ?? null;
    const avgPrice = v.quantity > 0 ? v.revenue / v.quantity : null;
    const cost = priceInfo?.cost && priceInfo.cost > 0 ? priceInfo.cost : null;

    let cogs: number | null = null;
    let grossProfit: number | null = null;
    let grossMargin: number | null = null;
    let realizedMarkup: number | null = null;
    let costState: CostState = 'NORMAL';

    if (cost !== null) {
      cogs = v.quantity * cost;
      grossProfit = v.revenue - cogs;
      grossMargin = v.revenue > 0 ? grossProfit / v.revenue : null;
      realizedMarkup = avgPrice !== null ? avgPrice / cost : null;
      costState = grossProfit < 0 ? 'PREJUIZO' : 'NORMAL';
    } else {
      costState = 'SEM_CUSTO';
    }

    const listPrice = priceInfo?.listPrice ?? null;
    const priceRealization = avgPrice !== null && listPrice && listPrice > 0 ? avgPrice / listPrice : null;

    let dailyDemand: number | null = null;
    let coverageDays: number | null = null;
    let reorderPoint: number | null = null;
    let suggestedPurchase: number | null = null;
    if (stockInfo && stockInfo.stockAvailable !== null && periodDays > 0) {
      dailyDemand = v.quantity / periodDays;
      coverageDays = dailyDemand > 0 ? stockInfo.stockAvailable / dailyDemand : null;
      if (stockInfo.leadTimeDays !== null) {
        const safety = stockInfo.safetyStock ?? 0;
        reorderPoint = dailyDemand * stockInfo.leadTimeDays + safety;
        suggestedPurchase = Math.max(0, reorderPoint - stockInfo.stockAvailable - (stockInfo.stockInTransit ?? 0));
      }
    }

    return {
      sku: v.sku,
      productName: v.productName,
      quantity: v.quantity,
      revenue: round2(v.revenue),
      freight: round2(v.freight),
      avgPrice: avgPrice !== null ? round2(avgPrice) : null,
      listPrice,
      promoPrice: priceInfo?.promoPrice ?? null,
      cost,
      cogs: cogs !== null ? round2(cogs) : null,
      grossProfit: grossProfit !== null ? round2(grossProfit) : null,
      grossMargin,
      realizedMarkup,
      priceRealization,
      turnoverClass: null,
      revenueClass: null,
      profitClass: null,
      costState,
      stockAvailable: stockInfo?.stockAvailable ?? null,
      stockReserved: stockInfo?.stockReserved ?? null,
      stockInTransit: stockInfo?.stockInTransit ?? null,
      leadTimeDays: stockInfo?.leadTimeDays ?? null,
      safetyStock: stockInfo?.safetyStock ?? null,
      dailyDemand,
      coverageDays,
      reorderPoint,
      suggestedPurchase,
    };
  });

  classifyInPlace(snapshots, s => s.quantity, (s, c) => { s.turnoverClass = c; }, thresholdA, thresholdB);
  classifyInPlace(snapshots, s => s.revenue, (s, c) => { s.revenueClass = c; }, thresholdA, thresholdB);
  classifyInPlace(
    snapshots,
    s => (s.costState === 'NORMAL' && s.grossProfit !== null && s.grossProfit > 0 ? s.grossProfit : 0),
    (s, c) => { s.profitClass = c; },
    thresholdA, thresholdB,
    s => s.costState === 'NORMAL' && s.grossProfit !== null && s.grossProfit > 0
  );

  return snapshots;
};

// Ordena decrescente pela métrica, calcula % acumulado e classifica A (até thresholdA%),
// B (até thresholdB%) ou C (acima) — só entre os itens elegíveis (valor > 0 por padrão).
function classifyInPlace<T>(
  items: T[],
  metric: (item: T) => number,
  assign: (item: T, cls: AbcClass) => void,
  thresholdA: number,
  thresholdB: number,
  eligible: (item: T) => boolean = item => metric(item) > 0
): void {
  const ranked = items.filter(eligible).sort((a, b) => metric(b) - metric(a));
  const total = ranked.reduce((sum, item) => sum + metric(item), 0);
  let cumulative = 0;
  for (const item of ranked) {
    cumulative += metric(item);
    const pct = total > 0 ? (cumulative / total) * 100 : 0;
    assign(item, pct <= thresholdA ? 'A' : pct <= thresholdB ? 'B' : 'C');
  }
}
