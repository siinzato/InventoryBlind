// Onde guardar esta mercadoria.
//
// Sugestão, nunca decisão: a função devolve uma lista ordenada com o motivo de cada
// posição, e quem escolhe é o operador. Nada aqui movimenta nada.
//
// ── O que de fato restringe uma vaga ─────────────────────────────────────────────────
//
// Lido das RPCs da 116, não presumido. Só existem três restrições reais:
//
//   1. `blocked`              — vaga bloqueada não recebe mercadoria.
//   2. `capacity_boxes`       — quando declarada; NULL significa "sem limite declarado".
//   3. `units_per_box` igual  — a vaga não soma caixas de pack diferente do mesmo SKU.
//
// Não existe peso (nem em `products`, nem em `warehouse_storage_bins`), nem categoria,
// família, classe de armazenagem, restrição produto×vaga ou curva. Inventar qualquer
// uma delas aqui seria criar uma regra operacional que a empresa nunca cadastrou.
//
// ── O que NÃO é restrição, e por isso só desempata ───────────────────────────────────
//
// Não há localização física levantada — nenhuma coordenada, corredor ou distância. O
// que existe é o código hierárquico (`PP-A01-N1`), que dá ordem de caminhada e altura.
// Isso entra como critério de DESEMPATE e aparece rotulado como tal na tela, nunca como
// se fosse distância medida.

import { parseBinCode } from './binCode';
import type { StorageBin } from './wmsService';

/** O que já está guardado numa vaga, do ponto de vista de quem vai guardar mais. */
export interface BinOccupancy {
  /** Total de caixas na vaga, somando todos os SKUs. */
  totalBoxes: number;
  /** Caixas do SKU em questão, 0 se não houver. */
  sameSkuBoxes: number;
  /** Pack do SKU em questão nesta vaga, `null` se o SKU não estiver aqui. */
  sameSkuUnitsPerBox: number | null;
  /** Quantos SKUs distintos a vaga tem. */
  distinctSkus: number;
}

export const EMPTY_OCCUPANCY: BinOccupancy = {
  totalBoxes: 0,
  sameSkuBoxes: 0,
  sameSkuUnitsPerBox: null,
  distinctSkus: 0,
};

export type RejectionReason =
  | 'bloqueado'
  | 'sem-capacidade'
  | 'pack-diferente'
  | 'mesma-origem';

export interface BinSuggestion {
  bin: StorageBin;
  /** Motivos curtos, na ordem em que pesaram. */
  reasons: string[];
  /** Caixas livres, `null` quando a vaga não tem capacidade declarada. */
  freeBoxes: number | null;
  consolidates: boolean;
  occupancy: BinOccupancy;
}

export interface SuggestionInput {
  bins: StorageBin[];
  /** Ocupação por código de vaga. Ausente = vaga vazia. */
  occupancyByCode: Map<string, BinOccupancy>;
  boxes: number;
  /** Pack da mercadoria a guardar. `null` quando ainda não informado. */
  unitsPerBox: number | null;
  /** Transferência: a origem nunca pode ser destino. */
  excludeCode?: string;
}

/** Espaço livre em caixas, ou `null` quando não há capacidade declarada — sem
 *  denominador não existe "livre", e estimar um seria dado falso. */
export const freeBoxesOf = (bin: StorageBin, occ: BinOccupancy): number | null =>
  bin.capacityBoxes == null ? null : Math.max(0, bin.capacityBoxes - occ.totalBoxes);

/**
 * Por que uma vaga NÃO serve. `null` = serve.
 *
 * Cada motivo aqui corresponde a uma recusa que a RPC faria — a tela apenas antecipa,
 * para o operador não descobrir depois da ida ao servidor. Nenhum motivo é invenção
 * desta camada.
 */
export function rejectionFor(
  bin: StorageBin,
  occ: BinOccupancy,
  input: Pick<SuggestionInput, 'boxes' | 'unitsPerBox' | 'excludeCode'>,
): RejectionReason | null {
  if (input.excludeCode && bin.code === input.excludeCode) return 'mesma-origem';
  if (bin.blocked) return 'bloqueado';

  // Pack divergente: `wms_bin_putaway` e `wms_bin_transfer` recusam somar caixas de
  // packs diferentes do mesmo SKU na mesma linha de saldo.
  if (
    input.unitsPerBox != null &&
    occ.sameSkuUnitsPerBox != null &&
    occ.sameSkuUnitsPerBox !== input.unitsPerBox
  ) {
    return 'pack-diferente';
  }

  const livre = freeBoxesOf(bin, occ);
  if (livre != null && input.boxes > livre) return 'sem-capacidade';

  return null;
}

/** Peso de cada critério. Separado do cálculo para a ordem ficar legível e testável. */
const SCORE = {
  consolida: 1_000_000,
  vazia: 10_000,
  livrePorCaixa: 10,
  nivelBaixo: 100,
} as const;

export function suggestBins(input: SuggestionInput): BinSuggestion[] {
  const pontuadas: Array<{ score: number; suggestion: BinSuggestion }> = [];

  for (const bin of input.bins) {
    const occ = input.occupancyByCode.get(bin.code) ?? EMPTY_OCCUPANCY;
    if (rejectionFor(bin, occ, input) !== null) continue;

    const livre = freeBoxesOf(bin, occ);
    const consolida = occ.sameSkuBoxes > 0;
    const vazia = occ.totalBoxes === 0;
    const nivel = parseBinCode(bin.code)?.level ?? null;

    const reasons: string[] = [];
    if (consolida) reasons.push(`Já tem este SKU (${occ.sameSkuBoxes} cx)`);
    else if (vazia) reasons.push('Vaga vazia');
    else reasons.push(`Ocupada por ${occ.distinctSkus} outro(s) SKU(s)`);

    if (livre != null) reasons.push(`${livre} cx livres`);
    else reasons.push('Sem capacidade declarada');

    if (nivel != null && nivel <= 1) reasons.push('Nível baixo, mais fácil de acessar');

    let score = 0;
    if (consolida) score += SCORE.consolida;
    if (vazia) score += SCORE.vazia;
    if (livre != null) score += Math.min(livre, 500) * SCORE.livrePorCaixa;
    // Nível é desempate operacional, não regra cadastrada: quanto mais baixo, melhor,
    // porque alcançar N1 não depende de empilhadeira.
    if (nivel != null) score += Math.max(0, 4 - nivel) * SCORE.nivelBaixo;

    pontuadas.push({
      score,
      suggestion: { bin, reasons, freeBoxes: livre, consolidates: consolida, occupancy: occ },
    });
  }

  return pontuadas
    // Último desempate: a ordem do código, que é a ordem de caminhada pelo corredor.
    .sort((a, b) => b.score - a.score || a.suggestion.bin.code.localeCompare(b.suggestion.bin.code))
    .map(p => p.suggestion);
}

/** Saldo antes e depois, para a confirmação da transferência mostrar a conta. */
export interface BalancePreview {
  fromBefore: number;
  fromAfter: number;
  toBefore: number;
  toAfter: number;
}

export function previewTransfer(
  fromOcc: BinOccupancy,
  toOcc: BinOccupancy,
  boxes: number,
): BalancePreview {
  return {
    fromBefore: fromOcc.sameSkuBoxes,
    fromAfter: Math.max(0, fromOcc.sameSkuBoxes - boxes),
    toBefore: toOcc.sameSkuBoxes,
    toAfter: toOcc.sameSkuBoxes + boxes,
  };
}

/**
 * Ocupação por vaga, do ponto de vista de UM SKU.
 *
 * Deriva do mesmo `listPulmaoStock()` da Fase 3 — nenhuma consulta nova e nenhuma
 * segunda fonte de saldo. `productId` nulo (produto ainda não escolhido) devolve só a
 * ocupação geral, sem os campos do SKU.
 */
export function occupancyByProduct(
  placements: Array<{
    binCode: string;
    productId: string;
    boxes: number;
    unitsPerBox: number;
  }>,
  productId: string | null,
): Map<string, BinOccupancy> {
  const mapa = new Map<string, BinOccupancy>();

  for (const p of placements) {
    const atual = mapa.get(p.binCode) ?? { ...EMPTY_OCCUPANCY };
    atual.totalBoxes += p.boxes;
    atual.distinctSkus += 1;
    if (productId && p.productId === productId) {
      atual.sameSkuBoxes += p.boxes;
      atual.sameSkuUnitsPerBox = p.unitsPerBox;
    }
    mapa.set(p.binCode, atual);
  }

  return mapa;
}
