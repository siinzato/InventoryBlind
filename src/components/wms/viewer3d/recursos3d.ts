// Geometrias, materiais e escratch de matriz do mapa 3D — os objetos de GPU.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de valor.
//
// Todos vivem no ESCOPO DO MÓDULO, e isso não é organização: `new BoxGeometry(...)` dentro
// de um componente alocaria um buffer de GPU a cada render, e o three não libera isso
// sozinho — é o vazamento clássico de cena react-three. Material recriado por render
// recompila shader pelo mesmo motivo.

import { useEffect, useMemo } from 'react';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Vector3,
  type InstancedMesh,
} from 'three';
import { VAGA } from '../../../lib/wms/warehouse3dLayout';
import { CARGA, ESTRUTURA, PALETE } from '../../../lib/wms/warehouse3dEstrutura';
import type { Slot } from '../../../lib/wms/warehouse3dSlots';
import type { Ponto } from '../../../lib/wms/warehouse3dCoordenadas';
import type { Theme } from '../../../lib/useTheme';
import {
  COR_ALERTA_GIRO, COR_COBERTURA, COR_COLUNA, COR_DEMARCACAO, COR_JANELA, COR_MARCACAO,
  COR_PALETE, COR_TRAVESSA,
} from './aparencia';

export const GEOMETRIA_VAGA = new BoxGeometry(VAGA.largura, VAGA.altura, VAGA.profundidade);
export const GEOMETRIA_ARESTAS = new EdgesGeometry(GEOMETRIA_VAGA);

export interface VagaDesenhavel {
  slot: Slot;
  posicao: [number, number, number];
  cor: string;
  /** Dentro do filtro: recebe eventos e cor plena. Fora: fica de fundo, inerte. */
  ativa: boolean;
}

/**
 * Funde as arestas de N vagas numa única geometria de linhas.
 *
 * Por que não usar `wireframe` no material instanciado, que seria uma linha de código:
 * `wireframe` desenha as arestas dos TRIÂNGULOS, então cada face ganha a diagonal e a
 * vaga livre vira uma malha visual em vez de uma caixa. A leitura "vazio é contorno"
 * se perde no ruído.
 *
 * Fundir preserva a aresta limpa do `EdgesGeometry` e continua sendo UM objeto de GPU,
 * que é o que importa para densidade: 5.000 vagas livres custam o mesmo desenho que
 * uma. O preço é que a cor passa a ser uniforme no lote — por isso há dois lotes,
 * ativo e atenuado, e não um por vaga.
 */
export function fundirArestas(
  vagas: readonly VagaDesenhavel[],
  arestas: EdgesGeometry = GEOMETRIA_ARESTAS,
  /** Repetições verticais, para desenhar a divisão entre camadas de caixas num mesmo
   *  pallet: cada deslocamento reaproveita o mesmo contorno numa altura diferente. */
  deslocamentosY: readonly number[] = [0],
): BufferGeometry {
  const base = arestas.getAttribute('position').array as Float32Array;
  const porVaga = base.length * deslocamentosY.length;
  const destino = new Float32Array(porVaga * vagas.length);

  vagas.forEach((vaga, indice) => {
    const [dx, dy, dz] = vaga.posicao;
    deslocamentosY.forEach((offset, camada) => {
      const salto = indice * porVaga + camada * base.length;
      for (let k = 0; k < base.length; k += 3) {
        destino[salto + k] = base[k] + dx;
        destino[salto + k + 1] = base[k + 1] + dy + offset;
        destino[salto + k + 2] = base[k + 2] + dz;
      }
    });
  });

  const geometria = new BufferGeometry();
  geometria.setAttribute('position', new BufferAttribute(destino, 3));
  return geometria;
}

/** Geometria fundida que se descarta sozinha quando a entrada muda. Sem o dispose, cada
 *  troca de filtro deixaria um buffer órfão na GPU — o three não recolhe isso. */
export function useArestasFundidas(
  vagas: readonly VagaDesenhavel[],
  arestas: EdgesGeometry = GEOMETRIA_ARESTAS,
  deslocamentosY: readonly number[] = [0],
): BufferGeometry {
  const geometria = useMemo(
    () => fundirArestas(vagas, arestas, deslocamentosY),
    [vagas, arestas, deslocamentosY],
  );
  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

// Materiais no módulo: nenhum dos dois depende do tema (a cor vem por instância), então
// recriá-los a cada render só geraria recompilação de shader.
export const MATERIAL_SOLIDO = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05 });
/** Apanhador de clique: ocupa espaço para o raycast e não desenha nada. */
export const MATERIAL_INVISIVEL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/**
 * Os materiais da estrutura, UM CONJUNTO POR TEMA — e nenhum deles é mutado.
 *
 * Aço e madeira NÃO são semânticos: montante, travessa e palete têm a mesma cor em todo
 * o armazém, sempre. Quem carrega significado é a CARGA. Se a estrutura mudasse de cor
 * junto, o operador teria dois sinais concorrentes no mesmo lugar.
 *
 * Antes era um singleton por material, com a cor trocada por `.color.set()` em efeitos de
 * três componentes diferentes (`EstruturaDeRack`, `EstruturaDaPlanta`, `PlantaFisica3D`).
 * Funcionava porque esses componentes nunca coexistem — a vista por código e a planta são
 * exclusivas —, mas a garantia era CIRCUNSTANCIAL: bastaria uma terceira vista, ou as duas
 * na tela ao mesmo tempo, para o último efeito a rodar pintar a cena inteira.
 *
 * Com um conjunto por tema, o material deixa de ser estado compartilhado e vira escolha:
 * quem desenha PEDE o conjunto do tema em que está. Ninguém pode mais pintar o aço de
 * outro componente.
 *
 * O preço é oito materiais em vez de quatro. Cada um compila o shader na primeira vez que
 * é usado, e trocar de tema nunca mais recompila nada — o inverso do que a mutação fazia.
 */
const aco = (cor: string, aspereza: number, metalicidade: number) =>
  new MeshStandardMaterial({ color: cor, roughness: aspereza, metalness: metalicidade });

const madeira = (cor: string, translucido = false) =>
  new MeshStandardMaterial({
    color: cor,
    roughness: 0.92,
    metalness: 0,
    ...(translucido ? { transparent: true, opacity: 0.45, depthWrite: false } : {}),
  });

export interface MateriaisDaEstrutura {
  coluna: MeshStandardMaterial;
  travessa: MeshStandardMaterial;
  palete: MeshStandardMaterial;
  /** Palete de vaga fora do filtro. Mesma madeira, translúcida. */
  paleteAtenuado: MeshStandardMaterial;
}

export const MATERIAIS_DA_ESTRUTURA: Record<Theme, MateriaisDaEstrutura> = {
  light: {
    coluna: aco(COR_COLUNA.light, 0.5, 0.45),
    travessa: aco(COR_TRAVESSA.light, 0.55, 0.35),
    palete: madeira(COR_PALETE.light),
    paleteAtenuado: madeira(COR_PALETE.light, true),
  },
  dark: {
    coluna: aco(COR_COLUNA.dark, 0.5, 0.45),
    travessa: aco(COR_TRAVESSA.dark, 0.55, 0.35),
    palete: madeira(COR_PALETE.dark),
    paleteAtenuado: madeira(COR_PALETE.dark, true),
  },
};

/**
 * Os materiais dos sete lotes da planta.
 *
 * Um por combinação de geometria × opacidade, porque é a OPACIDADE que não cabe na
 * instância: `instanceColor` é RGB, alpha é propriedade do material. Os três estados
 * visuais da planta — fantasma, fora do filtro, em destaque — viram materiais, e os vãos
 * se distribuem entre eles.
 *
 * `depthWrite: false` nos translúcidos pelo mesmo motivo do raio-X: num lote só, os vãos
 * deixam de ser ordenados individualmente, e sem isso o vão da frente recortaria o que
 * está atrás dele.
 */
export const MATERIAL_PISO = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
export const MATERIAL_PISO_ATENUADO = new MeshStandardMaterial({
  roughness: 0.8, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false,
});
export const MATERIAL_PISO_FANTASMA = new MeshStandardMaterial({
  roughness: 0.8, metalness: 0, transparent: true, opacity: 0.06, depthWrite: false,
});
export const MATERIAL_CARGA_PLANTA = new MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
export const MATERIAL_CARGA_ATENUADA = new MeshStandardMaterial({
  roughness: 0.72, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false,
});
/**
 * Modo raio-X: a vaga fora do filtro vira vidro em vez de sumir.
 *
 * `depthWrite: false` é o que faz funcionar — sem isso o vidro da frente esconderia o
 * alerta atrás dele, que é exatamente o que se quis enxergar. O preço é que vidro
 * sobre vidro não respeita ordem; aceitável, porque o que importa aqui é a posição da
 * vaga em destaque dentro da estante, não o sombreado do contexto.
 */
export const MATERIAL_RAIOX = new MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false });
/**
 * Tinta no chão da demarcação de fileira.
 *
 * Fosca e sem metal: demarcação pintada não reflete. Um conjunto POR TEMA pelo mesmo
 * motivo dos materiais da estrutura — um material só, repintado por quem desenha, é
 * estado global disfarçado: basta uma segunda vista na tela para um componente repintar
 * a cena do outro.
 */
export const MATERIAL_DEMARCACAO: Record<Theme, MeshStandardMaterial> = {
  light: new MeshStandardMaterial({ color: COR_DEMARCACAO.light, roughness: 0.95, metalness: 0 }),
  dark: new MeshStandardMaterial({ color: COR_DEMARCACAO.dark, roughness: 0.95, metalness: 0 }),
};

/** Viga de sustentação do pulmão suspenso. Cinza de estrutura, nunca semântico. */
export const MATERIAL_VIGA = new MeshStandardMaterial({ color: '#475569', roughness: 0.9, metalness: 0.1 });
/** 1 m de altura de propósito: escalar em Y passa a dar a altura direto em metros. */
// ── Porta-pallets: estrutura, palete e carga ───────────────────────────────────
//
// A carga é MENOR que o vão de propósito. Antes a vaga era um cubo preenchendo o vão
// inteiro, e dois níveis ocupados viravam um bloco contínuo sem leitura de altura. Com
// a folga, cada pallet fica visivelmente separado do de cima e a estante aparece.

export const GEOMETRIA_CARGA = new BoxGeometry(CARGA.largura, CARGA.altura, CARGA.profundidade);
/** Contorno de MEIA carga: repetido em duas alturas, desenha a divisão entre as duas
 *  camadas de caixas do pallet além do contorno externo. */
export const GEOMETRIA_ARESTAS_CAMADA = new EdgesGeometry(
  new BoxGeometry(CARGA.largura, CARGA.altura / 2, CARGA.profundidade),
);
/** As duas camadas, medidas a partir do CENTRO da carga. */
export const CAMADAS_DA_CARGA = [-CARGA.altura / 4, CARGA.altura / 4] as const;

/** Linha que separa as camadas de caixas. Tom da própria carga, só mais escuro — uma
 *  cor nova aqui viraria mais um significado na cena. */
export const COR_DIVISAO_CAIXA: Record<Theme, string> = { light: '#8A6A42', dark: '#6E543A' };

export const GEOMETRIA_PALETE = new BoxGeometry(PALETE.largura, PALETE.altura, PALETE.profundidade);

/** Montante e travessa têm 1 m no eixo que varia; a escala por instância dá o resto. */
export const GEOMETRIA_COLUNA_RACK = new BoxGeometry(ESTRUTURA.montante, 1, ESTRUTURA.montante);
export const GEOMETRIA_TRAVESSA_RACK = new BoxGeometry(0.05, ESTRUTURA.viga, 1);

/**
 * Cubo de 1 m para a estrutura da PLANTA, onde cada peça tem as três medidas próprias
 * (a diagonal ainda gira). Uma geometria por tipo de peça não serviria: a escala por
 * instância é justamente o que permite montante, longarina e diagonal dividirem um
 * objeto de GPU só.
 */
export const GEOMETRIA_UNITARIA = new BoxGeometry(1, 1, 1);
export const ESCALA = new Vector3();

/** Deslocamentos verticais a partir do centro do vão. Constantes: o palete e a carga
 *  ficam sempre na mesma altura relativa, qualquer que seja o nível. */
export const DESLOCA_PALETE = -VAGA.altura / 2 + PALETE.altura / 2;
export const DESLOCA_CARGA = -VAGA.altura / 2 + PALETE.altura + CARGA.altura / 2;

/** As duas camadas já referidas ao centro do VÃO, que é a origem das instâncias.
 *  No módulo, e não dentro do componente: referência estável é o que impede a fusão
 *  das arestas de ser refeita a cada render. */
export const CAMADAS_NO_VAO: readonly number[] = CAMADAS_DA_CARGA.map(c => DESLOCA_CARGA + c);

export const GEOMETRIA_VIGA = new BoxGeometry(0.14, 1, 0.14);
/** Marcador do alerta de giro: losango pequeno, flutuando acima da vaga. Forma própria,
 *  e não um cubo menor, para não ser lido como mais uma vaga. */
export const GEOMETRIA_MARCADOR = new OctahedronGeometry(0.2);
export const MATERIAL_MARCADOR = new MeshStandardMaterial({
  color: COR_ALERTA_GIRO,
  roughness: 0.4,
  metalness: 0.05,
  emissive: COR_ALERTA_GIRO,
  emissiveIntensity: 0.3,
});
/**
 * Material próprio do lote de divergências, para o pulso não contaminar as demais
 * vagas. `emissive` âmbar: é a mesma família do `divergence` do mapa, então o alerta
 * brilha na cor que já significa alerta no resto do produto — e não ganha um vermelho
 * novo que nenhuma outra tela usa.
 */
export const MATERIAL_ALERTA = new MeshStandardMaterial({
  roughness: 0.6,
  metalness: 0.05,
  emissive: new Color('#F59E0B'),
  emissiveIntensity: 0,
});

export const MATRIZ = new Matrix4();
export const COR = new Color();

/**
 * Handlers inertes da caminhada.
 *
 * No escopo do módulo porque precisam ter IDENTIDADE ESTÁVEL: trocados por funções novas
 * a cada render, eles invalidariam os lotes instanciados e a memoização da cena — o preço
 * de cumprir a promessa não pode ser refazer a cena.
 */
export const SEM_ACAO_SELECIONAR = (_slot: Slot): void => undefined;
export const SEM_ACAO_APONTAR = (_slot: Slot | null): void => undefined;

/**
 * Arestas de um cubo de 1 m, para contorno ESCALADO por instância.
 *
 * `GEOMETRIA_ARESTAS` é a caixa fixa da vaga (1,2 × 1,4 × 1,2) e serve à grade por
 * código. Na planta o vão muda de medida por fileira, então o contorno precisa de uma
 * geometria neutra que a escala dimensiona — senão o realce da rua A aparece com o
 * tamanho da rua E.
 */
export const GEOMETRIA_ARESTAS_UNITARIAS = new EdgesGeometry(new BoxGeometry(1, 1, 1));

/**
 * Bloco de alocação dos lotes instanciados.
 *
 * 64 porque é o tamanho que paga: cada bloco são 64 matrizes de 16 floats (4 kB) mais a
 * cor, e um galpão inteiro cabe em poucas dezenas de blocos.
 */
const BLOCO_DE_CAPACIDADE = 64;

/**
 * Capacidade a alocar para um lote de `quantidade` instâncias.
 *
 * ── Por que não alocar exatamente o necessário ──────────────────────────────────
 * A capacidade de um `InstancedMesh` vai no construtor, via `args`, e não cresce sozinha.
 * Com `args` igual ao número exato de instâncias, QUALQUER mudança de contagem recria o
 * objeto: buffer de GPU novo, `instanceColor` novo, o anterior descartado. E contagem
 * muda o tempo todo — uma vaga que esvazia sai do lote "ocupada" e entra no "livre", e os
 * dois remontam.
 *
 * Arredondando para cima em blocos, a contagem passa a variar DENTRO da capacidade e só
 * `.count` muda, que é um número. O objeto de GPU sobrevive.
 *
 * Mínimo de um bloco mesmo para lote vazio: `new InstancedMesh(..., 0)` é válido mas
 * obriga a remontar no instante em que a primeira instância aparece — justamente o que
 * esta função existe para evitar.
 */
export function capacidadeDoLote(quantidade: number, bloco = BLOCO_DE_CAPACIDADE): number {
  if (quantidade <= bloco) return bloco;
  return Math.ceil(quantidade / bloco) * bloco;
}

/**
 * Os 24 vértices das 12 arestas do cubo unitário, como lista de pontos.
 *
 * Mesma forma de `GEOMETRIA_ARESTAS_UNITARIAS`, só que no formato que o `<Line>` do drei
 * consome. Derivada dela, e não digitada à mão, para as duas nunca divergirem.
 *
 * No escopo do módulo porque a referência precisa ser ESTÁVEL: o `<Line>` memoiza a
 * geometria por `points`, e um array novo a cada render reconstruiria o buffer a cada
 * movimento do mouse — exatamente o custo que o realce não pode ter.
 */
export const PONTOS_DO_CONTORNO: [number, number, number][] = (() => {
  const base = GEOMETRIA_ARESTAS_UNITARIAS.getAttribute('position').array as Float32Array;
  const pontos: [number, number, number][] = [];
  for (let i = 0; i < base.length; i += 3) pontos.push([base[i], base[i + 1], base[i + 2]]);
  return pontos;
})();

/**
 * Funde as arestas de N caixas de TAMANHOS DIFERENTES numa única geometria de linhas.
 *
 * `fundirArestas` não serve aqui: ela repete um contorno de medida fixa, que é o que a
 * grade por código tem — toda vaga mede 1,2 × 1,4 × 1,2. Na planta o vão muda de fileira
 * para fileira (a rua A tem 13 posições em 15,6 m, a E tem 12 em 15 m), então a carga de
 * cada rua tem medida própria e o contorno precisa ser escalado por caixa.
 *
 * `divisoes` empilha o contorno em camadas dentro da MESMA caixa. Com 2, sai o contorno
 * externo mais a linha do meio — que é o que faz o bloco de cor ser lido como duas
 * camadas de caixas sobre um palete em vez de um volume maciço. Por que isso importa:
 * a vista da planta é o padrão da tela e a carga lá era uma caixa colorida sem nenhuma
 * aresta, enquanto a vista por código já tinha a divisão. O mesmo pallet aparecia como
 * duas coisas diferentes conforme a vista.
 *
 * Continua sendo UM objeto de GPU: 215 endereços custam o mesmo desenho que um.
 */
export function fundirArestasDeCaixas(
  caixas: readonly { centro: Ponto; tamanho: Ponto }[],
  divisoes = 1,
): BufferGeometry {
  const base = GEOMETRIA_ARESTAS_UNITARIAS.getAttribute('position').array as Float32Array;
  const camadas = Math.max(1, Math.trunc(divisoes));
  const porCaixa = base.length * camadas;
  const destino = new Float32Array(porCaixa * caixas.length);

  caixas.forEach((caixa, indice) => {
    const [cx, cy, cz] = caixa.centro;
    const [largura, altura, profundidade] = caixa.tamanho;
    const alturaDaCamada = altura / camadas;

    for (let camada = 0; camada < camadas; camada += 1) {
      // Centro vertical desta camada, medido da BASE da caixa para cima.
      const y = cy - altura / 2 + alturaDaCamada * (camada + 0.5);
      const salto = indice * porCaixa + camada * base.length;
      for (let k = 0; k < base.length; k += 3) {
        destino[salto + k] = base[k] * largura + cx;
        destino[salto + k + 1] = base[k + 1] * alturaDaCamada + y;
        destino[salto + k + 2] = base[k + 2] * profundidade + cz;
      }
    }
  });

  const geometria = new BufferGeometry();
  geometria.setAttribute('position', new BufferAttribute(destino, 3));
  return geometria;
}

/** Mesma fusão, com descarte automático. Sem o dispose, cada troca de filtro deixaria um
 *  buffer órfão na GPU — o three não recolhe isso sozinho. */
export function useArestasDeCaixas(
  caixas: readonly { centro: Ponto; tamanho: Ponto }[],
  divisoes = 1,
): BufferGeometry {
  const geometria = useMemo(() => fundirArestasDeCaixas(caixas, divisoes), [caixas, divisoes]);
  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

// ── Escrita das matrizes de instância ──────────────────────────────────────────
//
// Mora aqui, e não no componente de cena, porque é concern de GPU e porque o CENÁRIO
// também instancia agora: janela, treliça de cobertura e sapata de montante usam a mesma
// escrita de matriz que a estante. Deixá-la em `Cena3D.tsx` obrigaria
// `WarehouseEnvironment` a importar do componente que o importa — dependência circular.

/**
 * Uma peça de estrutura como a matriz de instância a descreve: onde, quanto mede nos
 * três eixos e quanto gira.
 *
 * Estrutural de propósito — `PecaDaFileira` (planta física), `PecaInclinada` (vista por
 * código), `FaixaDePiso` e `PecaNoChao` se encaixam aqui sem conversão. Todas descrevem
 * a mesma coisa: uma caixa em algum lugar, e o desenho não deveria precisar saber de
 * qual módulo ela veio.
 */
export interface PecaDeQuadro {
  centro: [number, number, number];
  tamanho: [number, number, number];
  rotacaoZ?: number;
}

/**
 * Escreve as peças nas matrizes de um `InstancedMesh`.
 *
 * `MATRIZ` e `ESCALA` são escratch do módulo: alocar um `Matrix4` por peça encheria o
 * coletor a cada troca de filtro, e são centenas de peças por vista.
 */
export function aplicarPecas(malha: InstancedMesh | null, pecas: readonly PecaDeQuadro[]): void {
  if (!malha) return;
  pecas.forEach((p, i) => {
    if (p.rotacaoZ) MATRIZ.makeRotationZ(p.rotacaoZ);
    else MATRIZ.identity();
    MATRIZ.scale(ESCALA.set(p.tamanho[0], p.tamanho[1], p.tamanho[2]));
    MATRIZ.setPosition(p.centro[0], p.centro[1], p.centro[2]);
    malha.setMatrixAt(i, MATRIZ);
  });
  malha.count = pecas.length;
  malha.instanceMatrix.needsUpdate = true;
}

// ── Materiais do galpão e do equipamento ───────────────────────────────────────
//
// Um conjunto POR TEMA, como os da estante e pelo mesmo motivo: material compartilhado e
// repintado por quem desenha é estado global disfarçado.

export interface MateriaisDoGalpao {
  /** Vidro das janelas altas. Emissivo — ver `COR_JANELA`. */
  janela: MeshStandardMaterial;
  /** Treliça e terças da cobertura. */
  cobertura: MeshStandardMaterial;
  /** Zebrado de advertência da área de manobra. Fosco: tinta no chão não reflete. */
  zebrado: MeshStandardMaterial;
}

const vidro = (theme: Theme) =>
  new MeshStandardMaterial({
    color: COR_JANELA[theme].vidro,
    emissive: new Color(COR_JANELA[theme].vidro),
    emissiveIntensity: COR_JANELA[theme].brilho,
    roughness: 0.18,
    metalness: 0.1,
  });

export const MATERIAIS_DO_GALPAO: Record<Theme, MateriaisDoGalpao> = {
  light: {
    janela: vidro('light'),
    cobertura: new MeshStandardMaterial({ color: COR_COBERTURA.light, roughness: 0.62, metalness: 0.3 }),
    zebrado: new MeshStandardMaterial({ color: COR_MARCACAO.light, roughness: 0.92, metalness: 0 }),
  },
  dark: {
    janela: vidro('dark'),
    cobertura: new MeshStandardMaterial({ color: COR_COBERTURA.dark, roughness: 0.62, metalness: 0.3 }),
    zebrado: new MeshStandardMaterial({ color: COR_MARCACAO.dark, roughness: 0.92, metalness: 0 }),
  },
};

export interface MateriaisDoEquipamento {
  /** Corpo e teto de proteção: o amarelo de marcação, que esta cena já declara
   *  não-semântico. Amarelo de empilhadeira de verdade seria vizinho do âmbar de "acima da
   *  capacidade" e faria o alerta perder força dentro do próprio galpão. */
  corpo: MeshStandardMaterial;
  /** Mastro, colunas e garfos. Aço escuro: é a silhueta que faz o equipamento ser lido
   *  como empilhadeira em vez de caixote amarelo. */
  aco: MeshStandardMaterial;
}

export const MATERIAIS_DO_EQUIPAMENTO: Record<Theme, MateriaisDoEquipamento> = {
  light: {
    corpo: new MeshStandardMaterial({ color: COR_MARCACAO.light, roughness: 0.55, metalness: 0.15 }),
    aco: new MeshStandardMaterial({ color: '#3C4654', roughness: 0.45, metalness: 0.55 }),
  },
  dark: {
    corpo: new MeshStandardMaterial({ color: COR_MARCACAO.dark, roughness: 0.55, metalness: 0.15 }),
    aco: new MeshStandardMaterial({ color: '#2A313C', roughness: 0.45, metalness: 0.55 }),
  },
};
