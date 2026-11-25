// Os vãos da planta agrupados em LOTES prontos para instanciar.
//
// Antes cada vão era um `<mesh>` com geometria e material próprios: 311 malhas e ~1.245
// elementos React para os 215 endereços de hoje. Como cada malha é uma chamada de
// desenho por quadro, 5.000 endereços seriam 5.000 chamadas — e a vista por código, que
// já é instanciada, está DESLIGADA por padrão. A vista padrão era a que não escalava.
//
// ── Por que lotes, e não um objeto só ───────────────────────────────────────────
// Posição, escala e cor cabem na instância: a matriz carrega posição e escala (o passo
// do vão muda por fileira — a rua A tem 13 posições em 15,6 m e a rua E tem 12 em 15 m),
// e `setColorAt` carrega a cor. A OPACIDADE não cabe: `instanceColor` é RGB, e alpha é
// propriedade do material. Como a planta tem três estados de opacidade — fantasma 0,06,
// fora do filtro 0,45, em destaque 1 —, eles viram três lotes em vez de um.
//
// ── O que este módulo NÃO sabe ──────────────────────────────────────────────────
// Tema, WebGL e o significado das cores. Ele recebe a paleta já resolvida e uma função
// que diz a cor da vaga no modo atual. O que é REGRA aqui é a precedência (pulso > busca
// > modo de cor > fundo) e em que lote cada vão cai — e isso se confere sem montar cena.

import { destaqueDaVaga, type ContextoDeDestaque } from './warehouse3dDestaque';
import { vaosDaFileira, type BlocoFisico } from './warehouse3dPlantaFisica';
import type { Slot } from './warehouse3dSlots';
import type { Ponto } from './warehouse3dCoordenadas';

/** Uma instância desenhável: a matriz sai de `centro`+`tamanho`, a cor de `cor`. */
export interface InstanciaDeVao {
  /** Endereço que esta instância representa. `null` = vão sem vaga cadastrada. */
  codigo: string | null;
  centro: Ponto;
  tamanho: Ponto;
  cor: string;
}

/**
 * Os sete lotes.
 *
 * `palete` não leva cor por instância — madeira é madeira em todo o armazém, e pintá-la
 * com a cor de status faria a estrutura disputar significado com a carga em cima dela.
 */
export interface LotesDaPlanta {
  pisoDestaque: InstanciaDeVao[];
  pisoAtenuado: InstanciaDeVao[];
  /** Vão que a planta desenha e o cadastro não tem. Inerte: não recebe clique. */
  pisoFantasma: InstanciaDeVao[];
  cargaDestaque: InstanciaDeVao[];
  cargaAtenuada: InstanciaDeVao[];
  paleteDestaque: InstanciaDeVao[];
  paleteAtenuado: InstanciaDeVao[];
}

export interface PaletaDosLotes {
  /** Vaga mexida por outro operador nos últimos segundos. */
  pulso: string;
  /** Vaga que casou com a busca em curso. */
  busca: string;
  /** Vaga fora do filtro: presente, sem peso visual. */
  atenuada: string;
  /** Vão sem endereço cadastrado. */
  fantasma: string;
}

export interface MedidasDoVao {
  /** Espessura do palete de madeira. */
  alturaDoPalete: number;
  /** Espessura do piso desenhado na vaga livre. */
  alturaDoPiso: number;
}

/** Fração da altura do vão que a carga ocupa acima do palete. */
const FATOR_DA_CARGA = 0.88;

/**
 * Quanto a altura da carga pode encolher em relação ao padrão.
 *
 * 14% é o teto. Mais do que isso e a diferença deixa de ser "pallets montados por pessoas
 * diferentes" e passa a parecer dado — alguém leria altura como quantidade, que é
 * exatamente o que a cor já diz e a altura NÃO diz.
 */
const VARIACAO_MAXIMA = 0.14;

/**
 * Variação determinística da altura da carga, a partir do código do endereço.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────────
 * Todo pallet com a mesma altura exata é a assinatura de desenho gerado: num galpão real
 * nenhuma carga é montada igual à do vizinho. A uniformidade perfeita era o que mais
 * denunciava a cena como artificial.
 *
 * ── Por que determinística, e não aleatória ────────────────────────────────────
 * `Math.random()` faria a mesma vaga mudar de altura a cada filtro aplicado, a cada troca
 * de tema e a cada atualização de tempo real — o armazém respirando sozinho. Pior: faria
 * o mapa parecer que algo mudou quando nada mudou. Derivando do CÓDIGO, a altura de
 * `PP-A13-N3` é sempre a mesma, em qualquer sessão e em qualquer máquina.
 *
 * FNV-1a sobre o código, com `Math.imul` para o produto não estourar para ponto
 * flutuante: um hash somando charCodes daria alturas quase iguais para códigos vizinhos,
 * e `PP-A01` até `PP-A13` são todos vizinhos.
 *
 * Só encolhe, nunca cresce. A carga já ocupa 88% do vão; variar para cima a faria
 * atravessar a longarina do nível de cima em algumas vagas e não em outras — um bug que
 * só apareceria nos endereços cujo hash calhasse alto.
 */
export function variacaoDaCarga(codigo: string): number {
  let hash = 2166136261;
  for (let i = 0; i < codigo.length; i += 1) {
    hash ^= codigo.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const fracao = ((hash >>> 0) % 1000) / 1000;
  return 1 - fracao * VARIACAO_MAXIMA;
}
/** Recuo lateral da carga em relação ao vão — ela nunca ocupa a borda exata do palete. */
const RECUO_DA_CARGA = 0.94;

const vazio = (): LotesDaPlanta => ({
  pisoDestaque: [],
  pisoAtenuado: [],
  pisoFantasma: [],
  cargaDestaque: [],
  cargaAtenuada: [],
  paleteDestaque: [],
  paleteAtenuado: [],
});

/**
 * Agrupa os vãos de todas as fileiras nos sete lotes.
 *
 * `corDaVaga` é injetada porque depende de tema, modo de cor, capacidade máxima e Curva
 * ABC — tudo de quem desenha. A PRECEDÊNCIA, que é o que importa conferir, fica aqui.
 *
 * Vão com carga produz DUAS instâncias (palete e carga) e nenhuma de piso: o palete
 * cobre o piso, e desenhar os dois seria geometria escondida custando quadro.
 */
export function lotesDaPlanta(
  blocos: readonly BlocoFisico[],
  vagasPorCodigo: ReadonlyMap<string, Slot>,
  destaque: ContextoDeDestaque,
  paleta: PaletaDosLotes,
  corDaVaga: (slot: Slot) => string,
  medidas: MedidasDoVao,
  prefixo = 'PP',
): LotesDaPlanta {
  const lotes = vazio();

  for (const bloco of blocos) {
    if (bloco.tipo !== 'fileira') continue;

    for (const vao of vaosDaFileira(bloco, prefixo)) {
      const [largura, alturaVao, profundidade] = vao.tamanho;
      const [vx, vy, vz] = vao.centro;
      const base = vy - alturaVao / 2;
      const slot = vao.codigo ? vagasPorCodigo.get(vao.codigo) ?? null : null;

      // Sem endereço: só o piso, fantasma e inerte. O lugar existe no desenho, mas não há
      // vaga para receber nada — e fingir que há é pior do que não desenhar.
      if (!slot) {
        lotes.pisoFantasma.push({
          codigo: null,
          centro: [vx, base + medidas.alturaDoPiso / 2, vz],
          tamanho: [largura, medidas.alturaDoPiso, profundidade],
          cor: paleta.fantasma,
        });
        continue;
      }

      const d = destaqueDaVaga(slot, destaque);
      const cor = d.pulsando
        ? paleta.pulso
        : d.achada
          ? paleta.busca
          : d.ativa
            ? corDaVaga(slot)
            : paleta.atenuada;

      if (slot.caixas > 0) {
        const alturaDaCarga =
          (alturaVao - medidas.alturaDoPalete) * FATOR_DA_CARGA * variacaoDaCarga(slot.id);
        const palete: InstanciaDeVao = {
          codigo: slot.id,
          centro: [vx, base + medidas.alturaDoPalete / 2, vz],
          tamanho: [largura, medidas.alturaDoPalete, profundidade],
          // A cor do palete é uniforme e vem do material; aqui ela só não é usada.
          cor,
        };
        const carga: InstanciaDeVao = {
          codigo: slot.id,
          centro: [vx, base + medidas.alturaDoPalete + alturaDaCarga / 2, vz],
          tamanho: [largura * RECUO_DA_CARGA, alturaDaCarga, profundidade * RECUO_DA_CARGA],
          cor,
        };
        if (d.ativa) {
          lotes.paleteDestaque.push(palete);
          lotes.cargaDestaque.push(carga);
        } else {
          lotes.paleteAtenuado.push(palete);
          lotes.cargaAtenuada.push(carga);
        }
        continue;
      }

      // Vaga livre: o PISO do vão. Numa estante real a posição vazia é ar, e o bloco
      // cheio escondia justamente a treliça que faz aquilo parecer porta-pallets.
      const piso: InstanciaDeVao = {
        codigo: slot.id,
        centro: [vx, base + medidas.alturaDoPiso / 2, vz],
        tamanho: [largura, medidas.alturaDoPiso, profundidade],
        cor,
      };
      if (d.ativa) lotes.pisoDestaque.push(piso);
      else lotes.pisoAtenuado.push(piso);
    }
  }

  return lotes;
}

/** Quantas instâncias os sete lotes somam — serve para medir e para teste. */
export function totalDeInstancias(lotes: LotesDaPlanta): number {
  return (
    lotes.pisoDestaque.length +
    lotes.pisoAtenuado.length +
    lotes.pisoFantasma.length +
    lotes.cargaDestaque.length +
    lotes.cargaAtenuada.length +
    lotes.paleteDestaque.length +
    lotes.paleteAtenuado.length
  );
}
