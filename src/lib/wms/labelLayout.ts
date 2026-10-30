// Medidas da etiqueta do pulmão, em milímetros.
//
// Vive fora do componente por dois motivos: é a única parte da impressão que dá para
// testar sem impressora, e é conta — não tela. Quem imprime só pergunta "qual formato?"
// e recebe de volta todas as medidas prontas.
//
// Os formatos de etiqueta avulsa são os MESMOS do Gerador de Etiquetas do sistema (vão
// 100×40mm, excesso 100×150mm), de propósito: quem já tem rolo comprado para um não
// precisa comprar outro para o outro.

export type LabelFormatId = 'a4' | 'vao' | 'excesso' | 'custom';

export interface LabelFormatOption {
  id: LabelFormatId;
  label: string;
  hint: string;
}

export const LABEL_FORMATS: LabelFormatOption[] = [
  { id: 'a4',      label: 'Folha A4',  hint: 'várias por folha, com marca de corte' },
  { id: 'vao',     label: 'Vão',       hint: '100 × 40 mm, uma por etiqueta' },
  { id: 'excesso', label: 'Excesso',   hint: '100 × 150 mm, uma por etiqueta' },
  { id: 'custom',  label: 'Personalizado', hint: 'medida sua, uma por etiqueta' },
];

/** Grades oferecidas na folha A4. Não é qualquer número: cada uma divide a área útil
 *  em células de proporção aproveitável. 8 é o padrão — é onde a etiqueta ainda fica
 *  legível de pé no corredor sem desperdiçar papel. */
export const A4_PER_PAGE = [4, 8, 12, 24] as const;
export type A4PerPage = (typeof A4_PER_PAGE)[number];

const A4_GRID: Record<A4PerPage, { cols: number; rows: number }> = {
  4:  { cols: 2, rows: 2 },
  8:  { cols: 2, rows: 4 },
  12: { cols: 3, rows: 4 },
  24: { cols: 4, rows: 6 },
};

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 8;
const A4_GAP_MM = 3;

/** Abaixo disto um QR de etiqueta deixa de ser lido com o celular na mão, a um palmo
 *  da estrutura. Limita o quanto as grades mais densas podem encolher o código. */
const MIN_QR_MM = 14;

/** Mais larga que alta nesta proporção não comporta QR em cima e texto embaixo: vira
 *  QR à esquerda, endereço à direita. É o caso do rolo de 100×40. */
const HORIZONTAL_RATIO = 1.6;

export interface LabelPlan {
  /** Conteúdo da regra `@page`. */
  pageCss: string;
  columns: number;
  /** Quantas cabem na página; `1` nos formatos de etiqueta avulsa. */
  perPage: number;
  labelWidthMm: number;
  labelHeightMm: number;
  orientation: 'vertical' | 'horizontal';
  qrMm: number;
  headerPt: number;
  valuePt: number;
  codePt: number;
  gapMm: number;
  padMm: number;
  /** Marca de corte só faz sentido quando há mais de uma etiqueta por folha. */
  showCutBorder: boolean;
}

export interface LabelLayoutInput {
  format: LabelFormatId;
  perPage: A4PerPage;
  customWidthMm: number;
  customHeightMm: number;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Para a célula da folha: arredondar para CIMA faria a soma das colunas passar da área
 *  útil e a última coluna sair pela borda do papel. Para baixo sobra, nunca falta. */
const floor1 = (value: number): number => Math.floor(value * 10) / 10;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function planLabels(input: LabelLayoutInput): LabelPlan {
  const sheet = input.format === 'a4';

  let widthMm: number;
  let heightMm: number;
  let columns = 1;
  let perPage = 1;
  let gapMm = 0;
  let pageCss: string;

  if (sheet) {
    const { cols, rows } = A4_GRID[input.perPage] ?? A4_GRID[8];
    const usableW = A4_WIDTH_MM - A4_MARGIN_MM * 2;
    const usableH = A4_HEIGHT_MM - A4_MARGIN_MM * 2;
    gapMm = A4_GAP_MM;
    columns = cols;
    perPage = cols * rows;
    widthMm = floor1((usableW - gapMm * (cols - 1)) / cols);
    heightMm = floor1((usableH - gapMm * (rows - 1)) / rows);
    pageCss = `size: A4 portrait; margin: ${A4_MARGIN_MM}mm;`;
  } else {
    const fixed =
      input.format === 'vao' ? { w: 100, h: 40 } :
      input.format === 'excesso' ? { w: 100, h: 150 } :
      // Personalizado: faixa que uma impressora de etiqueta realmente aceita.
      { w: clamp(input.customWidthMm, 25, 210), h: clamp(input.customHeightMm, 15, 297) };
    widthMm = fixed.w;
    heightMm = fixed.h;
    // Margem zero: a etiqueta JÁ é a página. Qualquer margem desloca a impressão no rolo.
    pageCss = `size: ${round1(widthMm)}mm ${round1(heightMm)}mm; margin: 0;`;
  }

  const orientation = widthMm / heightMm > HORIZONTAL_RATIO ? 'horizontal' : 'vertical';
  const padMm = round1(clamp(Math.min(widthMm, heightMm) * 0.06, 1.5, 4));
  const innerW = widthMm - padMm * 2;
  const innerH = heightMm - padMm * 2;

  const qrMm = round1(
    Math.max(
      MIN_QR_MM,
      orientation === 'horizontal'
        ? Math.min(innerH * 0.92, innerW * 0.42)
        : Math.min(innerW * 0.62, innerH * 0.5),
    ),
  );

  // Largura que sobra para o texto do endereço — é ela que manda no corpo da fonte,
  // não a largura total da etiqueta.
  //
  // O coeficiente sai da pior linha possível: três colunas de até 3 caracteres cada
  // (rua "AA", módulo "012", nível "12"). Em negrito um caractere ocupa ~0,6em, então a
  // linha mede ~5,4 × corpo, e 1pt = 0,3528mm — daí ~1,9mm por ponto. 0,46 é esse limite
  // com folga, porque a linha tem `nowrap` e estourar não quebra: corta.
  const textW = orientation === 'horizontal' ? innerW - qrMm - 3 : innerW;
  const valuePt = round1(clamp(textW * 0.46, 8, 34));

  return {
    pageCss,
    columns,
    perPage,
    labelWidthMm: round1(widthMm),
    labelHeightMm: round1(heightMm),
    orientation,
    qrMm,
    headerPt: round1(clamp(valuePt * 0.3, 4.5, 9)),
    valuePt,
    codePt: round1(clamp(valuePt * 0.34, 5, 10)),
    gapMm,
    padMm,
    showCutBorder: sheet,
  };
}

/** Quantas folhas/etiquetas saem da impressora — informação que evita o susto de
 *  mandar 85 endereços numa grade de 4 por folha. */
export const sheetsFor = (bins: number, plan: LabelPlan): number =>
  Math.max(1, Math.ceil(bins / plan.perPage));

/** Corpo da fonte para endereço FORA do padrão `PP-A01-N1`, onde o código inteiro ocupa
 *  a linha sozinho em vez de três colunas curtas.
 *
 *  `plan.valuePt` é calculado para "AA 012 12"; um "VAGA-SOLTA" no mesmo corpo estoura a
 *  célula e, com `nowrap` + `overflow: hidden`, não quebra linha — some pela borda. Aqui
 *  o corpo cede ao comprimento do texto. 0,8em por caractere foi medido no navegador
 *  com a fonte e o peso reais, não estimado. */
export const fallbackValuePt = (plan: LabelPlan, chars: number): number => {
  const innerW = plan.labelWidthMm - plan.padMm * 2;
  const textW = plan.orientation === 'horizontal' ? innerW - plan.qrMm - 3 : innerW;
  const PT_TO_MM = 0.3528;
  const fit = textW / (Math.max(1, chars) * 0.8 * PT_TO_MM);
  return round1(clamp(Math.min(plan.valuePt, fit), 5, plan.valuePt));
};
