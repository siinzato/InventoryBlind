// Planta baixa do armazém: a vista de cima que o radar desenha.
//
// Mora fora do componente pelo mesmo motivo dos outros módulos do mapa: a conversão
// entre o mundo 3D e o SVG é aritmética, e errar nela desloca o cone da câmera em
// relação ao armazém — o radar passaria a apontar para o corredor errado. Isso é
// verificável sem WebGL, e é aqui que se verifica.
//
// ── Os dois sistemas de coordenadas ─────────────────────────────────────────────
// `posicaoDaVaga` devolve coordenada LOCAL: a rua 1 fica em x=0, o módulo 1 em z=0.
// A cena desenha esse grupo deslocado por `deslocamento` para centralizar o armazém na
// origem, então a câmera e o alvo do OrbitControls vivem em coordenada de MUNDO.
//
//   mundo = local + deslocamento        local = mundo - deslocamento
//
// Confundir os dois é o erro silencioso desta feature: o desenho continua bonito e o
// cone aponta para o lugar errado, por exatamente meia largura do armazém.
//
// ── Por que a altura some ───────────────────────────────────────────────────────
// O radar é vista de cima: os níveis de um mesmo (rua, módulo) ocupam o MESMO ponto na
// planta. Uma coluna do radar é a pilha inteira, e o alerta dela é o alerta de qualquer
// nível — senão um problema no nível 3 ficaria invisível justamente no instrumento que
// existe para localizar problemas.

import { posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

/** Uma coluna do armazém vista de cima: todos os níveis de um (rua, módulo). */
export interface CelulaRadar {
  rua: number;
  ruaCodigo: string;
  modulo: number;
  /** Coordenada LOCAL, a mesma que `posicaoDaVaga` devolve. */
  x: number;
  z: number;
  /** Qualquer nível desta coluna está acima da capacidade. */
  divergencia: boolean;
  /** Qualquer nível desta coluna é alto giro fora da face de piso. */
  altoGiro: boolean;
  /** Níveis desenhados nesta coluna — usado só para o título acessível. */
  niveis: number;
}

export function celulasDoRadar(
  slots: readonly Slot[],
  layout: Layout3DConfig,
  idsAltoGiro: ReadonlySet<string>,
): CelulaRadar[] {
  const porColuna = new Map<string, CelulaRadar>();

  for (const slot of slots) {
    const chave = `${slot.rua}|${slot.modulo}`;
    const existente = porColuna.get(chave);
    if (existente) {
      existente.divergencia = existente.divergencia || slot.status === 'divergence';
      existente.altoGiro = existente.altoGiro || idsAltoGiro.has(slot.id);
      existente.niveis += 1;
      continue;
    }
    const [x, , z] = posicaoDaVaga(slot, layout);
    porColuna.set(chave, {
      rua: slot.rua,
      ruaCodigo: slot.ruaCodigo,
      modulo: slot.modulo,
      x,
      z,
      divergencia: slot.status === 'divergence',
      altoGiro: idsAltoGiro.has(slot.id),
      niveis: 1,
    });
  }

  // Ordem estável: sem ela o React reordenaria os nós do SVG a cada recálculo.
  return [...porColuna.values()].sort((a, b) => a.rua - b.rua || a.modulo - b.modulo);
}

/** Retângulo que o SVG enquadra, em coordenada LOCAL. */
export interface AreaRadar {
  minX: number;
  minZ: number;
  largura: number;
  profundidade: number;
}

/**
 * Área desenhada pelo radar.
 *
 * A margem não é estética: a câmera orbita FORA do armazém, e sem folga no
 * enquadramento o marcador dela viveria permanentemente encostado na borda, sem indicar
 * de que lado se está olhando. A margem é proporcional ao armazém, não fixa — num
 * pulmão de 13 módulos uma folga fixa de poucos metros desapareceria.
 */
export function areaDoRadar(celulas: readonly CelulaRadar[], fatorMargem = 0.45): AreaRadar {
  if (celulas.length === 0) return { minX: -1, minZ: -1, largura: 2, profundidade: 2 };

  const xs = celulas.map(c => c.x);
  const zs = celulas.map(c => c.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  // Uma rua só, ou um módulo só, dá extensão zero num dos eixos. Sem o piso de 1 a
  // margem seria zero e o viewBox degeneraria numa linha.
  const margem = Math.max(1, Math.max(maxX - minX, maxZ - minZ) * fatorMargem);

  return {
    minX: minX - margem,
    minZ: minZ - margem,
    largura: maxX - minX + margem * 2,
    profundidade: maxZ - minZ + margem * 2,
  };
}

/**
 * Converte um ponto do MUNDO para a coordenada LOCAL que o radar desenha.
 *
 * É a inversa exata do deslocamento que a cena aplica ao grupo. Sem ela, o cone da
 * câmera apareceria afastado do armazém por metade da largura dele.
 */
export function mundoParaLocal(
  x: number,
  z: number,
  deslocamento: readonly [number, number, number],
): [number, number] {
  return [x - deslocamento[0], z - deslocamento[2]];
}

/** Converte um ponto do radar de volta para o MUNDO, para mirar a câmera. */
export function localParaMundo(
  x: number,
  z: number,
  deslocamento: readonly [number, number, number],
): [number, number] {
  return [x + deslocamento[0], z + deslocamento[2]];
}

/**
 * Prende um ponto dentro da área desenhada.
 *
 * A câmera pode ser afastada muito além da folga do enquadramento. Deixar o marcador
 * sair do quadro seria perder justamente a informação que ele carrega — melhor ele
 * encostar na borda, indicando a direção, do que desaparecer.
 */
export function prenderNaArea(x: number, z: number, area: AreaRadar): [number, number] {
  return [
    Math.min(Math.max(x, area.minX), area.minX + area.largura),
    Math.min(Math.max(z, area.minZ), area.minZ + area.profundidade),
  ];
}

/**
 * Direção do olhar, em GRAUS, para girar o cone no SVG.
 *
 * O SVG mapeia o Z do mundo no Y da tela (vista de cima, Z crescendo para baixo), então
 * `atan2(dz, dx)` já é o ângulo correto na tela, sem inversão de sinal. O cone é
 * desenhado apontando para +X, e esta rotação o alinha com o alvo.
 *
 * Câmera exatamente sobre o alvo não tem direção definida; devolve 0 em vez de NaN, que
 * apagaria o cone da tela sem nenhum aviso.
 */
export function grausDeVisao(camX: number, camZ: number, alvoX: number, alvoZ: number): number {
  const dx = alvoX - camX;
  const dz = alvoZ - camZ;
  if (dx === 0 && dz === 0) return 0;
  return (Math.atan2(dz, dx) * 180) / Math.PI;
}

/**
 * Meia-abertura HORIZONTAL da câmera, em radianos.
 *
 * O three aplica `fov` na VERTICAL. Usar esse valor direto desenharia um cone estreito
 * demais numa tela larga — e o radar estaria mentindo sobre o que cabe no quadro, que é
 * a única coisa que ele promete mostrar. A conversão é a mesma que o enquadramento
 * responsivo da cena já faz, na direção inversa.
 */
export function meiaAberturaHorizontal(fovVerticalGraus: number, aspecto: number): number {
  const meioVertical = (fovVerticalGraus * Math.PI) / 180 / 2;
  return Math.atan(Math.tan(meioVertical) * aspecto);
}

/**
 * Caminho SVG do cone de visão, com o vértice na origem e apontando para +X.
 *
 * Fica aberto no fim de propósito: o campo de visão não termina — o que termina é o
 * desenho. Fechar o arco sugeriria um limite de alcance que a câmera não tem.
 */
export function caminhoDoCone(meiaAbertura: number, alcance: number): string {
  // Acima de ~85° o cone viraria um semiplano e cobriria o radar inteiro, escondendo o
  // armazém que ele deveria situar. Nesse ponto ele deixa de informar.
  const meia = Math.min(meiaAbertura, (85 * Math.PI) / 180);
  const x = Math.cos(meia) * alcance;
  const y = Math.sin(meia) * alcance;
  return `M 0 0 L ${x.toFixed(3)} ${(-y).toFixed(3)} L ${x.toFixed(3)} ${y.toFixed(3)} Z`;
}
