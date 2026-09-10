// Motor de layout 2D (spec §4) — decide COMO as bases das caixas cobrem a
// base do palete, para UMA camada. Nunca calcula só por área/volume: cada
// padrão é uma grade geométrica real, com posição de cada caixa validada.
//
// Convenção de eixos: x = ao longo do COMPRIMENTO do palete, y = ao longo da
// LARGURA. "rotated=false" (orientação A) põe `boxLengthMm` no eixo x;
// "rotated=true" (orientação B) põe `boxWidthMm` no eixo x (giro de 90° na
// base).

import { maxOverhangUsed, type Rect } from './geometry';
import type { EdgeMm } from './types';

export interface PlacedBox extends Rect {
  rotated: boolean;
  index: number;
}

export type LayoutPatternId = 'uniform-a' | 'uniform-b' | 'mixed';

export interface LayoutPattern {
  id: LayoutPatternId;
  label: string;
  boxesPerLayer: number;
  placements: PlacedBox[];
  baseAreaMm2: number;
  occupiedAreaMm2: number;
  occupationPct: number;
  overhangUsedMm: number;
}

function effDims(boxLengthMm: number, boxWidthMm: number, rotated: boolean) {
  return { effX: rotated ? boxWidthMm : boxLengthMm, effY: rotated ? boxLengthMm : boxWidthMm };
}

function buildPattern(id: LayoutPatternId, label: string, placements: PlacedBox[], palletLengthMm: number, palletWidthMm: number): LayoutPattern {
  const baseAreaMm2 = palletLengthMm * palletWidthMm;
  const occupiedAreaMm2 = placements.reduce((sum, p) => sum + p.w * p.h, 0);
  return {
    id, label, boxesPerLayer: placements.length, placements,
    baseAreaMm2, occupiedAreaMm2,
    occupationPct: baseAreaMm2 > 0 ? Math.min(100, (occupiedAreaMm2 / baseAreaMm2) * 100) : 0,
    overhangUsedMm: maxOverhangUsed(placements, palletLengthMm, palletWidthMm),
  };
}

/** Grade uniforme: toda a base preenchida com a MESMA orientação. É a
 *  referência contra a qual "arranjo misto" precisa se provar melhor. */
export function computeUniformGrid(
  palletLengthMm: number, palletWidthMm: number,
  boxLengthMm: number, boxWidthMm: number,
  rotated: boolean,
  overhangMm: EdgeMm
): LayoutPattern {
  const { effX, effY } = effDims(boxLengthMm, boxWidthMm, rotated);
  const availX = palletLengthMm + overhangMm.left + overhangMm.right;
  const availY = palletWidthMm + overhangMm.front + overhangMm.back;
  const cols = effX > 0 ? Math.floor(availX / effX) : 0;
  const rows = effY > 0 ? Math.floor(availY / effY) : 0;

  const placements: PlacedBox[] = [];
  let index = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placements.push({ x: -overhangMm.left + c * effX, y: -overhangMm.front + r * effY, w: effX, h: effY, rotated, index: index++ });
    }
  }

  return buildPattern(rotated ? 'uniform-b' : 'uniform-a', rotated ? 'Orientação uniforme B' : 'Orientação uniforme A', placements, palletLengthMm, palletWidthMm);
}

interface SubGrid { cols: number; rows: number; count: number; effX: number; effY: number }

function subGrid(regionLengthMm: number, regionWidthMm: number, boxLengthMm: number, boxWidthMm: number, rotated: boolean): SubGrid {
  const { effX, effY } = effDims(boxLengthMm, boxWidthMm, rotated);
  const cols = effX > 0 ? Math.floor(regionLengthMm / effX) : 0;
  const rows = effY > 0 ? Math.floor(regionWidthMm / effY) : 0;
  return { cols, rows, count: cols * rows, effX, effY };
}

/** Arranjo misto (spec §4): divide a base em DUAS faixas ao longo de um eixo
 *  (comprimento ou largura), cada faixa com sua própria orientação uniforme —
 *  é assim que uma faixa "sobrando" de uma grade única vira caixas extras
 *  giradas, em vez de área ociosa. Sem overhang (simplificação deliberada:
 *  overhang combinado com 2 faixas explode a combinatória por pouco ganho
 *  prático, já que overhang padrão é zero — ver limitações no relatório). */
export function computeMixedShelf(
  palletLengthMm: number, palletWidthMm: number,
  boxLengthMm: number, boxWidthMm: number
): LayoutPattern | null {
  let best: { total: number; placements: PlacedBox[] } | null = null;

  for (const axis of ['x', 'y'] as const) {
    const splitTotal = axis === 'y' ? palletWidthMm : palletLengthMm;
    const crossDim = axis === 'y' ? palletLengthMm : palletWidthMm;

    for (const rot1 of [false, true]) {
      const depth1Unit = effDims(boxLengthMm, boxWidthMm, rot1).effY;
      if (depth1Unit <= 0) continue;
      const maxJ = Math.floor(splitTotal / depth1Unit);

      for (let j = 1; j < maxJ; j++) {
        const band1Depth = j * depth1Unit;
        const band2Depth = splitTotal - band1Depth;
        if (band2Depth <= 0) continue;

        const band1 = axis === 'y'
          ? subGrid(crossDim, band1Depth, boxLengthMm, boxWidthMm, rot1)
          : subGrid(band1Depth, crossDim, boxLengthMm, boxWidthMm, rot1);

        for (const rot2 of [false, true]) {
          const band2 = axis === 'y'
            ? subGrid(crossDim, band2Depth, boxLengthMm, boxWidthMm, rot2)
            : subGrid(band2Depth, crossDim, boxLengthMm, boxWidthMm, rot2);

          const total = band1.count + band2.count;
          if (total === 0 || (best && total <= best.total)) continue;

          // `subGrid` já devolve `cols` contando ao longo do 1º argumento que
          // recebeu (regionLengthMm) e `rows` ao longo do 2º (regionWidthMm)
          // — e band1/band2 acima já foram chamados com esses dois
          // argumentos NA ORDEM CERTA para cada eixo (comprimento/largura
          // reais do palete). Por isso o posicionamento em si é IDÊNTICO
          // nos dois eixos: x cresce com `c`, y cresce com `r`, sempre — só
          // o deslocamento entre as duas faixas muda de eixo.
          const placements: PlacedBox[] = [];
          let index = 0;
          for (let r = 0; r < band1.rows; r++) {
            for (let c = 0; c < band1.cols; c++) {
              placements.push({ x: c * band1.effX, y: r * band1.effY, w: band1.effX, h: band1.effY, rotated: rot1, index: index++ });
            }
          }
          for (let r = 0; r < band2.rows; r++) {
            for (let c = 0; c < band2.cols; c++) {
              const offsetX = axis === 'x' ? band1Depth : 0;
              const offsetY = axis === 'y' ? band1Depth : 0;
              placements.push({ x: offsetX + c * band2.effX, y: offsetY + r * band2.effY, w: band2.effX, h: band2.effY, rotated: rot2, index: index++ });
            }
          }

          best = { total, placements };
        }
      }
    }
  }

  if (!best) return null;
  return buildPattern('mixed', 'Arranjo misto', best.placements, palletLengthMm, palletWidthMm);
}
