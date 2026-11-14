// Captura do mapa 3D para auditoria.
//
// Uma imagem de auditoria sem data, hora e ponto de vista é só uma captura de tela: não
// se sabe quando foi feita nem de onde se estava olhando, e as duas coisas mudam o que
// a imagem mostra. Um armazém fotografado de outro ângulo parece outro armazém.
//
// Por isso estas funções existem fora do componente: o que vai ESCRITO na imagem é
// conteúdo de relatório, e conteúdo de relatório se confere por teste, não por olhar o
// PNG depois de baixado.
//
// ── Formatação à mão, de propósito ──────────────────────────────────────────────
// Sem `toLocaleString`: o resultado dele muda com o fuso e a locale da máquina, e o
// nome do arquivo de uma auditoria não pode depender de onde o navegador estava
// configurado. Aqui o formato é sempre o mesmo, e o teste afirma qual é.

export interface AnguloDeCamera {
  /** Direção no plano do chão, em graus 0–360. 0° olha no sentido +Z. */
  azimute: number;
  /** Altura do olhar, em graus. 0° = na horizontal, 90° = direto de cima. */
  elevacao: number;
  /** Distância da câmera ao ponto observado, em metros do modelo. */
  distancia: number;
}

export type Ponto = readonly [number, number, number];

/**
 * De onde a câmera estava olhando.
 *
 * O vetor vai da CÂMERA para o ALVO: é a direção do olhar, não a posição. Inverter isto
 * produziria um ângulo exatamente oposto ao real — e, num relatório, levaria o auditor
 * ao lado errado da estante.
 */
export function anguloDaCamera(camera: Ponto, alvo: Ponto): AnguloDeCamera {
  const dx = alvo[0] - camera[0];
  const dy = alvo[1] - camera[1];
  const dz = alvo[2] - camera[2];
  const distancia = Math.hypot(dx, dy, dz);

  if (distancia === 0) return { azimute: 0, elevacao: 0, distancia: 0 };

  const azimuteBruto = (Math.atan2(dx, dz) * 180) / Math.PI;
  // Normaliza para 0–360: -170° e 190° são a mesma direção, e um relatório com ângulo
  // negativo obriga quem lê a fazer a conta de cabeça.
  const azimute = (azimuteBruto + 360) % 360;
  // Negativo porque olhar PARA BAIXO (dy < 0) é elevação positiva da câmera.
  const elevacao = (Math.asin(-dy / distancia) * 180) / Math.PI;

  return { azimute, elevacao, distancia };
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** `2026-11-14_15-32` — ordenável por nome, sem caractere que o sistema de arquivos
 *  recuse. Dois-pontos quebram nome de arquivo no Windows. */
export function carimboDeArquivo(quando: Date): string {
  return (
    `${quando.getFullYear()}-${doisDigitos(quando.getMonth() + 1)}-${doisDigitos(quando.getDate())}` +
    `_${doisDigitos(quando.getHours())}-${doisDigitos(quando.getMinutes())}`
  );
}

export function nomeDoArquivo(quando: Date): string {
  return `armazem-3d_${carimboDeArquivo(quando)}.png`;
}

/** `14/11/2026 15:32` — a data como se lê no Brasil, que é quem vai ler o relatório. */
export function dataHoraPtBr(quando: Date): string {
  return (
    `${doisDigitos(quando.getDate())}/${doisDigitos(quando.getMonth() + 1)}/${quando.getFullYear()}` +
    ` ${doisDigitos(quando.getHours())}:${doisDigitos(quando.getMinutes())}`
  );
}

/**
 * A linha que vai impressa na imagem.
 *
 * Diz QUANDO e DE ONDE. Sem isso, duas auditorias do mesmo armazém em ângulos
 * diferentes são indistinguíveis — e a comparação entre elas, que é o motivo de
 * guardar a imagem, fica impossível.
 */
export function legendaDaAuditoria(quando: Date, angulo: AnguloDeCamera): string {
  const azimute = Math.round(angulo.azimute);
  const elevacao = Math.round(angulo.elevacao);
  const distancia = angulo.distancia.toFixed(1).replace('.', ',');
  return `Mapa 3D do Pulmão · ${dataHoraPtBr(quando)} · azimute ${azimute}° · elevação ${elevacao}° · distância ${distancia} m`;
}

/** Altura da tarja da legenda, em pixels da imagem final. */
export const ALTURA_DA_TARJA = 44;

/**
 * Monta a imagem final: o desenho do WebGL com uma tarja de legenda embaixo.
 *
 * A tarja é ACRESCENTADA, não sobreposta: escrever por cima cobriria justamente a
 * parte do armazém que alguém quis registrar.
 *
 * Recebe o contexto 2D de fora para ser exercitável sem DOM real — é o mesmo motivo de
 * tudo neste arquivo morar longe do componente.
 */
export function desenharLegenda(
  ctx: CanvasRenderingContext2D,
  largura: number,
  alturaDoDesenho: number,
  legenda: string,
): void {
  ctx.fillStyle = '#0A2647';
  ctx.fillRect(0, alturaDoDesenho, largura, ALTURA_DA_TARJA);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '500 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(legenda, 16, alturaDoDesenho + ALTURA_DA_TARJA / 2);
}
