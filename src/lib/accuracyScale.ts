// Régua única de acuracidade de estoque (IRA) — "% de SKUs sem divergência".
//
// Existe porque o app classificava a MESMA grandeza com cinco réguas diferentes:
// 95/80 no painel administrativo, 80/50 no dashboard e no agente de IA, 90/70/50
// no mapa de calor por área, 80/60 no resumo desse mesmo mapa, e 90 em duas faixas
// no Full. O caso mais visível ficava em cinco linhas do mesmo bloco do dashboard:
// o texto comparava com a meta de 95% e a cor pintava de verde a partir de 80, de
// modo que uma linha com 86,5% saía verde com a legenda "abaixo da meta".
//
// Os cortes abaixo não são novos: são a meta que o app já declarava em
// adminKpis/kpiHealth.ts e já escrevia na tela ("Meta 95%").
//
// FORA DO ESCOPO desta régua, de propósito:
//  - Produtividade de PESSOA (productivityService, EmployeeProductivityTable,
//    achievementService, academyRecommendationService). Mede desempenho de quem
//    contou, não saúde do estoque — outro assunto, outros cortes.
//  - Notas 0-100 de pilares (BlindScore, Confidence Score, Risco). São escalas de
//    pontuação, não percentual de acerto.

/** A meta de IRA é de cada empresa, não do produto: 95% é o alvo que a AZ
 *  estabeleceu, e outra empresa pode operar com outro. Por isso os cortes entram
 *  como PARÂMETRO e estes valores são só o default de quem nunca configurou. */
export interface AccuracyTargets {
  /** A partir daqui a acuracidade está dentro da meta. */
  targetPct: number;
  /** Abaixo daqui é crítico. Entre o piso e a meta é atenção. */
  warningFloorPct: number;
}

export const DEFAULT_ACCURACY_TARGETS: AccuracyTargets = {
  targetPct: 95,
  warningFloorPct: 80,
};

/** Mantidos para quem já importava os números soltos. São o DEFAULT, não a meta
 *  da empresa — qualquer tela que mostre a meta ao usuário deve ler a configurada. */
export const ACCURACY_TARGET_PCT = DEFAULT_ACCURACY_TARGETS.targetPct;
export const ACCURACY_WARNING_FLOOR_PCT = DEFAULT_ACCURACY_TARGETS.warningFloorPct;

/** `insuficiente` = ainda não há o que medir (nenhum SKU concluído). Nunca é
 *  tratado como "dentro da meta" por omissão. */
export type AccuracyBand = 'meta' | 'atencao' | 'critico' | 'insuficiente';

export function classifyAccuracy(
  pct: number | null | undefined,
  targets: AccuracyTargets = DEFAULT_ACCURACY_TARGETS,
): AccuracyBand {
  if (pct == null || Number.isNaN(pct)) return 'insuficiente';
  if (pct >= targets.targetPct) return 'meta';
  if (pct >= targets.warningFloorPct) return 'atencao';
  return 'critico';
}

/** Valida o que a empresa digitou na tela de configuração. Devolve a mensagem de
 *  erro, ou null quando está válido. Um piso maior que a meta deixaria a faixa de
 *  atenção vazia e faria "crítico" e "dentro da meta" se sobreporem. */
export function validateAccuracyTargets(targets: AccuracyTargets): string | null {
  const { targetPct, warningFloorPct } = targets;
  for (const v of [targetPct, warningFloorPct]) {
    if (!Number.isFinite(v)) return 'Informe um número.';
    if (v < 0 || v > 100) return 'A meta e o piso vão de 0% a 100%.';
  }
  if (warningFloorPct >= targetPct) return 'O piso de atenção precisa ser menor que a meta.';
  return null;
}

export const ACCURACY_BAND_LABEL: Record<AccuracyBand, string> = {
  meta: 'Dentro da meta',
  atencao: 'Atenção',
  critico: 'Crítico',
  insuficiente: 'Sem dados',
};

/** Tom para `Stat.valueTone` — mesma escala de tons já usada pelo componente. */
export const ACCURACY_BAND_TONE: Record<AccuracyBand, 'default' | 'positive' | 'warning' | 'critical'> = {
  meta: 'positive',
  atencao: 'warning',
  critico: 'critical',
  insuficiente: 'default',
};
