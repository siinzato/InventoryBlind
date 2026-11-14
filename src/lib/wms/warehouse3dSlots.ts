// Converte os endereços reais do Pulmão no formato que a cena 3D desenha.
//
// Mora aqui, e não dentro do componente, por um motivo só: a regra de status é
// verificável sem WebGL. Dentro do `<Canvas>` ela só poderia ser conferida por
// screenshot, que é a forma mais fraca de provar que uma cor significa o que diz.
//
// NADA de schema novo: consome `listBins()` e `boxesByBin()`, que já existem e já são
// o que o mapa 2D usa. Nenhuma migration, nenhum tipo gerado, nenhuma query nova.
//
// ── O que o banco NÃO oferece ───────────────────────────────────────────────────
// A Fase 2 pediu "divergência pendente de inventário cego" como estado da vaga. Esse
// vínculo NÃO EXISTE no schema: a divergência de contagem é apurada por produto, e o
// produto se localiza por `products.location`, que não é um código de vaga. Medido no
// banco de produção: dos 2.174 produtos com `location` preenchido, ZERO casam com o
// padrão de endereço (`PP-A01-N1`). Não há como ligar uma divergência a uma vaga sem
// uma decisão de produto que ainda não foi tomada.
//
// Por isso `divergence` aqui significa SOMENTE capacidade excedida. Inventar uma
// heurística para o resto produziria uma cor de alerta que não corresponde a nada —
// pior que não ter a cor, porque o operador agiria sobre ela.

import { listBins, boxesByBin, type StorageBin } from './wmsService';
import { parseBinCode } from './binCode';

export type SlotStatus = 'empty' | 'occupied' | 'divergence' | 'blocked';

export interface Slot {
  /** Código real impresso na etiqueta: `PP-A01-N1`. */
  id: string;
  /** Índice da rua (1-based) para posicionar em X. A rua real é uma LETRA, não número. */
  rua: number;
  /** Letra da rua como está no código: 'A', 'B'... Para exibir, nunca para posicionar. */
  ruaCodigo: string;
  modulo: number;
  nivel: number;
  status: SlotStatus;
  caixas: number;
  capacidade: number | null;
}

export interface WarehouseSlots {
  slots: Slot[];
  /**
   * Vagas cujo código não segue o padrão de endereço e portanto não têm posição no
   * espaço. NÃO são descartadas em silêncio: o mapa 2D também as mantém num grupo
   * próprio, e sumir com elas faria o 3D mostrar menos vagas do que o armazém tem,
   * sem dizer isso a ninguém.
   */
  naoPosicionaveis: string[];
  /**
   * UUID da vaga -> código impresso na etiqueta.
   *
   * O mapa 3D identifica vaga pelo CÓDIGO (`PP-A01-N1`), mas o banco referencia por
   * UUID: o saldo guarda `bin_id`, não o código. Um evento de tempo real chega com o
   * UUID, e sem esta tradução não há como saber QUAL endereço acabou de mudar.
   *
   * Inclui também as vagas não posicionáveis: elas não aparecem no desenho, mas uma
   * mudança nelas ainda precisa ser reconhecida em vez de tratada como vaga
   * desconhecida.
   */
  codigoPorBinId: Map<string, string>;
}

/**
 * Status de uma vaga, na mesma ordem de precedência do mapa 2D (`WmsStorageMap`).
 *
 * `blocked` vem primeiro porque bloqueio é uma decisão humana que se sobrepõe ao
 * saldo: uma vaga bloqueada com caixas dentro continua bloqueada.
 *
 * `blocked` NÃO estava na especificação da Fase 1, que previa três estados. Foi
 * acrescentado porque a alternativa era pintar uma vaga bloqueada como livre — e
 * mandar um pallet para uma vaga interditada é um erro operacional caro.
 */
export function statusDaVaga(bin: Pick<StorageBin, 'blocked' | 'capacityBoxes'>, caixas: number): SlotStatus {
  if (bin.blocked) return 'blocked';
  if (caixas === 0) return 'empty';
  // Estouro de capacidade é o único "alerta" que o schema de fato sustenta hoje.
  // Estritamente maior: ocupar a capacidade inteira é a vaga cheia, não um defeito.
  if (bin.capacityBoxes !== null && caixas > bin.capacityBoxes) return 'divergence';
  return 'occupied';
}

/**
 * Monta as vagas posicionáveis a partir dos endereços e do saldo por vaga.
 *
 * Pura: recebe os dois conjuntos já carregados e não toca em rede. O índice da rua é
 * calculado sobre o conjunto INTEIRO (letras distintas, em ordem), e não por vaga —
 * só assim a rua B fica sempre entre a A e a C, mesmo que a B não tenha nenhuma vaga
 * no nível 1.
 */
export function buildSlots(bins: readonly StorageBin[], caixasPorVaga: ReadonlyMap<string, number>): WarehouseSlots {
  const naoPosicionaveis: string[] = [];
  const analisadas: { bin: StorageBin; rua: string; modulo: number; nivel: number }[] = [];

  for (const bin of bins) {
    const parsed = parseBinCode(bin.code);
    const modulo = parsed ? Number(parsed.module) : Number.NaN;
    if (!parsed || !Number.isFinite(modulo) || !Number.isFinite(parsed.level)) {
      naoPosicionaveis.push(bin.code);
      continue;
    }
    analisadas.push({ bin, rua: parsed.street, modulo, nivel: parsed.level });
  }

  const ruas = [...new Set(analisadas.map(a => a.rua))].sort();
  const indiceDaRua = new Map(ruas.map((letra, i) => [letra, i + 1]));

  const slots = analisadas.map(({ bin, rua, modulo, nivel }) => {
    const caixas = caixasPorVaga.get(bin.code) ?? 0;
    return {
      id: bin.code,
      rua: indiceDaRua.get(rua) ?? 1,
      ruaCodigo: rua,
      modulo,
      nivel,
      status: statusDaVaga(bin, caixas),
      caixas,
      capacidade: bin.capacityBoxes,
    };
  });

  // Construído sobre TODAS as vagas recebidas, não só as desenháveis — ver o comentário
  // de `codigoPorBinId`.
  const codigoPorBinId = new Map(bins.map(b => [b.id, b.code]));

  return { slots, naoPosicionaveis, codigoPorBinId };
}

/** Carrega os endereços reais do Pulmão e o saldo de cada um. */
export async function loadWarehouseSlots(): Promise<WarehouseSlots> {
  const [bins, caixas] = await Promise.all([listBins(), boxesByBin()]);
  return buildSlots(bins, caixas);
}
