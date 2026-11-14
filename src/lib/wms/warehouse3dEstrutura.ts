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
