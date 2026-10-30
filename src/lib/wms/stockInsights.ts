// Onde está o SKU, quanto tem e há quanto tempo está parado.
//
// Tudo aqui é conta sobre dado que já existe: saldo (`warehouse_bin_stock`) e histórico
// (`warehouse_bin_movements`). Nenhuma fonte nova de saldo, nenhum número estimado.
//
// ── A limitação da antiguidade, que manda no desenho deste arquivo ───────────────────
//
// O saldo é UMA linha por (endereço, produto), com um único `first_stored_at`. Não há
// camadas de lote: o sistema não sabe que "5 caixas são de 01/10 e 3 de 20/10".
//
// O que as RPCs da 116 garantem sobre esse campo:
//   • entrada adicional do mesmo SKU mantém a data MAIS ANTIGA;
//   • transferência leva a data junto, e o destino fica com a mais antiga das duas;
//   • retirada que ZERA o saldo apaga a linha — a próxima entrada começa relógio novo;
//   • retirada PARCIAL não mexe na data.
//
// É a retirada parcial que cria a ambiguidade: entraram caixas em duas datas, saiu
// parte, e ninguém sabe quais saíram. As que ficaram podem ser todas da data nova.
//
// Logo: a permanência calculada é um LIMITE SUPERIOR — a real nunca é maior, pode ser
// menor. E dá para saber quando o número é exato, porque o histórico de movimentos
// nunca é editado nem apagado. Ver `certaintyOf`.

export type AgeCertainty = 'exata' | 'limite';

export type AgeBucket = '0-7' | '8-15' | '16-30' | '30+';

export const AGE_BUCKETS: { id: AgeBucket; label: string; short: string }[] = [
  { id: '0-7',   label: 'Até 7 dias',       short: '0–7d' },
  { id: '8-15',  label: 'De 8 a 15 dias',   short: '8–15d' },
  { id: '16-30', label: 'De 16 a 30 dias',  short: '16–30d' },
  { id: '30+',   label: 'Mais de 30 dias',  short: '+30d' },
];

export const bucketOf = (days: number): AgeBucket =>
  days <= 7 ? '0-7' : days <= 15 ? '8-15' : days <= 30 ? '16-30' : '30+';

/** Dias inteiros decorridos. `now` entra por parâmetro para o cálculo ser testável. */
export const daysSince = (iso: string, now: number): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

/** Uma posição ocupada: um SKU dentro de um endereço. */
export interface StockPlacement {
  productId: string;
  sku: string;
  productName: string;
  ean: string | null;
  binId: string;
  binCode: string;
  binBlocked: boolean;
  binCapacityBoxes: number | null;
  boxes: number;
  unitsPerBox: number;
  units: number;
  firstStoredAt: string;
}

/** Só o que a antiguidade precisa do histórico. */
export interface PlacementMovement {
  productId: string;
  fromBinId: string | null;
  toBinId: string | null;
  createdAt: string;
}

/**
 * A data do saldo é exata ou é um teto?
 *
 * Exata quando houve UMA entrada só desde `first_stored_at` (todas as caixas têm a
 * mesma data, então retirar parte não muda a idade da que sobrou), ou quando NÃO houve
 * saída nenhuma desde então (nada saiu, logo a caixa mais antiga continua ali).
 *
 * Nos demais casos — mais de uma entrada E alguma saída — não há como saber quais
 * caixas ficaram, e a data vira limite superior.
 */
export function certaintyOf(placement: StockPlacement, movements: PlacementMovement[]): AgeCertainty {
  const desde = new Date(placement.firstStoredAt).getTime();
  let entradas = 0;
  let saidas = 0;

  for (const mov of movements) {
    if (mov.productId !== placement.productId) continue;
    if (new Date(mov.createdAt).getTime() < desde) continue;
    if (mov.toBinId === placement.binId) entradas += 1;
    if (mov.fromBinId === placement.binId) saidas += 1;
  }

  return entradas <= 1 || saidas === 0 ? 'exata' : 'limite';
}

export interface PlacementView extends StockPlacement {
  days: number;
  certainty: AgeCertainty;
  bucket: AgeBucket;
}

export interface SkuSummary {
  productId: string;
  sku: string;
  productName: string;
  ean: string | null;
  /** Mais antigo primeiro: é a ordem em que o estoque deveria ser consumido. */
  placements: PlacementView[];
  totalBoxes: number;
  totalUnits: number;
  binCount: number;
  /** Packs distintos entre os endereços. Mais de um = "caixas" não é medida única. */
  packSizes: number[];
  oldestFirstStoredAt: string;
  oldestDays: number;
  /** Certeza da posição que define a idade acima, não a melhor das posições. */
  oldestCertainty: AgeCertainty;
  bucket: AgeBucket;
  lastMovementAt: string | null;
  /** Endereço onde este SKU está mais concentrado. */
  topConcentration: { binCode: string; boxes: number; share: number } | null;
  /**
   * Quanto da capacidade declarada das vagas onde ele está este SKU ocupa.
   * `null` quando nenhuma dessas vagas tem capacidade declarada — e aí não existe
   * proporção para mostrar, nem faz sentido inventar uma.
   */
  capacityUse: { declaredBoxes: number; usedBoxes: number; ratio: number; bins: number } | null;
}

export function summarize(
  placements: StockPlacement[],
  movements: PlacementMovement[],
  now: number,
): SkuSummary[] {
  const porProduto = new Map<string, StockPlacement[]>();
  for (const p of placements) {
    const lista = porProduto.get(p.productId);
    if (lista) lista.push(p);
    else porProduto.set(p.productId, [p]);
  }

  // Última movimentação por produto: o histórico é a fonte, não o saldo.
  const ultimoMovimento = new Map<string, string>();
  for (const mov of movements) {
    const atual = ultimoMovimento.get(mov.productId);
    if (!atual || mov.createdAt > atual) ultimoMovimento.set(mov.productId, mov.createdAt);
  }

  const resumos: SkuSummary[] = [];

  for (const [productId, lista] of porProduto) {
    const views: PlacementView[] = lista
      .map(p => {
        const days = daysSince(p.firstStoredAt, now);
        return { ...p, days, certainty: certaintyOf(p, movements), bucket: bucketOf(days) };
      })
      .sort((a, b) => b.days - a.days || a.binCode.localeCompare(b.binCode));

    const primeiro = views[0];
    const totalBoxes = views.reduce((acc, v) => acc + v.boxes, 0);
    const totalUnits = views.reduce((acc, v) => acc + v.units, 0);

    const comCapacidade = views.filter(v => v.binCapacityBoxes != null);
    const declaredBoxes = comCapacidade.reduce((acc, v) => acc + (v.binCapacityBoxes ?? 0), 0);
    const usedBoxes = comCapacidade.reduce((acc, v) => acc + v.boxes, 0);

    const maior = views.reduce((a, b) => (b.boxes > a.boxes ? b : a), views[0]);

    resumos.push({
      productId,
      sku: primeiro.sku,
      productName: primeiro.productName,
      ean: primeiro.ean,
      placements: views,
      totalBoxes,
      totalUnits,
      binCount: views.length,
      packSizes: [...new Set(views.map(v => v.unitsPerBox))].sort((a, b) => a - b),
      oldestFirstStoredAt: primeiro.firstStoredAt,
      oldestDays: primeiro.days,
      oldestCertainty: primeiro.certainty,
      bucket: primeiro.bucket,
      lastMovementAt: ultimoMovimento.get(productId) ?? null,
      topConcentration: totalBoxes > 0
        ? { binCode: maior.binCode, boxes: maior.boxes, share: maior.boxes / totalBoxes }
        : null,
      capacityUse: declaredBoxes > 0
        ? { declaredBoxes, usedBoxes, ratio: usedBoxes / declaredBoxes, bins: comCapacidade.length }
        : null,
    });
  }

  // Mais parado primeiro: é a pergunta que a tela responde.
  return resumos.sort((a, b) => b.oldestDays - a.oldestDays || a.sku.localeCompare(b.sku));
}

/** Contagem por faixa, para os filtros. Toda faixa aparece, inclusive a vazia — zero é
 *  informação ("não tem nada parado há mais de 30 dias"). */
export function countByBucket(resumos: SkuSummary[]): Record<AgeBucket, number> {
  const contagem: Record<AgeBucket, number> = { '0-7': 0, '8-15': 0, '16-30': 0, '30+': 0 };
  for (const r of resumos) contagem[r.bucket] += 1;
  return contagem;
}
