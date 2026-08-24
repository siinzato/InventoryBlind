// Matemática de posicionamento ao desenhar uma página embutida (pdf-lib
// `drawPage`) girada — isolada em função pura porque é fácil errar o sinal.
//
// Duas convenções de rotação colidem aqui:
//   - `/Rotate` do PDF (e nosso `PdfCenterPage.rotation`, que usa a MESMA
//     convenção pra ficar intuitivo: "rotacionar" gira no sentido HORÁRIO) —
//     rotação de EXIBIÇÃO, sentido horário.
//   - a opção `rotate` do `page.drawPage()` do pdf-lib, que gira a matriz de
//     conteúdo no sentido ANTI-horário (mesma convenção do operador `cm` do
//     PDF: cos/sin/-sin/cos).
// Por isso `rotateCwToApplyCcw` inverte o sinal. Além disso, `drawPage`
// rotaciona em torno do ponto (x,y) ANTES de aplicar a escala — então girar
// desloca a caixa resultante para fora do alvo, e cada caso (90/180/270)
// precisa de uma correção de posição própria (ver `EmbeddedDrawTransform`
// abaixo). As quatro fórmulas foram derivadas algebricamente a partir da
// composição translate→rotate→scale que `page.drawPage` usa internamente.

import type { Rotation } from './types';

export function normalizeAngle(angle: number): Rotation {
  const n = ((angle % 360) + 360) % 360;
  return n as Rotation;
}

/** Tamanho "como aparece na tela", já trocando largura/altura quando a
 *  rotação nativa da página é 90 ou 270. */
export function effectiveSize(rawWidth: number, rawHeight: number, nativeRotationCw: number): { width: number; height: number } {
  const angle = normalizeAngle(nativeRotationCw);
  return angle === 90 || angle === 270 ? { width: rawHeight, height: rawWidth } : { width: rawWidth, height: rawHeight };
}

export interface EmbeddedDrawTransform {
  /** Escala aplicada aos eixos X/Y do conteúdo embutido (`options.width`/
   *  `options.height` de `drawPage`, calculados a partir do tamanho bruto). */
  drawWidth: number;
  drawHeight: number;
  /** Posição final passada a `drawPage` — já compensada para a caixa
   *  rotacionada cair exatamente em (targetX,targetY)..(targetX+targetWidth,
   *  targetY+targetHeight). */
  x: number;
  y: number;
  /** Ângulo a passar em `options.rotate` (convenção anti-horária do pdf-lib). */
  rotateDegCcw: Rotation;
}

/** Calcula como desenhar uma página embutida de forma que, após aplicar a
 *  rotação combinada (nativa da página + extra escolhida no editor, ambas em
 *  graus horários), o resultado ocupe exatamente o retângulo
 *  (targetX,targetY,targetWidth,targetHeight). `drawWidth`/`drawHeight` vão
 *  direto em `options.width`/`options.height` de `page.drawPage()` — o
 *  pdf-lib calcula a escala internamente como `options.width /
 *  embeddedPage.width`, então não precisamos do tamanho bruto aqui. */
export function computeEmbeddedDrawTransform(
  nativeRotationCw: number,
  extraRotationCw: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number
): EmbeddedDrawTransform {
  const totalCw = normalizeAngle(nativeRotationCw + extraRotationCw);
  const applyCcw = normalizeAngle(360 - totalCw);

  const tW = targetWidth;
  const tH = targetHeight;

  switch (applyCcw) {
    case 90:
      return { drawWidth: tH, drawHeight: tW, x: targetX + tW, y: targetY, rotateDegCcw: 90 };
    case 180:
      return { drawWidth: tW, drawHeight: tH, x: targetX + tW, y: targetY + tH, rotateDegCcw: 180 };
    case 270:
      return { drawWidth: tH, drawHeight: tW, x: targetX, y: targetY + tH, rotateDegCcw: 270 };
    default:
      return { drawWidth: tW, drawHeight: tH, x: targetX, y: targetY, rotateDegCcw: 0 };
  }
}
