// Geometria física do porta-pallets: montantes, vigas, palete e carga.
//
// Fora do componente pelo mesmo motivo dos outros módulos do mapa: posição de montante
// e de viga é aritmética, e errar nela produz estante atravessando pallet ou viga
// flutuando entre níveis. Isso se confere por teste, não por olhar a cena.
//
// ── Montante e viga NÃO pertencem à vaga ────────────────────────────────────────
// Numa estante real o montante é COMPARTILHADO entre dois vãos vizinhos, e a viga
// corre ao longo de toda a rua passando por baixo de vários pallets. Desenhar um
// quadro fechado por vaga duplicaria cada montante e empilharia vigas sobrepostas —
// com 71 vagas seriam centenas de peças no lugar de dezenas, e nas junções o
// z-fighting apareceria como cintilação.
//
// Por isso a estrutura é derivada do CONJUNTO: por rua, montantes nas divisas de
// módulo e vigas corridas por nível.
//
// ── O que continua vindo da vaga ────────────────────────────────────────────────
// Palete e carga, que são por posição. A cor da carga continua sendo decidida fora
// daqui: este módulo responde ONDE as peças ficam, nunca o que elas significam.

import { VAGA, baseDaRua, posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

/** Medidas da estrutura, em metros. Proporções de porta-pallets convencional. */
export const ESTRUTURA = {
  /** Seção quadrada do montante. */
  montante: 0.09,
  /** Altura da viga horizontal. */
  viga: 0.07,
  /** Espessura do palete de madeira. */
  palete: 0.12,
  /** Recuo do palete em relação ao vão, de cada lado. */
  folgaPalete: 0.06,
  /** Recuo da carga em relação ao vão, de cada lado. Maior que a do palete: a carga
   *  nunca ocupa a borda exata do palete. */
  folgaCarga: 0.14,
  /** Folga no topo, para a carga não encostar na viga do nível de cima. */
  folgaTopo: 0.1,
  /**
   * Seção da diagonal de contraventamento. Mais fina que o montante, como no galpão:
   * ela trava o quadro, não sustenta carga. Mesmo valor da planta física — as duas
   * vistas desenham a MESMA estante, e uma diferença aqui apareceria como a estante
   * mudando de construção conforme a aba aberta.
   */
  diagonal: 0.04,
} as const;

export type Ponto = [number, number, number];

export interface PecaDaEstrutura {
  posicao: Ponto;
  /** Comprimento no eixo em que a peça se estende (Y para montante, Z para viga). */
  comprimento: number;
}

/** Altura e dimensões da carga empilhada sobre o palete. */
export const CARGA = {
  largura: VAGA.largura - ESTRUTURA.folgaCarga * 2,
  profundidade: VAGA.profundidade - ESTRUTURA.folgaCarga * 2,
  altura: VAGA.altura - ESTRUTURA.palete - ESTRUTURA.folgaTopo,
} as const;

export const PALETE = {
  largura: VAGA.largura - ESTRUTURA.folgaPalete * 2,
  profundidade: VAGA.profundidade - ESTRUTURA.folgaPalete * 2,
  altura: ESTRUTURA.palete,
} as const;

/** Piso do vão: a face em que o palete se apoia. */
export function pisoDoVao(slot: Slot, cfg: Layout3DConfig): number {
  return posicaoDaVaga(slot, cfg)[1] - VAGA.altura / 2;
}

/** Centro do palete apoiado no vão. */
export function posicaoDoPalete(slot: Slot, cfg: Layout3DConfig): Ponto {
  const [x, , z] = posicaoDaVaga(slot, cfg);
  return [x, pisoDoVao(slot, cfg) + PALETE.altura / 2, z];
}

/** Centro do bloco de carga, apoiado SOBRE o palete — nunca atravessando-o. */
export function posicaoDaCarga(slot: Slot, cfg: Layout3DConfig): Ponto {
  const [x, , z] = posicaoDaVaga(slot, cfg);
  return [x, pisoDoVao(slot, cfg) + PALETE.altura + CARGA.altura / 2, z];
}

interface ResumoDaRua {
  x: number;
  base: number;
  minModulo: number;
  maxModulo: number;
  maxNivel: number;
}

function resumirRuas(slots: readonly Slot[], cfg: Layout3DConfig): ResumoDaRua[] {
  const porRua = new Map<string, ResumoDaRua>();

  for (const slot of slots) {
    const [x] = posicaoDaVaga(slot, cfg);
    const atual = porRua.get(slot.ruaCodigo);
    if (atual) {
      atual.minModulo = Math.min(atual.minModulo, slot.modulo);
      atual.maxModulo = Math.max(atual.maxModulo, slot.modulo);
      atual.maxNivel = Math.max(atual.maxNivel, slot.nivel);
    } else {
      porRua.set(slot.ruaCodigo, {
        x,
        base: baseDaRua(slot.ruaCodigo, cfg),
        minModulo: slot.modulo,
        maxModulo: slot.modulo,
        maxNivel: slot.nivel,
      });
    }
  }

  return [...porRua.values()];
}

/**
 * Montantes: as colunas verticais da estante.
 *
 * Nas DIVISAS entre módulos, não no centro deles — é onde ficam numa estante real, e é
 * o que faz o vão aparecer emoldurado em vez de cortado ao meio. São `n + 1` divisas
 * para `n` módulos, porque as duas pontas também têm coluna.
 *
 * Duas fileiras por rua, uma na frente e outra no fundo da profundidade do vão: é o
 * par que sustenta as vigas em que o pallet se apoia.
 */
export function montantesDoArmazem(
  slots: readonly Slot[],
  cfg: Layout3DConfig,
): PecaDaEstrutura[] {
  const pecas: PecaDaEstrutura[] = [];
  const meiaProfundidade = VAGA.profundidade / 2;

  for (const rua of resumirRuas(slots, cfg)) {
    // Da base da rua até o topo do último nível.
    const altura = rua.maxNivel * cfg.levelHeight;
    const centroY = rua.base + altura / 2;

    for (let m = rua.minModulo; m <= rua.maxModulo + 1; m += 1) {
      const z = (m - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
      for (const dx of [-meiaProfundidade, meiaProfundidade]) {
        pecas.push({ posicao: [rua.x + dx, centroY, z], comprimento: altura });
      }
    }
  }

  return pecas;
}

/**
 * Vigas: as travessas horizontais em que os paletes se apoiam.
 *
 * Uma por nível, CORRIDA pela rua inteira, em vez de um trecho por vaga. Trechos
 * separados se encostariam nas divisas e brigariam por profundidade ali — a
 * cintilação resultante é visível justamente nas junções, que é onde a estante precisa
 * parecer contínua.
 *
 * Uma travessa no TOPO de cada nível, do 1 ao último. Duas coisas saem disso de graça:
 * o topo da travessa coincide com o piso do nível de cima, que é onde aquele palete se
 * apoia; e o último nível ganha o travamento superior que toda estante tem.
 *
 * Duas medições corrigiram esta função, e as duas valem registrar:
 *
 * 1. Centro da travessa no piso do vão fazia o aço atravessar os 7 cm de baixo de TODO
 *    palete do armazém. Agora quem coincide com o piso é o TOPO dela.
 *
 * 2. A versão seguinte pulava o nível 1 — "o pallet de baixo apoia no chão, não precisa
 *    de travessa". Verdade para o pallet, falso para a ESTANTE: rua de um nível só
 *    ficava sem travessa nenhuma, e as colunas apareciam soltas, sem nada ligando uma à
 *    outra. Foi exatamente o que apareceu nas ruas C e D, que em produção só têm nível
 *    1. Travessa não existe só para segurar pallet — ela também é o que faz dois
 *    montantes serem uma estante.
 */
export function vigasDoArmazem(slots: readonly Slot[], cfg: Layout3DConfig): PecaDaEstrutura[] {
  const pecas: PecaDaEstrutura[] = [];
  const meiaProfundidade = VAGA.profundidade / 2;

  for (const rua of resumirRuas(slots, cfg)) {
    const modulos = rua.maxModulo - rua.minModulo + 1;
    const comprimento = modulos * cfg.moduleWidth;
    const zInicial = (rua.minModulo - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
    const centroZ = zInicial + comprimento / 2;

    for (let nivel = 1; nivel <= rua.maxNivel; nivel += 1) {
      const topo = rua.base + nivel * cfg.levelHeight;
      const y = topo - ESTRUTURA.viga / 2;
      for (const dx of [-meiaProfundidade, meiaProfundidade]) {
        pecas.push({ posicao: [rua.x + dx, y, centroZ], comprimento });
      }
    }
  }

  return pecas;
}

/**
 * Peça do quadro que não é ortogonal — hoje só a diagonal.
 *
 * Tem as três medidas e um giro, diferente de `PecaDaEstrutura`, que carrega um
 * comprimento só porque montante e longarina se estendem num eixo conhecido. A
 * diagonal não: ela é comprida numa direção inclinada, e descrevê-la por "comprimento"
 * obrigaria quem desenha a saber de que peça se trata para reconstruir o resto.
 *
 * Mesma forma da `PecaDaFileira` da planta física, de propósito: as duas alimentam o
 * mesmo desenho de instância, com a escala e o giro na matriz.
 */
export interface PecaInclinada {
  centro: Ponto;
  tamanho: Ponto;
  /** Giro em torno de Z, em radianos. */
  rotacaoZ: number;
}

/**
 * Diagonais de contraventamento da vista por CÓDIGO.
 *
 * Existiam só na planta física, e isso aparecia: a mesma estante tinha treliça numa aba
 * e um par de barras lisas na outra. Como as duas vistas desenham o mesmo porta-pallets,
 * a diferença lia como mudança de construção, não como mudança de ponto de vista.
 *
 * ── Onde a diagonal fica ────────────────────────────────────────────────────────
 * No QUADRO: o plano vertical que contém os dois montantes de uma mesma divisa de
 * módulo, atravessando a profundidade do vão. É o sentido em que o pallet entra e para
 * onde a estante tomba — por isso é ali que ela é travada, e não ao longo do corredor.
 *
 * Uma por nível em cada divisa, alternando o sentido por `(divisa + nível)`: o
 * zigue-zague da estante real, em vez de um feixe de riscos paralelos.
 *
 * ── Por que a subida é um nível MENOS a seção ───────────────────────────────────
 * Inclinada, a caixa ocupa em Y a subida mais a projeção da própria seção. Com a subida
 * cheia, a diagonal do último nível furaria o topo da estante — o mesmo erro já medido
 * na planta física, e a mesma correção. Com o desconto, a extensão vertical fecha em
 * exatamente um nível e o topo da última diagonal coincide com o topo do montante.
 */
export function diagonaisDoArmazem(
  slots: readonly Slot[],
  cfg: Layout3DConfig,
): PecaInclinada[] {
  const pecas: PecaInclinada[] = [];
  // Vão LIVRE entre os montantes: de centro a centro é a profundidade do vão, e a
  // diagonal encosta na face interna de cada um.
  const vao = VAGA.profundidade - ESTRUTURA.montante;
  const subida = cfg.levelHeight - ESTRUTURA.diagonal;
  if (vao <= 0 || subida <= 0) return pecas;

  const comprimento = Math.hypot(vao, subida);
  const angulo = Math.atan2(subida, vao);

  for (const rua of resumirRuas(slots, cfg)) {
    // As MESMAS divisas dos montantes: a diagonal nasce entre o par que ela trava, e
    // uma contagem própria aqui soltaria a treliça das colunas.
    for (let m = rua.minModulo; m <= rua.maxModulo + 1; m += 1) {
      const z = (m - 1) * cfg.moduleWidth - cfg.moduleWidth / 2;
      for (let nivel = 1; nivel <= rua.maxNivel; nivel += 1) {
        pecas.push({
          centro: [rua.x, rua.base + (nivel - 1) * cfg.levelHeight + cfg.levelHeight / 2, z],
          // Comprida em X antes do giro: girada em torno de Z, ela se inclina no plano
          // X–Y, que é o plano em que os dois montantes vivem.
          tamanho: [comprimento, ESTRUTURA.diagonal, ESTRUTURA.diagonal],
          rotacaoZ: (m + nivel) % 2 === 0 ? angulo : -angulo,
        });
      }
    }
  }

  return pecas;
}

/**
 * Sapata: a chapa de base aparafusada no piso sob cada montante.
 *
 * Existe no galpão por motivo estrutural — distribui a carga da coluna na laje — e
 * existe aqui por motivo de leitura: vista de cima, a demarcação do pé da fileira fica
 * coberta pelas chapas de piso dos vãos, e a estante perde o contato com o chão. A
 * sapata é mais larga que o montante e cai FORA dessa cobertura, então ela é o que
 * assenta a estrutura no piso na vista aérea.
 *
 * 26 cm contra os 9 do montante: é a proporção de uma placa de base real, e é o mínimo
 * que ainda sobra para fora da chapa do vão.
 */
export const SAPATA = { lado: 0.26, espessura: 0.02 } as const;

/** Uma peça apoiada no piso, descrita pelo centro e pelas três medidas. */
export interface PecaNoChao {
  centro: Ponto;
  tamanho: Ponto;
}

/**
 * As sapatas dos montantes informados.
 *
 * Derivada dos montantes em vez de recalculada a partir das vagas, e isso é o ponto:
 * sapata que não nasce debaixo de um montante é sapata no lugar errado. Com a derivação,
 * mudar a geometria da estante move as duas juntas, sempre.
 *
 * O `- comprimento / 2` desce do centro do montante até o PÉ dele; a chapa é então
 * apoiada sobre o piso daquele ponto, não centrada nele.
 */
export function sapatasDosMontantes(montantes: readonly PecaDaEstrutura[]): PecaNoChao[] {
  return montantes.map(peca => ({
    centro: [peca.posicao[0], peca.posicao[1] - peca.comprimento / 2 + SAPATA.espessura / 2, peca.posicao[2]],
    tamanho: [SAPATA.lado, SAPATA.espessura, SAPATA.lado],
  }));
}
