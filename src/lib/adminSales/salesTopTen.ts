// Top 10 de vendas — agregação pura sobre registros já importados (sales_records).
// Nunca lê/escreve estoque, inventário ou contagem: é só leitura analítica.

export interface SalesRecordInput {
  saleDate: string; // YYYY-MM-DD
  sku: string | null;
  productName: string;
  quantity: number;
  totalValue: number;
}

export type TopTenMetric = 'quantidade' | 'faturamento';
export type TopTenPeriodPreset = '7d' | '30d' | 'mes_atual' | 'custom';

export interface TopTenPeriod {
  preset: TopTenPeriodPreset;
  from?: string; // YYYY-MM-DD, obrigatório quando preset === 'custom'
  to?: string;
}

export interface TopTenEntry {
  position: number;
  sku: string | null;
  productName: string;
  quantity: number;
  totalValue: number;
}

// Resolve o período efetivo [from, to] (inclusive) a partir do preset e da data de referência.
export function resolvePeriodRange(period: TopTenPeriod, referenceDate: Date): { from: string; to: string } {
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  const ref = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));

  switch (period.preset) {
    case '7d': {
      const from = new Date(ref); from.setUTCDate(from.getUTCDate() - 6);
      return { from: toIso(from), to: toIso(ref) };
    }
    case '30d': {
      const from = new Date(ref); from.setUTCDate(from.getUTCDate() - 29);
      return { from: toIso(from), to: toIso(ref) };
    }
    case 'mes_atual': {
      const from = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
      return { from: toIso(from), to: toIso(ref) };
    }
    case 'custom':
      return { from: period.from ?? toIso(ref), to: period.to ?? toIso(ref) };
  }
}

export function filterRecordsByPeriod(records: SalesRecordInput[], range: { from: string; to: string }): SalesRecordInput[] {
  return records.filter(r => r.saleDate >= range.from && r.saleDate <= range.to);
}

// Agrega por SKU (produtos sem SKU são agrupados individualmente por nome, nunca somados
// entre si — evitaria misturar produtos distintos só porque nenhum tinha código).
export function aggregateTopTen(records: SalesRecordInput[], metric: TopTenMetric, limit = 10): TopTenEntry[] {
  const groups = new Map<string, { sku: string | null; productName: string; quantity: number; totalValue: number }>();

  for (const r of records) {
    const key = r.sku ?? `__no_sku__:${r.productName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += r.quantity;
      existing.totalValue += r.totalValue;
    } else {
      groups.set(key, { sku: r.sku, productName: r.productName, quantity: r.quantity, totalValue: r.totalValue });
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) =>
    metric === 'quantidade' ? b.quantity - a.quantity : b.totalValue - a.totalValue
  );

  return sorted.slice(0, limit).map((entry, idx) => ({ position: idx + 1, ...entry }));
}

export function computeTopTen(
  records: SalesRecordInput[],
  metric: TopTenMetric,
  period: TopTenPeriod,
  referenceDate: Date,
  limit = 10
): TopTenEntry[] {
  const range = resolvePeriodRange(period, referenceDate);
  const filtered = filterRecordsByPeriod(records, range);
  return aggregateTopTen(filtered, metric, limit);
}
