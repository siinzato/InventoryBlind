// Rota de coleta dentro do pulmão: por onde passar, e em que ordem.
//
// ── O que esta rota NÃO é ───────────────────────────────────────────────────────
//
// Não é rota ÓTIMA, e o código não a chama assim em lugar nenhum. Rota ótima exige
// distância entre pontos, e o pulmão não tem geometria levantada: o endereço
// (`PP-A01-N1`) é uma hierarquia, não uma coordenada. `binSuggestion.ts` já registra
// isso — o código serve de desempate, "nunca como se fosse distância medida".
//
// Não começa numa DOCA nem termina no PICKING. Medido em produção: as 71 vagas são
// todas `bin_type = 'pulmao'`. Não existe doca, não existe área de picking, não existe
// ponto de partida. O armazém digital do Slotting TEM coordenadas e célula de
// expedição, mas é outro mundo: das 900 células, nenhuma casa com código de vaga, e só
// 12 têm código de qualquer tipo. Desenhar uma doca aqui seria inventar um lugar no
// chão de fábrica — e mandar o operador andar até ele.
//
// ── O que ela É ─────────────────────────────────────────────────────────────────
//
// A sequência de endereços de uma lista de coleta, na ordem FIFO que o sistema já
// usa: `searchStock` devolve os saldos do mais antigo para o mais novo, porque essa é
// "a ordem em que o estoque deve ser consumido". A rota não inventa prioridade — ela
// desenha a que já existe.
//
// O traçado entre dois endereços segue os eixos do armazém, não a linha reta: dentro
// da mesma rua anda-se ao longo dos módulos; para trocar de rua, volta-se à CABECEIRA
// do corredor e atravessa-se ali. Linha reta entre ruas atravessaria as estantes.
// Atravessar pela cabeceira é uma SUPOSIÇÃO declarada: não há corredor transversal
// cadastrado, e a cabeceira é o único ponto de travessia que o dado permite afirmar.

import { VAGA, posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import type { Slot } from './warehouse3dSlots';

export type Ponto3D = [number, number, number];

export interface ParadaDaRota {
  /** 1-based: é o número que aparece na lista e no marcador da cena. */
  ordem: number;
  slot: Slot;
  /** Pé da vaga, no nível do piso — onde o operador se posiciona. */
  noPiso: Ponto3D;
  /** Centro da vaga, na altura real dela. */
  naVaga: Ponto3D;
}

/** Altura do traçado no piso. Acima de zero para não brigar com a grade do chão. */
export const ALTURA_DA_ROTA = 0.2;

/**
 * Converte a lista de endereços em paradas, PRESERVANDO a ordem recebida.
 *
 * Não reordena: a ordem é a regra de negócio (FIFO) que veio de fora. Endereço repetido
 * entra uma vez só — a mesma vaga aparece em duas linhas de saldo quando guarda dois
 * produtos, e mandar o operador até lá duas vezes seria desperdício gerado pela tela.
 * Endereço desconhecido é descartado em vez de virar parada em (0,0,0), que colocaria
 * um ponto da rota num canto do armazém onde não há nada.
 */
export function paradasDaRota(
  codigosEmOrdem: readonly string[],
  slots: readonly Slot[],
  cfg: Layout3DConfig,
): ParadaDaRota[] {
  const porId = new Map(slots.map(s => [s.id, s]));
  const vistos = new Set<string>();
  const paradas: ParadaDaRota[] = [];

  for (const codigo of codigosEmOrdem) {
    if (vistos.has(codigo)) continue;
    const slot = porId.get(codigo);
    if (!slot) continue;
    vistos.add(codigo);
    const [x, y, z] = posicaoDaVaga(slot, cfg);
    paradas.push({
      ordem: paradas.length + 1,
      slot,
      noPiso: [x, ALTURA_DA_ROTA, z],
      naVaga: [x, y, z],
    });
  }

  return paradas;
}

/**
 * Posição da cabeceira do corredor, em Z.
 *
 * O módulo 1 fica em z=0, então a cabeceira é um pouco ANTES dele. É por ali que a
 * rota troca de rua, porque é o único ponto de travessia que o dado permite afirmar.
 */
export function cabeceiraZ(cfg: Layout3DConfig): number {
  return -cfg.moduleWidth * 0.9;
}

/**
 * Traçado no piso, ligando as paradas na ordem.
 *
 * Mesma rua: segmento direto ao longo dos módulos — é andar pelo corredor.
 * Rua diferente: sobe até a cabeceira, atravessa, e desce até o módulo de destino.
 *
 * Menos de duas paradas devolve vazio: uma linha precisa de dois pontos, e devolver um
 * ponto só faria a geometria da `<Line>` quebrar em silêncio.
 */
export function caminhoNoPiso(paradas: readonly ParadaDaRota[], cfg: Layout3DConfig): Ponto3D[] {
  if (paradas.length < 2) return [];

  const z0 = cabeceiraZ(cfg);
  const pontos: Ponto3D[] = [paradas[0].noPiso];

  for (let i = 1; i < paradas.length; i += 1) {
    const [xAnterior] = paradas[i - 1].noPiso;
    const [x, y, z] = paradas[i].noPiso;

    if (x !== xAnterior) {
      // Volta à cabeceira da rua atual, atravessa, entra na rua de destino.
      pontos.push([xAnterior, y, z0]);
      pontos.push([x, y, z0]);
    }
    // Trecho final ao longo do corredor. Se a parada já está na cabeceira, o ponto
    // repetido não atrapalha o desenho, mas evitá-lo mantém a geometria enxuta.
    if (pontos[pontos.length - 1][0] !== x || pontos[pontos.length - 1][2] !== z) {
      pontos.push([x, y, z]);
    }
  }

  return pontos;
}

/**
 * Subidas do piso até a vaga, uma por parada.
 *
 * Sem elas a rota diria em que módulo parar, mas não em que ALTURA pegar — que é
 * justamente o que distingue um porta-pallet de um corredor plano. Cada subida é um
 * par de pontos, desenhado como segmento próprio.
 */
export interface SubidaDaRota {
  /** Código da vaga. A subida carrega a identidade em vez de depender do índice: a
   *  lista é FILTRADA, e casar por posição com `paradas` daria a subida errada. */
  id: string;
  de: Ponto3D;
  ate: Ponto3D;
}

export function subidasAteAVaga(paradas: readonly ParadaDaRota[]): SubidaDaRota[] {
  const subidas: SubidaDaRota[] = [];

  for (const p of paradas) {
    const [x, , z] = p.noPiso;
    // Para no PÉ da vaga, não no centro: o traço morre encostando na caixa, em vez de
    // entrar por dentro dela.
    const pe = p.naVaga[1] - VAGA.altura / 2;

    // Vaga da face de piso NÃO tem subida. Medido: no nível 1 o pé fica em y=0, abaixo
    // do próprio traçado (0,2) — desenhar o segmento produziria um toco apontando para
    // BAIXO, atravessando o chão. Não há o que subir quando já se está no chão.
    if (pe <= ALTURA_DA_ROTA) continue;

    subidas.push({ id: p.slot.id, de: [x, ALTURA_DA_ROTA, z], ate: [x, pe, z] });
  }

  return subidas;
}
