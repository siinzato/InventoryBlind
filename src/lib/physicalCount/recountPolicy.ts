// Política de recontagem automática — matemática pura, sem I/O.
//
// Mesma separação de três camadas já usada por physicalCountAlgorithm.ts /
// physicalCountService.ts / UI.
//
// ── Quem decide de verdade ──────────────────────────────────────────────────
// O banco. `pc_evaluate_auto_recount` (migration 049) é a autoridade: roda no
// servidor dentro de pc_finalize_session e não pode ser contornada pelo cliente.
// Este arquivo NÃO é aquela decisão reimplementada em outro lugar.
//
// Ele existe para duas coisas que o banco não pode fazer:
//
//   1. PRÉ-VISUALIZAR. Na tela de configuração, mostrar o que aconteceria com o
//      limite que a pessoa está digitando, usando os itens já carregados. Sem
//      isso, configurar um limite é adivinhar.
//   2. EXPLICAR o que já aconteceu, traduzindo o evento gravado.
//
// Para o que já foi decidido, a UI lê `measured_value` da linha de
// physical_count_recount_events — o número que o SQL calculou — em vez de
// recalcular. É o que evita que uma divergência entre as duas fórmulas apareça
// como dois números diferentes para o mesmo fato. `measureDivergence` aqui só é
// usada onde não existe evento ainda: a pré-visualização.
//
// Se as fórmulas divergirem, o teste `espelha a fórmula do SQL` neste módulo é o
// lugar onde isso aparece — ele documenta a fórmula esperada linha a linha.

import type { CountNumber } from './physicalCountTypes';

/** Máximo de rodadas, igual ao CHECK de pc_create_recount_session (039). */
export const MAX_COUNT_ROUNDS = 3;

/** Os três modos de limite.
 *
 *  Nomes explícitos em vez de um par (tipo, valor) ambíguo: o pedido era
 *  "percentual ou valor", e existem duas leituras razoáveis de percentual —
 *  proporção de itens divergentes e desvio de unidades. Deixar implícito seria
 *  pedir para alguém configurar 5 achando que é uma coisa e receber a outra. */
export type RecountThresholdType =
  /** Itens divergentes ÷ itens contados × 100. */
  | 'divergent_item_percent'
  /** Σ|contado − ERP| ÷ Σ ERP × 100. */
  | 'unit_deviation_percent'
  /** Σ|contado − ERP|, em unidades. */
  | 'absolute_unit_deviation';

export const THRESHOLD_LABEL: Record<RecountThresholdType, string> = {
  divergent_item_percent: '% de itens divergentes',
  unit_deviation_percent: '% de desvio de unidades',
  absolute_unit_deviation: 'unidades de desvio',
};

export const THRESHOLD_HELP: Record<RecountThresholdType, string> = {
  divergent_item_percent:
    'Proporção de itens contados que não bateram com o ERP. Um item de 1 unidade pesa igual a um de 500.',
  unit_deviation_percent:
    'Soma das diferenças em unidades, em relação ao saldo total do ERP. Sensível ao tamanho do erro, não à quantidade de itens.',
  absolute_unit_deviation:
    'Soma das diferenças em unidades, em número absoluto. Útil quando o que importa é o volume do desvio, independente do tamanho da faixa.',
};

/** `true` para os modos em que o valor é um percentual — a UI usa para o sufixo do
 *  campo e para limitar a 100. */
export function isPercentThreshold(type: RecountThresholdType): boolean {
  return type === 'divergent_item_percent' || type === 'unit_deviation_percent';
}

export interface RecountSettings {
  enabled: boolean;
  thresholdType: RecountThresholdType;
  thresholdValue: number;
  /** Quem recebe o aviso. null = o responsável da contagem original. */
  notifyUserId: string | null;
}

export const DEFAULT_RECOUNT_SETTINGS: RecountSettings = {
  // Desligado por padrão: quem não configurar nada mantém o fluxo manual de hoje.
  enabled: false,
  thresholdType: 'divergent_item_percent',
  thresholdValue: 5,
  notifyUserId: null,
};

// ── Medida ──────────────────────────────────────────────────────────────────

export interface MeasurableItem {
  erpQuantitySnapshot: number | null;
  /** Quantidade no local esperado. null = ainda não contado. */
  physicalQuantity: number | null;
  /** Excedente achado em outro local. Soma ao total para reconciliar com o ERP. */
  foundElsewhereQuantity?: number;
}

export interface DivergenceMeasure {
  countedItems: number;
  divergentItems: number;
  /** Σ|diff|. Absoluto, NÃO líquido. */
  absoluteUnitDeviation: number;
  erpTotal: number;
}

/** Mede a divergência de uma sessão.
 *
 *  Duas decisões que precisam casar com `pc_measure_session_divergence`:
 *
 *  Total físico = physicalQuantity + foundElsewhereQuantity, igual ao que a 041
 *  usa em pc_finalize_session. Se medisse só physicalQuantity, um item achado em
 *  outro lugar contaria como divergência aqui e como 'ok' lá — a automação
 *  dispararia por um problema que a tela diz não existir.
 *
 *  Σ|diff| e não Σdiff: +50 numa peça e −50 em outra somam zero, e um estoque com
 *  cem unidades no lugar errado não é um estoque correto. O desvio líquido tem uso
 *  (é o ajuste), mas como gatilho de recontagem ele apaga exatamente o caso que
 *  mais pede recontagem. */
export function measureDivergence(items: readonly MeasurableItem[]): DivergenceMeasure {
  let countedItems = 0;
  let divergentItems = 0;
  let absoluteUnitDeviation = 0;
  let erpTotal = 0;

  for (const item of items) {
    // Itens não contados ficam de fora. Incluí-los trataria "não contado" como
    // "contado zero", inflando o desvio.
    if (item.physicalQuantity === null) continue;

    const erp = item.erpQuantitySnapshot ?? 0;
    const total = item.physicalQuantity + (item.foundElsewhereQuantity ?? 0);
    const diff = total - erp;

    countedItems += 1;
    erpTotal += erp;
    if (diff !== 0) {
      divergentItems += 1;
      absoluteUnitDeviation += Math.abs(diff);
    }
  }

  return { countedItems, divergentItems, absoluteUnitDeviation, erpTotal };
}

/** Aplica o modo de limite à medida.
 *
 *  Divisões protegidas: sessão sem item contado, ou com saldo total zero no ERP,
 *  mede zero em vez de NaN/Infinity. Um NaN aqui compararia falso contra qualquer
 *  limite e a automação ficaria silenciosamente desligada para aquela sessão. */
export function measuredValueFor(
  type: RecountThresholdType,
  measure: DivergenceMeasure
): number {
  // NOTA: `unit_deviation_percent` tem um ponto cego real, encontrado em dado de
  // produção. Quando o saldo total do ERP na faixa é zero e existe quantidade
  // contada, o percentual é indefinido; a divisão protegida devolve 0, então um
  // desvio de qualquer tamanho — 8.790 unidades num caso real — mede 0% e nunca
  // alcança limite nenhum. Ver `hasUnitPercentBlindSpot` abaixo e o relatório.

  switch (type) {
    case 'divergent_item_percent':
      return measure.countedItems > 0 ? (measure.divergentItems / measure.countedItems) * 100 : 0;
    case 'unit_deviation_percent':
      return measure.erpTotal > 0 ? (measure.absoluteUnitDeviation / measure.erpTotal) * 100 : 0;
    case 'absolute_unit_deviation':
      return measure.absoluteUnitDeviation;
  }
}

/** O modo escolhido é cego para esta medida?
 *
 *  Só acontece com `unit_deviation_percent`: saldo total do ERP igual a zero na
 *  faixa e desvio maior que zero. O percentual é matematicamente indefinido, a
 *  divisão protegida devolve 0, e o resultado é uma automação que ignora um desvio
 *  arbitrariamente grande.
 *
 *  Encontrado em dado real: uma sessão com um item contado em 8.790 unidades contra
 *  saldo zero no ERP mede 0% neste modo e 100% no modo por item.
 *
 *  Isto NÃO conserta o gatilho — a avaliação que vale roda no SQL e tem o mesmo
 *  ponto cego. Serve para a tela avisar em vez de a pessoa configurar um limite
 *  achando que está coberta. Os outros dois modos tratam o caso corretamente, e o
 *  padrão (`divergent_item_percent`) é um deles. */
export function hasUnitPercentBlindSpot(
  type: RecountThresholdType,
  measure: DivergenceMeasure
): boolean {
  return type === 'unit_deviation_percent' && measure.erpTotal === 0 && measure.absoluteUnitDeviation > 0;
}

// ── Decisão (pré-visualização) ──────────────────────────────────────────────

/** Por que uma avaliação não gerou recontagem. Mesmos códigos que a 049 grava em
 *  `reason`, para a UI ter uma tradução só. */
export type RecountSkipReason =
  | 'disabled'
  | 'below_threshold'
  | 'max_rounds_reached'
  | 'no_divergent_items';

export type RecountDecision =
  | { action: 'create'; measuredValue: number; measure: DivergenceMeasure }
  | { action: 'skip'; reason: RecountSkipReason; measuredValue: number; measure: DivergenceMeasure };

export interface DecideInput {
  settings: RecountSettings;
  items: readonly MeasurableItem[];
  /** Rodada da sessão que acabou de fechar. */
  countNumber: CountNumber;
}

/** O que aconteceria ao fechar esta sessão com estas configurações.
 *
 *  Ordem igual à de pc_evaluate_auto_recount, de propósito: desligado → limite →
 *  rodadas → itens. A ordem é o que faz a explicação ser útil — dizer "limite de
 *  rodadas atingido" para quem tem a automação desligada manda a pessoa procurar
 *  o problema errado. */
export function decideRecount(input: DecideInput): RecountDecision {
  const { settings, items, countNumber } = input;
  const measure = measureDivergence(items);
  const measuredValue = measuredValueFor(settings.thresholdType, measure);

  if (!settings.enabled) {
    return { action: 'skip', reason: 'disabled', measuredValue, measure };
  }

  // `<` e não `<=`: "ultrapassar o limite" inclui igualar. Um limite de 5%
  // configurado por alguém que quer recontar a partir de 5% deve disparar em 5%.
  if (measuredValue < settings.thresholdValue) {
    return { action: 'skip', reason: 'below_threshold', measuredValue, measure };
  }

  if (countNumber >= MAX_COUNT_ROUNDS) {
    return { action: 'skip', reason: 'max_rounds_reached', measuredValue, measure };
  }

  // Sem item divergente não há o que recontar — pc_create_recount_session recusa
  // uma recontagem vazia.
  //
  // INALCANÇÁVEL pela avaliação automática: o CHECK do banco exige
  // threshold_value > 0, e desvio zero nunca alcança um limite positivo, então o
  // caso cai em below_threshold acima. O guarda existe para o caminho de
  // pré-visualização, cujo tipo aceita 0 — sem ele a tela prometeria uma
  // recontagem que o banco recusaria. Coberto pelos dois testes vizinhos em
  // recountPolicy.test.ts, um provando a inalcançabilidade e outro o guarda.
  if (measure.divergentItems === 0) {
    return { action: 'skip', reason: 'no_divergent_items', measuredValue, measure };
  }

  return { action: 'create', measuredValue, measure };
}

// ── Texto ───────────────────────────────────────────────────────────────────

/** Formata o valor medido com a unidade do modo. Uma casa decimal nos percentuais
 *  (12.4%) e inteiro nas unidades — meia unidade de desvio não é uma ideia útil, e
 *  '12.400000000000002%' é o que sai sem arredondar. */
export function formatMeasured(type: RecountThresholdType, value: number): string {
  if (isPercentThreshold(type)) {
    return `${(Math.round(value * 10) / 10).toLocaleString('pt-BR')}%`;
  }
  return `${Math.round(value).toLocaleString('pt-BR')} un.`;
}

export function describeSkipReason(reason: RecountSkipReason): string {
  switch (reason) {
    case 'disabled':
      return 'Recontagem automática desligada para esta empresa.';
    case 'below_threshold':
      return 'A divergência ficou abaixo do limite configurado.';
    case 'max_rounds_reached':
      return `Esta faixa já chegou à ${MAX_COUNT_ROUNDS}ª contagem — o limite de rodadas foi atingido.`;
    case 'no_divergent_items':
      return 'Nenhum item divergente para recontar.';
  }
}

/** A frase que explica uma decisão, com o número e o limite juntos.
 *
 *  Gerada da mesma decisão que foi tomada, então não pode discordar dela — pelo
 *  mesmo motivo que as reduções do Health Score são geradas junto do score. */
export function describeDecision(decision: RecountDecision, settings: RecountSettings): string {
  const measured = formatMeasured(settings.thresholdType, decision.measuredValue);
  const limit = formatMeasured(settings.thresholdType, settings.thresholdValue);

  if (decision.action === 'create') {
    return `${measured} de divergência, acima do limite de ${limit} — uma recontagem seria gerada com ${decision.measure.divergentItems} ${decision.measure.divergentItems === 1 ? 'item' : 'itens'}.`;
  }

  if (decision.reason === 'below_threshold') {
    return `${measured} de divergência, abaixo do limite de ${limit} — nenhuma recontagem seria gerada.`;
  }

  return describeSkipReason(decision.reason);
}
