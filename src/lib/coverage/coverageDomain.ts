// Cobertura de contagem — quanto do estoque foi efetivamente contado, e há quanto tempo.
//
// Primeira fatia da ciclagem programada. É deliberadamente só de LEITURA: antes de
// programar contagens recorrentes é preciso enxergar a cobertura atual, senão o programa
// nasce sem linha de base e ninguém sabe dizer se ele melhorou alguma coisa.
//
// Módulo puro — nada de Supabase aqui. A cadência por classe é regra de negócio e precisa
// ser testável sem banco.

/** Classe da curva ABC. `null` = produto ainda não classificado. */
export type AbcClass = 'A' | 'B' | 'C' | null;

/** Chave de agrupamento: as três classes mais os não classificados. */
export type AbcBucket = 'A' | 'B' | 'C' | 'sem';

/** Cadência alvo em dias: de quanto em quanto tempo cada classe deveria ser recontada.
 *
 *  Os valores são o padrão de mercado (A mensal, B trimestral, C semestral). Ficam aqui
 *  como constante, e não em banco, porque esta fatia não tem tela de configuração — a
 *  próxima fatia (programa de ciclagem) é que torna isso ajustável por empresa. Trocar
 *  aqui muda apenas o que a tela chama de "atrasado"; nada é gravado a partir disso. */
export const CADENCE_DAYS: Record<AbcBucket, number> = { A: 30, B: 90, C: 180, sem: 180 };

export const ABC_LABEL: Record<AbcBucket, string> = {
  A: 'Classe A',
  B: 'Classe B',
  C: 'Classe C',
  sem: 'Sem classificação',
};

export const ABC_HINT: Record<AbcBucket, string> = {
  A: 'Maior valor movimentado — erro aqui custa caro',
  B: 'Valor intermediário',
  C: 'Cauda longa do catálogo',
  sem: 'Sem curva ABC calculada ainda',
};

export function bucketOf(abc: AbcClass): AbcBucket {
  return abc ?? 'sem';
}

export function cadenceFor(abc: AbcClass): number {
  return CADENCE_DAYS[bucketOf(abc)];
}

/** Dias inteiros desde a contagem. `null` quando o SKU nunca foi contado. */
export function daysSince(lastCountedAt: string | null, now: Date): number | null {
  if (!lastCountedAt) return null;
  const then = new Date(lastCountedAt).getTime();
  if (Number.isNaN(then)) return null;
  const dias = Math.floor((now.getTime() - then) / 86_400_000);
  // Contagem com data no futuro (fuso, relógio do dispositivo) conta como hoje em vez de
  // virar número negativo, que apareceria na tela como "-1 dias sem contagem".
  return dias < 0 ? 0 : dias;
}

export type CoverageStatus = 'em_dia' | 'atrasado' | 'nunca';

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  em_dia: 'Em dia',
  atrasado: 'Atrasado',
  nunca: 'Nunca contado',
};

export function statusFor(lastCountedAt: string | null, abc: AbcClass, now: Date): CoverageStatus {
  const dias = daysSince(lastCountedAt, now);
  if (dias === null) return 'nunca';
  return dias > cadenceFor(abc) ? 'atrasado' : 'em_dia';
}

/** De onde veio o saldo que gerou o valor parado deste SKU.
 *
 *  Existe porque os dois saldos têm status diferentes: o do catálogo é o número canônico
 *  do sistema, e o da Fonte de Saldo é a foto da última importação do estoque, que a
 *  própria Fonte nunca grava no catálogo por desenho. Misturar os dois sem dizer qual foi
 *  usado faria a tela apresentar uma estimativa com a mesma cara de um dado oficial. */
export type BalanceSource = 'catalogo' | 'fonte_de_saldo';

/** Escolhe o saldo de um SKU entre o catálogo e a foto da Fonte de Saldo.
 *
 *  O catálogo sempre vence quando tem quantidade: é o número que o resto do sistema usa, e
 *  deixar a foto sobrepor-se a ele criaria duas verdades para a mesma pergunta. A Fonte só
 *  entra onde o catálogo está zerado ou vazio — ou seja, onde a alternativa não é um número
 *  melhor, é número nenhum.
 *
 *  A decisão é por SKU, e não uma chave geral do tipo "o catálogo inteiro está zerado": com
 *  a chave geral, o dia em que dez produtos ganhassem saldo o restante do catálogo perderia
 *  o valor de uma vez só. */
export function resolveBalance(
  catalogQuantity: number | null,
  snapshotQuantity: number | null
): { quantity: number; from: BalanceSource | null } {
  const catalogo = catalogQuantity ?? 0;
  if (catalogo > 0) return { quantity: catalogo, from: 'catalogo' };

  const foto = snapshotQuantity ?? 0;
  if (foto > 0) return { quantity: foto, from: 'fonte_de_saldo' };

  // Saldo zero dos dois lados não é "veio do catálogo": é ausência de saldo, e a tela
  // precisa distinguir os dois para não contar como medido o que não foi.
  return { quantity: 0, from: null };
}

/** Um SKU do catálogo com o que a cobertura precisa saber sobre ele. */
export interface CoverageItem {
  productId: string;
  sku: string;
  name: string;
  location: string | null;
  abc: AbcClass;
  /** Última contagem conhecida, de qualquer origem. `null` = nunca contado. */
  lastCountedAt: string | null;
  /** Valor parado: preço × saldo. Usado para a cobertura por valor. */
  value: number;
  /** Origem do saldo usado em `value`. `null` quando não há saldo em origem nenhuma.
   *  Opcional para quem monta um item sem se importar com a procedência. */
  balanceFrom?: BalanceSource | null;
}

export interface CoverageTotals {
  skus: number;
  skusCobertos: number;
  skusPct: number;
  valor: number;
  valorCoberto: number;
  valorPct: number;
}

const pct = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0);

/** Cobertura dentro de uma janela fixa — "contado nos últimos N dias", a métrica que
 *  auditoria pede. Independe da cadência por classe de propósito: é a pergunta simples,
 *  e misturar as duas num número só esconde qual delas piorou. */
export function coverageWithin(items: CoverageItem[], windowDays: number, now: Date): CoverageTotals {
  let skusCobertos = 0;
  let valor = 0;
  let valorCoberto = 0;

  for (const item of items) {
    const dias = daysSince(item.lastCountedAt, now);
    const dentro = dias !== null && dias <= windowDays;
    valor += item.value;
    if (dentro) {
      skusCobertos += 1;
      valorCoberto += item.value;
    }
  }

  return {
    skus: items.length,
    skusCobertos,
    skusPct: pct(skusCobertos, items.length),
    valor,
    valorCoberto,
    valorPct: pct(valorCoberto, valor),
  };
}

export interface ClassBreakdown {
  bucket: AbcBucket;
  cadenceDays: number;
  total: number;
  emDia: number;
  atrasado: number;
  nunca: number;
  /** % de SKUs da classe dentro da própria cadência. */
  emDiaPct: number;
}

const BUCKET_ORDER: AbcBucket[] = ['A', 'B', 'C', 'sem'];

/** Quebra por classe. Classe sem nenhum SKU é omitida — uma linha zerada de "Classe A"
 *  numa empresa que ainda não rodou a curva ABC só gera dúvida. */
export function breakdownByClass(items: CoverageItem[], now: Date): ClassBreakdown[] {
  const base = new Map<AbcBucket, ClassBreakdown>();

  for (const bucket of BUCKET_ORDER) {
    base.set(bucket, {
      bucket,
      cadenceDays: CADENCE_DAYS[bucket],
      total: 0,
      emDia: 0,
      atrasado: 0,
      nunca: 0,
      emDiaPct: 0,
    });
  }

  for (const item of items) {
    const linha = base.get(bucketOf(item.abc))!;
    linha.total += 1;
    const status = statusFor(item.lastCountedAt, item.abc, now);
    if (status === 'em_dia') linha.emDia += 1;
    else if (status === 'atrasado') linha.atrasado += 1;
    else linha.nunca += 1;
  }

  return BUCKET_ORDER
    .map(b => base.get(b)!)
    .filter(linha => linha.total > 0)
    .map(linha => ({ ...linha, emDiaPct: pct(linha.emDia, linha.total) }));
}

export interface OverdueEntry extends CoverageItem {
  status: CoverageStatus;
  dias: number | null;
  cadenceDays: number;
}

/** Fila de prioridade: o que contar primeiro.
 *
 *  Ordena por atraso RELATIVO à cadência da classe, não por dias absolutos — um SKU A
 *  parado há 45 dias (1,5× a cadência) é mais urgente que um C parado há 100 (0,55×),
 *  embora o C pareça pior num ranking por data. Nunca contado vem antes de tudo, e entre
 *  eles o desempate é por valor, para a primeira contagem atacar o dinheiro parado. */
export function mostOverdue(items: CoverageItem[], limit: number, now: Date): OverdueEntry[] {
  const ratio = (e: OverdueEntry) => (e.dias === null ? Infinity : e.dias / e.cadenceDays);

  return items
    .map<OverdueEntry>(item => ({
      ...item,
      status: statusFor(item.lastCountedAt, item.abc, now),
      dias: daysSince(item.lastCountedAt, now),
      cadenceDays: cadenceFor(item.abc),
    }))
    .filter(e => e.status !== 'em_dia')
    .sort((a, b) => {
      const ra = ratio(a);
      const rb = ratio(b);
      if (ra !== rb) return rb - ra;
      if (b.value !== a.value) return b.value - a.value;
      return a.sku.localeCompare(b.sku);
    })
    .slice(0, limit);
}
