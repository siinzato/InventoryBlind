// Pulmão -> Visualização 3D.
//
// Por que 3D, se o `WmsStorageMap` 2D já existe: o mapa 2D responde bem "quanto desta
// rua está cheio", porque achata uma rua de cada vez. O que ele não mostra é a relação
// entre ruas — altura ocupada, corredores vazios inteiros, alerta concentrado num
// nível. Essa é a pergunta que justifica a terceira dimensão; se não fosse, a tabela
// bastava.
//
// A regra de status NÃO mora aqui: ela está em `lib/wms/warehouse3dSlots.ts`, onde é
// testável sem WebGL. Dentro do `<Canvas>` só se poderia prová-la por screenshot, que
// é a forma mais fraca de mostrar que uma cor significa o que diz.
//
// ── Desenho em lote ─────────────────────────────────────────────────────────────
// As vagas são desenhadas com `<Instances>`: DOIS objetos de GPU no total, não um por
// vaga. Com um `<mesh>` por vaga, 5.000 endereços seriam 5.000 draw calls e a placa
// engasgaria muito antes disso. Aqui o custo de GPU é praticamente o mesmo para 71 ou
// para 5.000 — o que cresce é o lado React, não o desenho.
//
// Este arquivo ainda não é importado por nenhuma tela — plugá-lo numa rota é passo
// separado e deliberado.

import {
  Component, useCallback, useEffect, useMemo, useRef, useState,
  type ElementRef, type MouseEvent as ReactMouseEvent, type MutableRefObject,
  type ReactNode, type RefObject,
} from 'react';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry,
  Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PerspectiveCamera,
  Vector3,
  type InstancedMesh,
} from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
// Só os pesos e o subconjunto que esta tela usa. O pacote inteiro tem 2,4 MB (todos os
// alfabetos e pesos); estes três arquivos somam 72 kB. E ficam no CHUNK DO MAPA 3D, que
// é carregado sob demanda — quem nunca abre a seção não baixa fonte nenhuma.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import { Compass, Crosshair, Package, ScanLine, ShieldAlert, X } from 'lucide-react';
import {
  BrandLoader, Button, Input, Modal, Notice, Panel, PanelSection, Select, SegmentedControl,
  type SegmentedOption,
} from '../ui';
import { useTheme, type Theme } from '../../lib/useTheme';
import { int } from '../../lib/formatPtBr';
import { loadWarehouseSlots, type Slot, type SlotStatus, type WarehouseSlots } from '../../lib/wms/warehouse3dSlots';
import { assinarMudancasDoPulmao } from '../../lib/wms/warehouse3dRealtime';
import {
  LAYOUT_PADRAO, LIMITES, VAGA,
  baseDaRua, carregarLayout, posicaoDaVaga, salvarLayout,
  type Layout3DConfig,
} from '../../lib/wms/warehouse3dLayout';
import { listBinContents, searchStock, type BinStockRow } from '../../lib/wms/wmsService';
import {
  ABC_VAZIO, NIVEL_DE_PISO, alertasDeGiro, loadAbcDoArmazem,
  type AbcClasse, type AbcDaVaga, type AbcDoArmazem,
} from '../../lib/wms/warehouse3dAbc';
import {
  areaDoRadar, caminhoDoCone, celulasDoRadar, grausDeVisao, localParaMundo,
  meiaAberturaHorizontal, mundoParaLocal, prenderNaArea,
  type AreaRadar, type CelulaRadar,
} from '../../lib/wms/warehouse3dRadar';
import {
  caminhoNoPiso, paradasDaRota, subidasAteAVaga,
  type ParadaDaRota, type Ponto3D, type SubidaDaRota,
} from '../../lib/wms/warehouse3dRota';
import {
  ALTURA_DA_TARJA, anguloDaCamera, desenharLegenda, legendaDaAuditoria, nomeDoArquivo,
} from '../../lib/wms/warehouse3dSnapshot';
import {
  CARGA, ESTRUTURA, PALETE, montantesDoArmazem, vigasDoArmazem,
  type PecaDaEstrutura,
} from '../../lib/wms/warehouse3dEstrutura';
import { WarehouseEnvironment, type FundoDaCena } from './WarehouseEnvironment';

export type { Slot, SlotStatus } from '../../lib/wms/warehouse3dSlots';

// ── Geometria ──────────────────────────────────────────────────────────────────
//
// As medidas e a conversão endereço -> posição moram em `lib/wms/warehouse3dLayout`,
// onde são aritmética conferível sem WebGL. Aqui só se desenha.
//
// Uma vaga é 1,2 x 1,4 x 1,2 METROS — palete PBR carregado, não um cubo arbitrário.
// Cubo perfeito faria o armazém parecer uma estante de cubos, que é a leitura errada.

// ── Cor ────────────────────────────────────────────────────────────────────────
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então o arquivo
// mantém o seu próprio mapa — um único ponto de verdade, como um token — em vez de
// espalhar literais pelo JSX.
//
// `occupied` é PAPELÃO, não a navy da marca — e a troca foi deliberada quando a vaga
// deixou de ser um cubo e passou a ser pallet com caixas.
//
// "Ocupada" é o estado da maioria esmagadora das vagas de um armazém saudável. Pintar
// a maioria com uma cor forte gasta o recurso mais escasso da cena — a atenção — no
// caso que não pede nenhuma, e é exatamente o que a Design Constitution proíbe: estado
// default se desenha neutro. Com o papelão como base, o âmbar da divergência e o
// vermelho do giro passaram a ser as ÚNICAS cores saturadas da estante, e saltam.
//
// O tom é pardo dessaturado, não o `#D97706` sugerido: aquele é âmbar, vizinho do
// `#F59E0B` que significa "acima da capacidade" nesta mesma cena. Carga parecida com
// alerta é como apagar o alerta.
//
// A navy da marca não sumiu — ela continua sendo a escala do modo Ocupação, onde
// significa QUANTIDADE e não estado.
const COR_VAGA: Record<Theme, Record<SlotStatus, string>> = {
  light: { empty: '#64748B', occupied: '#C8A070', divergence: '#F59E0B', blocked: '#94A3B8' },
  dark: { empty: '#64748B', occupied: '#A07E57', divergence: '#F59E0B', blocked: '#475569' },
};

/** Escala de ocupação: a MESMA navy em três intensidades, não três cores diferentes.
 *  Tom é quantidade; matiz continua sendo significado. Trocar o matiz aqui faria o
 *  modo de ocupação competir com o de status, e nenhum dos dois seria lido. */
const ESCALA_OCUPACAO: Record<Theme, [string, string, string]> = {
  light: ['#7C9AC4', '#2F5A8F', '#0A2647'],
  dark: ['#3E6FA8', '#2A5FA3', '#1C4A85'],
};

/** Fora do filtro: presente, porque sumir destruiria a forma do armazém, mas sem
 *  nenhum peso visual. O filtro ISOLA, não amputa. */
const COR_ATENUADA: Record<Theme, string> = { light: '#D8DEE7', dark: '#262C38' };

const COR_REALCE: Record<Theme, string> = { light: '#0A2647', dark: '#9FC3F0' };

/**
 * Resultado de busca: azul, não dourado.
 *
 * A especificação ofereceu dourado (#EAB308) ou azul (#3B82F6). Dourado foi descartado
 * porque o âmbar #F59E0B já significa "pede atenção" NESTA MESMA cena — duas cores
 * quase idênticas com significados opostos ("achei o que você pediu" x "isto está
 * errado") treinariam o operador a ler errado as duas. Azul é a família de
 * selecionado/encontrado no resto do produto, então não disputa com o alerta.
 */
const COR_BUSCA = '#3B82F6';

/** Vaga recém-mexida por OUTRO operador. Transitória — dura dois segundos e some.
 *  Vizinha do azul da busca, e isso é aceitável porque as duas nunca competem pelo
 *  mesmo papel: a busca é um estado que a pessoa escolheu e permanece; isto é um aviso
 *  que ninguém pediu e que se apaga sozinho. O que as distingue é a duração. */
const COR_PULSO = '#38BDF8';

/** Dois segundos: tempo de perceber sem virar poluição quando o galpão está movimentado. */
const DURACAO_PULSO = 2000;

/**
 * Curva ABC de giro: UMA matiz em três intensidades, não três cores semânticas.
 *
 * A especificação pediu vermelho #EF4444 para A, âmbar #F59E0B para B e azul #3B82F6
 * para C. Os dois últimos já estão ocupados NESTA MESMA cena: #F59E0B é "acima da
 * capacidade" e #3B82F6 é "resultado da busca". Reusá-los faria o âmbar significar
 * duas coisas opostas ao mesmo tempo — "isto está errado" e "isto gira muito" —, e o
 * operador não tem como saber qual das duas a tela está dizendo.
 *
 * A curva é ORDINAL (A > B > C), exatamente como a ocupação, então segue a mesma regra
 * que já vale aqui: tom é quantidade, matiz é significado. Violeta porque é a única
 * família livre — a navy é ocupação, o âmbar é alerta, o azul é busca.
 *
 * No claro a classe A é a mais ESCURA; no escuro, a mais CLARA. Nos dois casos é a de
 * maior contraste contra o fundo, que é o que faz "alto giro" saltar primeiro.
 */
const ESCALA_ABC: Record<Theme, Record<AbcClasse, string>> = {
  light: { C: '#C4B0DC', B: '#8257B5', A: '#4C1D7A' },
  dark: { C: '#4A3A68', B: '#8B6BC0', A: '#C9A8F0' },
};

/** Alerta de giro mal posicionado. Vermelho é a única família semântica AINDA LIVRE na
 *  cena, e aqui ela é honesta: isto é um item de ação ("desça este pallet"), não um
 *  estado passivo. O âmbar não serve — já é "acima da capacidade". */
const COR_ALERTA_GIRO = '#DC2626';

/**
 * Cores da estrutura física. Constantes em toda a cena, nunca semânticas.
 *
 * A referência traz montante azul e travessa laranja, que é o padrão da indústria. A
 * travessa aqui é um laranja QUEIMADO, não o `#F97316` sugerido: esse laranja é
 * vizinho do `#F59E0B` que significa "acima da capacidade" nesta mesma cena, e uma
 * estante inteira pintada quase da cor do alerta faz o alerta desaparecer dentro dela.
 * Queimando o tom, a estrutura recua e o âmbar volta a saltar.
 */
const COR_COLUNA: Record<Theme, string> = { light: '#27497F', dark: '#2E5668' };
const COR_TRAVESSA: Record<Theme, string> = { light: '#A8521C', dark: '#8A4418' };
const COR_PALETE: Record<Theme, string> = { light: '#8A5A2B', dark: '#6B4522' };

const COR_GRADE: Record<Theme, [string, string]> = {
  light: ['#CBD5E1', '#E2E8F0'],
  dark: ['#2A3140', '#1C212B'],
};

const LEGENDA: ReadonlyArray<{ status: SlotStatus; rotulo: string }> = [
  { status: 'occupied', rotulo: 'Ocupada' },
  { status: 'empty', rotulo: 'Livre' },
  { status: 'divergence', rotulo: 'Acima da capacidade' },
  { status: 'blocked', rotulo: 'Bloqueada' },
];

/**
 * Filtro de status. Os rótulos dizem o que o filtro DE FATO faz.
 *
 * `divergence` é "acima da capacidade", e só isso. A divergência de contagem cega —
 * "a contagem não bateu" — NÃO é derivável: a contagem é apurada por produto, e
 * `products.location` não casa com código de vaga em nenhum dos 2.174 produtos que
 * têm location preenchido. Chamar este filtro de "contagem cega não bateu" seria um
 * rótulo mentindo sobre o que a tela sabe.
 */
type FiltroStatus = 'todas' | SlotStatus;

const FILTROS: ReadonlyArray<{ value: FiltroStatus; rotulo: string }> = [
  { value: 'todas', rotulo: 'Todas as vagas' },
  { value: 'divergence', rotulo: 'Acima da capacidade' },
  { value: 'occupied', rotulo: 'Ocupadas' },
  { value: 'empty', rotulo: 'Livres' },
  { value: 'blocked', rotulo: 'Bloqueadas' },
];

type ModoCor = 'status' | 'ocupacao' | 'abc';

// Mutável de propósito: `SegmentedControl` recebe `SegmentedOption<T>[]`, não
// ReadonlyArray. Anotar como readonly aqui só obrigaria a copiar no ponto de uso.
const MODOS: SegmentedOption<ModoCor>[] = [
  { value: 'status', label: 'Status' },
  { value: 'ocupacao', label: 'Ocupação' },
  { value: 'abc', label: 'Curva ABC' },
];

const LEGENDA_ABC: ReadonlyArray<{ classe: AbcClasse; rotulo: string }> = [
  { classe: 'A', rotulo: 'Curva A — alto giro' },
  { classe: 'B', rotulo: 'Curva B — giro médio' },
  { classe: 'C', rotulo: 'Curva C — baixo giro' },
];

/**
 * Fração de ocupação da vaga.
 *
 * Com capacidade cadastrada, é caixas/capacidade — a medida real. Sem ela, cai para a
 * comparação com a vaga mais cheia do armazém, que é RELATIVA e não diz "cheia", só
 * "mais cheia que as outras". Hoje nenhuma das vagas tem capacidade cadastrada, então
 * na prática é sempre o caminho relativo.
 */
export function fracaoOcupacao(slot: Slot, maxCaixas: number): number {
  if (slot.capacidade !== null && slot.capacidade > 0) return slot.caixas / slot.capacidade;
  return maxCaixas > 0 ? slot.caixas / maxCaixas : 0;
}

function corDaVaga(
  slot: Slot,
  modo: ModoCor,
  theme: Theme,
  maxCaixas: number,
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>,
): string {
  if (modo === 'status') return COR_VAGA[theme][slot.status];
  if (slot.status === 'empty') return COR_VAGA[theme].empty;
  if (modo === 'abc') {
    const classe = abcPorVaga.get(slot.id)?.classe;
    // Vaga com carga mas sem classe cai no MESMO cinza do que está fora do filtro. Não
    // é descuido: "não sei a curva disto" e "isto não é o que você está olhando agora"
    // pedem o mesmo peso visual — nenhum. Inventar um quarto tom de curva faria
    // "desconhecido" competir por atenção com "alto giro".
    return classe ? ESCALA_ABC[theme][classe] : COR_ATENUADA[theme];
  }
  const escala = ESCALA_OCUPACAO[theme];
  const fracao = fracaoOcupacao(slot, maxCaixas);
  return fracao < 0.4 ? escala[0] : fracao < 0.8 ? escala[1] : escala[2];
}

// ── Câmera ─────────────────────────────────────────────────────────────────────
//
// Três quartos, de cima: a vista que mostra altura e profundidade ao mesmo tempo. De
// frente viraria o mapa 2D que já existe; de cima viraria uma planta baixa.
//
// Isto é a DIREÇÃO do olhar, não a posição final. A distância é calculada a partir do
// tamanho do armazém, porque distância fixa só funciona para um armazém de tamanho
// fixo: calibrada num conjunto 3x4, ela cortava o armazém real, que tem 13 módulos
// numa das ruas.
const DIRECAO_CAMERA: [number, number, number] = [7.5, 6.5, 9.5];

/** Multiplicador sobre a diagonal do armazém. 1,5 dá a folga da vista de referência. */
const FOLGA_CAMERA = 1.5;

/**
 * Distância da câmera suficiente para o armazém inteiro caber no quadro.
 *
 * Usa a DIAGONAL da caixa que contém tudo, não só a maior aresta: um armazém longo e
 * estreito e um quadrado de mesma largura precisam de recuos diferentes, e a diagonal
 * é o que distingue os dois.
 */
export function enquadrarCamera(slots: readonly Slot[], cfg: Layout3DConfig): [number, number, number] {
  const magnitude = Math.hypot(...DIRECAO_CAMERA);
  if (slots.length === 0) return DIRECAO_CAMERA;

  const largura = (Math.max(...slots.map(s => s.rua)) - 1) * cfg.rowSpacing + VAGA.largura;
  const profundidade = (Math.max(...slots.map(s => s.modulo)) - 1) * cfg.moduleWidth + VAGA.profundidade;
  // A altura inclui a elevação da estrutura: com o pulmão suspenso a 3 m, a câmera
  // precisa recuar mais, senão o armazém sobe para fora do quadro.
  const topo = Math.max(...slots.map(s => baseDaRua(s.ruaCodigo, cfg) + s.nivel * cfg.levelHeight));

  const distancia = Math.max(Math.hypot(largura, profundidade, topo) * FOLGA_CAMERA, 6);
  const escala = distancia / magnitude;
  return [DIRECAO_CAMERA[0] * escala, DIRECAO_CAMERA[1] * escala, DIRECAO_CAMERA[2] * escala];
}

const FOV_BASE = 45;
const ASPECTO_BASE = 16 / 9;

/**
 * Trava o campo de visão HORIZONTAL em vez do vertical.
 *
 * O three aplica `fov` na vertical, então numa div estreita (celular em pé) o mesmo
 * fov cobre bem menos largura e o armazém sai cortado pelas laterais. Aqui o fov
 * vertical cresce à medida que o aspecto encolhe, de modo que a largura enquadrada
 * permanece a mesma em qualquer formato.
 *
 * Teto de 95°: além disso a perspectiva distorce tanto que as ruas do fundo viram um
 * borrão, e o remédio passa a ser pior que a doença.
 */
function EnquadramentoResponsivo() {
  const camera = useThree(estado => estado.camera);
  const largura = useThree(estado => estado.size.width);
  const altura = useThree(estado => estado.size.height);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || altura === 0) return;
    const aspecto = largura / altura;
    const fov =
      aspecto >= ASPECTO_BASE
        ? FOV_BASE
        : (2 * Math.atan(Math.tan((FOV_BASE * Math.PI) / 360) * (ASPECTO_BASE / aspecto)) * 180) / Math.PI;
    camera.fov = Math.min(fov, 95);
    camera.updateProjectionMatrix();
  }, [camera, largura, altura]);

  return null;
}

// ── Cena ───────────────────────────────────────────────────────────────────────
//
// Todas as vagas têm a mesma dimensão, então a geometria é UMA, criada no módulo e
// compartilhada. Construir `new BoxGeometry(...)` dentro do componente alocaria um
// buffer de GPU a cada render, e o three não libera isso sozinho — é o vazamento
// clássico de cena react-three.
const GEOMETRIA_VAGA = new BoxGeometry(VAGA.largura, VAGA.altura, VAGA.profundidade);
const GEOMETRIA_ARESTAS = new EdgesGeometry(GEOMETRIA_VAGA);

interface VagaDesenhavel {
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
function fundirArestas(
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
function useArestasFundidas(
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
const MATERIAL_SOLIDO = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05 });
/** Apanhador de clique: ocupa espaço para o raycast e não desenha nada. */
const MATERIAL_INVISIVEL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

/**
 * Materiais da estrutura física. A cor é UNIFORME (não vem por instância), então muda
 * por `.color.set()` num efeito em vez de materiais por tema — trocar o objeto
 * recompilaria o shader a cada alternância de tema, por uma cor.
 *
 * Aço e madeira NÃO são semânticos: montante, travessa e palete têm a mesma cor em
 * todo o armazém, sempre. Quem carrega significado é a CARGA. Se a estrutura mudasse
 * de cor junto, o operador teria dois sinais concorrentes no mesmo lugar.
 */
const MATERIAL_COLUNA = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.45 });
const MATERIAL_TRAVESSA = new MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 });
const MATERIAL_PALETE = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
/**
 * Modo raio-X: a vaga fora do filtro vira vidro em vez de sumir.
 *
 * `depthWrite: false` é o que faz funcionar — sem isso o vidro da frente esconderia o
 * alerta atrás dele, que é exatamente o que se quis enxergar. O preço é que vidro
 * sobre vidro não respeita ordem; aceitável, porque o que importa aqui é a posição da
 * vaga em destaque dentro da estante, não o sombreado do contexto.
 */
const MATERIAL_RAIOX = new MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false });
/** Viga de sustentação do pulmão suspenso. Cinza de estrutura, nunca semântico. */
const MATERIAL_VIGA = new MeshStandardMaterial({ color: '#475569', roughness: 0.9, metalness: 0.1 });
/** 1 m de altura de propósito: escalar em Y passa a dar a altura direto em metros. */
// ── Porta-pallets: estrutura, palete e carga ───────────────────────────────────
//
// A carga é MENOR que o vão de propósito. Antes a vaga era um cubo preenchendo o vão
// inteiro, e dois níveis ocupados viravam um bloco contínuo sem leitura de altura. Com
// a folga, cada pallet fica visivelmente separado do de cima e a estante aparece.

const GEOMETRIA_CARGA = new BoxGeometry(CARGA.largura, CARGA.altura, CARGA.profundidade);
/** Contorno de MEIA carga: repetido em duas alturas, desenha a divisão entre as duas
 *  camadas de caixas do pallet além do contorno externo. */
const GEOMETRIA_ARESTAS_CAMADA = new EdgesGeometry(
  new BoxGeometry(CARGA.largura, CARGA.altura / 2, CARGA.profundidade),
);
/** As duas camadas, medidas a partir do CENTRO da carga. */
const CAMADAS_DA_CARGA = [-CARGA.altura / 4, CARGA.altura / 4] as const;

/** Linha que separa as camadas de caixas. Tom da própria carga, só mais escuro — uma
 *  cor nova aqui viraria mais um significado na cena. */
const COR_DIVISAO_CAIXA: Record<Theme, string> = { light: '#8A6A42', dark: '#6E543A' };

const GEOMETRIA_PALETE = new BoxGeometry(PALETE.largura, PALETE.altura, PALETE.profundidade);

/** Montante e travessa têm 1 m no eixo que varia; a escala por instância dá o resto. */
const GEOMETRIA_COLUNA_RACK = new BoxGeometry(ESTRUTURA.montante, 1, ESTRUTURA.montante);
const GEOMETRIA_TRAVESSA_RACK = new BoxGeometry(0.05, ESTRUTURA.viga, 1);

/** Deslocamentos verticais a partir do centro do vão. Constantes: o palete e a carga
 *  ficam sempre na mesma altura relativa, qualquer que seja o nível. */
const DESLOCA_PALETE = -VAGA.altura / 2 + PALETE.altura / 2;
const DESLOCA_CARGA = -VAGA.altura / 2 + PALETE.altura + CARGA.altura / 2;

/** As duas camadas já referidas ao centro do VÃO, que é a origem das instâncias.
 *  No módulo, e não dentro do componente: referência estável é o que impede a fusão
 *  das arestas de ser refeita a cada render. */
const CAMADAS_NO_VAO: readonly number[] = CAMADAS_DA_CARGA.map(c => DESLOCA_CARGA + c);

const GEOMETRIA_VIGA = new BoxGeometry(0.14, 1, 0.14);
/** Marcador do alerta de giro: losango pequeno, flutuando acima da vaga. Forma própria,
 *  e não um cubo menor, para não ser lido como mais uma vaga. */
const GEOMETRIA_MARCADOR = new OctahedronGeometry(0.2);
const MATERIAL_MARCADOR = new MeshStandardMaterial({
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
const MATERIAL_ALERTA = new MeshStandardMaterial({
  roughness: 0.6,
  metalness: 0.05,
  emissive: new Color('#F59E0B'),
  emissiveIntensity: 0,
});

const MATRIZ = new Matrix4();
const COR = new Color();

/**
 * Um lote de vagas desenhado como UM objeto de GPU.
 *
 * Usa `THREE.InstancedMesh` direto em vez de `<Instances>`/`<Instance>` do drei, e a
 * escolha foi medida, não estética. O drei percorre TODAS as instâncias a cada quadro
 * decompondo e recompondo a matriz de cada uma (`Instances.js`, o `useFrame` que chama
 * `matrixWorld.decompose` por instância). Num armazém, que não se mexe, isso é trabalho
 * jogado fora: com 5.000 vagas a cena caía de 60 para 33 FPS, e o gargalo era CPU, não
 * desenho. Aqui as matrizes são escritas UMA vez por mudança de dado, e o quadro
 * seguinte não custa nada.
 *
 * O outro ganho é do lado React: `<Instance>` seria um componente por vaga — 5.000
 * elementos a reconciliar a cada filtro. Aqui são zero.
 *
 * `key` externa pela capacidade: o buffer do InstancedMesh é alocado em `args` e não
 * cresce sozinho.
 */
function LoteInstanciado({
  vagas,
  material,
  geometria = GEOMETRIA_VAGA,
  deslocamentoY = 0,
  corUniforme = false,
  onHover,
  onSelect,
}: {
  vagas: VagaDesenhavel[];
  material: MeshBasicMaterial | MeshStandardMaterial;
  /** Vão inteiro (padrão) para o apanhador de clique; carga ou palete para o desenho. */
  geometria?: BoxGeometry;
  /** Altura relativa ao CENTRO do vão. O palete desce até o piso, a carga fica sobre
   *  ele, e o apanhador de clique continua cobrindo o vão inteiro. */
  deslocamentoY?: number;
  /** O palete é madeira em todas as vagas: pintá-lo com a cor de status faria a
   *  estrutura disputar significado com a carga que está em cima dela. */
  corUniforme?: boolean;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = Math.max(1, vagas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    vagas.forEach((vaga, i) => {
      MATRIZ.makeTranslation(vaga.posicao[0], vaga.posicao[1] + deslocamentoY, vaga.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
      if (!corUniforme) malha.setColorAt(i, COR.set(vaga.cor));
    });
    malha.count = vagas.length;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }, [vagas, deslocamentoY, corUniforme]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometria, material, capacidade]}
      // `onPointerMove`, não `onPointerOver`: o lote inteiro é UM objeto, então o
      // "entrar" dispara uma vez só. É o movimento que revela a troca de instância.
      onPointerMove={e => {
        e.stopPropagation();
        const alvo = e.instanceId !== undefined ? vagas[e.instanceId] : undefined;
        onHover(alvo ? alvo.slot : null);
      }}
      onPointerOut={() => onHover(null)}
      onClick={e => {
        e.stopPropagation();
        const alvo = e.instanceId !== undefined ? vagas[e.instanceId] : undefined;
        if (alvo) onSelect(alvo.slot);
      }}
    />
  );
}

/**
 * Pulso do alerta: respira a emissividade do material do lote de divergências.
 *
 * Anima o MATERIAL, não as instâncias — é um número por quadro, não um por vaga, então
 * o custo não cresce com o tamanho do armazém.
 *
 * Respeita `prefers-reduced-motion`: para quem pediu menos movimento o alerta fica
 * aceso e parado em vez de piscar. Reduzido, não removido — tirar o brilho faria a
 * divergência sumir no meio da estante, que é o oposto do objetivo.
 */
function PulsoDeAlerta({ material, ativo }: { material: MeshStandardMaterial; ativo: boolean }) {
  const reduzido = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useFrame(({ clock }) => {
    if (!ativo) {
      material.emissiveIntensity = 0;
      return;
    }
    material.emissiveIntensity = reduzido ? 0.35 : 0.2 + 0.3 * (1 + Math.sin(clock.elapsedTime * 2.6)) / 2;
  });

  return null;
}

/**
 * Montantes do pulmão suspenso: do piso até a base da primeira prateleira.
 *
 * Sem eles, uma estrutura elevada aparece como mercadoria flutuando no ar — o desenho
 * fica bonito e incompreensível. As colunas são o que diz "isto está pendurado a três
 * metros, não empilhado no chão".
 *
 * Desenhadas só onde há elevação: com tudo apoiado no piso (o padrão), este lote fica
 * vazio e não custa nada.
 */
function Vigas({ colunas }: { colunas: { x: number; z: number; altura: number }[] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = Math.max(1, colunas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    colunas.forEach((coluna, i) => {
      // A geometria tem 1 m de altura, então escalar em Y dá a altura em metros.
      MATRIZ.makeScale(1, coluna.altura, 1);
      MATRIZ.setPosition(coluna.x, coluna.altura / 2, coluna.z);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = colunas.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [colunas]);

  return <instancedMesh ref={ref} args={[GEOMETRIA_VIGA, MATERIAL_VIGA, capacidade]} />;
}

/**
 * A estante em si: montantes verticais e travessas horizontais.
 *
 * Dois objetos de GPU para o armazém inteiro, não por vaga. A geometria tem 1 m no
 * eixo que varia e a escala por instância dá o resto — é o mesmo recurso que os
 * montantes de elevação já usam.
 *
 * Derivada do CONJUNTO de vagas, não de cada uma: o montante é compartilhado entre
 * vãos vizinhos e a travessa corre a rua inteira. Ver `warehouse3dEstrutura`.
 */
function EstruturaDeRack({
  montantes,
  travessas,
  theme,
}: {
  montantes: PecaDaEstrutura[];
  travessas: PecaDaEstrutura[];
  theme: Theme;
}) {
  const refColunas = useRef<InstancedMesh>(null);
  const refTravessas = useRef<InstancedMesh>(null);

  useEffect(() => {
    MATERIAL_COLUNA.color.set(COR_COLUNA[theme]);
    MATERIAL_TRAVESSA.color.set(COR_TRAVESSA[theme]);
    MATERIAL_PALETE.color.set(COR_PALETE[theme]);
  }, [theme]);

  useEffect(() => {
    const malha = refColunas.current;
    if (!malha) return;
    montantes.forEach((peca, i) => {
      MATRIZ.makeScale(1, peca.comprimento, 1);
      MATRIZ.setPosition(peca.posicao[0], peca.posicao[1], peca.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = montantes.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [montantes]);

  useEffect(() => {
    const malha = refTravessas.current;
    if (!malha) return;
    travessas.forEach((peca, i) => {
      // A geometria mede 1 no eixo Z; escalar em Z dá o comprimento da rua.
      MATRIZ.makeScale(1, 1, peca.comprimento);
      MATRIZ.setPosition(peca.posicao[0], peca.posicao[1], peca.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = travessas.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [travessas]);

  return (
    <>
      <instancedMesh
        ref={refColunas}
        args={[GEOMETRIA_COLUNA_RACK, MATERIAL_COLUNA, Math.max(1, montantes.length)]}
      />
      <instancedMesh
        ref={refTravessas}
        args={[GEOMETRIA_TRAVESSA_RACK, MATERIAL_TRAVESSA, Math.max(1, travessas.length)]}
      />
    </>
  );
}

/**
 * Marcador de giro mal posicionado: item de curva A fora da face de piso.
 *
 * Flutua ACIMA da vaga em vez de colori-la porque a cor da vaga já está dizendo outra
 * coisa — a curva. Sobrescrever a cor apagaria a informação que fez o alerta existir.
 *
 * Instanciado como as vigas: um objeto de GPU para todos os marcadores. Na prática a
 * lista é curta (hoje, um), mas o custo não cresce se o armazém crescer.
 */
function MarcadoresDeGiro({ pontos }: { pontos: [number, number, number][] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = Math.max(1, pontos.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    pontos.forEach(([x, y, z], i) => {
      MATRIZ.identity();
      MATRIZ.setPosition(x, y, z);
      malha.setMatrixAt(i, MATRIZ);
    });
    malha.count = pontos.length;
    malha.instanceMatrix.needsUpdate = true;
  }, [pontos]);

  return <instancedMesh ref={ref} args={[GEOMETRIA_MARCADOR, MATERIAL_MARCADOR, capacidade]} />;
}

/**
 * Lê a câmera a cada quadro e entrega posição, direção e abertura ao radar.
 *
 * NÃO guarda nada em estado do React. Um `setState` por quadro re-renderizaria o
 * visualizador inteiro 60 vezes por segundo — com o Canvas, os painéis e o SVG do radar
 * junto — e o custo apareceria como queda de FPS na cena, que é exatamente o que a
 * Etapa 3 pede para evitar. O destino dos valores é `setAttribute` em nós já montados.
 *
 * O callback vive num ref porque `useFrame` captura o closure do primeiro render: sem
 * isso, o radar continuaria recebendo as coordenadas calculadas com a geometria antiga
 * depois de qualquer mudança de layout.
 */
function SondaDeCamera({
  controlsRef,
  aoAtualizar,
}: {
  controlsRef: RefObject<ElementRef<typeof OrbitControls>>;
  aoAtualizar: (x: number, z: number, graus: number, meiaAbertura: number) => void;
}) {
  const callback = useRef(aoAtualizar);
  callback.current = aoAtualizar;
  const anterior = useRef({ x: NaN, z: NaN, graus: NaN, meia: NaN });

  useFrame(({ camera, size }) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const { x, z } = camera.position;
    const alvo = controls.target;
    const graus = grausDeVisao(x, z, alvo.x, alvo.z);
    const perspectiva = camera as PerspectiveCamera;
    const meia = meiaAberturaHorizontal(perspectiva.fov, size.width / Math.max(1, size.height));

    // Com a câmera parada, nada muda — e escrever atributo igual ainda custa. O corte é
    // por diferença mínima perceptível, não por igualdade exata: o amortecimento do
    // OrbitControls nunca para em valores idênticos, então `!==` nunca economizaria nada.
    const p = anterior.current;
    if (
      Math.abs(x - p.x) < 0.004 &&
      Math.abs(z - p.z) < 0.004 &&
      Math.abs(graus - p.graus) < 0.05 &&
      Math.abs(meia - p.meia) < 0.002
    ) {
      return;
    }
    anterior.current = { x, z, graus, meia };
    callback.current(x, z, graus, meia);
  });

  return null;
}

/**
 * Entrega ao HUD uma função que devolve o desenho atual do WebGL em PNG.
 *
 * `gl.render(...)` ANTES de ler é obrigatório. Sem `preserveDrawingBuffer`, o
 * navegador descarta o conteúdo do buffer assim que compõe o quadro, e o
 * `toDataURL` devolve uma imagem em branco — sem erro nenhum, o que faria o botão
 * baixar um PNG vazio e parecer que funcionou. Renderizar e ler no mesmo tique
 * resolve sem ligar `preserveDrawingBuffer`, que penaliza TODO quadro da sessão para
 * servir a um clique ocasional.
 */
function CapturadorDeCena({ registrar }: { registrar: (fn: (() => string) | null) => void }) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    registrar(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    });
    return () => registrar(null);
  }, [gl, scene, camera, registrar]);

  return null;
}

/** Para onde a câmera está indo. `null` = nenhuma transição em curso. */
interface DestinoDeCamera {
  alvo: Vector3;
  posicao: Vector3;
}

/**
 * Transição suave da câmera, usada pelo clique no radar.
 *
 * Interpolação exponencial com o delta do quadro, não um passo fixo: passo fixo faz a
 * mesma transição durar tempos diferentes em telas de 60 e de 144 Hz.
 *
 * Qualquer arraste do operador CANCELA a transição. Sem isso, a câmera continuaria
 * puxando para o destino enquanto a pessoa tenta girar a cena — a sensação é de
 * controle travado, e é um jeito rápido de o operador desistir do mapa.
 */
function PanSuave({
  controlsRef,
  destinoRef,
}: {
  controlsRef: RefObject<ElementRef<typeof OrbitControls>>;
  destinoRef: MutableRefObject<DestinoDeCamera | null>;
}) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cancelar = () => {
      destinoRef.current = null;
    };
    controls.addEventListener('start', cancelar);
    return () => controls.removeEventListener('start', cancelar);
  }, [controlsRef, destinoRef]);

  useFrame((_, delta) => {
    const destino = destinoRef.current;
    const controls = controlsRef.current;
    if (!destino || !controls) return;

    const fator = 1 - Math.pow(0.0025, Math.min(delta, 0.1));
    controls.target.lerp(destino.alvo, fator);
    controls.object.position.lerp(destino.posicao, fator);
    controls.update();

    // Encerra no destino exato. Interpolação exponencial nunca chega sozinha, e deixar o
    // laço vivo manteria o `update()` rodando para sempre por um resto de milímetro.
    if (controls.target.distanceTo(destino.alvo) < 0.02) {
      controls.target.copy(destino.alvo);
      controls.object.position.copy(destino.posicao);
      controls.update();
      destinoRef.current = null;
    }
  });

  return null;
}

export interface PlacaDeRua {
  rotulo: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Sinalização aérea: a placa que diz em que corredor você está.
 *
 * `<Html>` em vez do `<Text>` do drei por dois motivos. O `<Text>` desenha a tipografia
 * dentro do WebGL com uma fonte própria, o que significa uma fonte a mais para baixar e
 * um texto que não acompanha a escala tipográfica nem o tema do app. O `<Html>` é DOM
 * de verdade: herda `.text-code`, os tokens de cor e o modo escuro sem duplicar nada.
 *
 * `pointerEvents: none` é obrigatório — sem isso a placa interceptaria o clique das
 * vagas que estão atrás dela.
 *
 * A cor de fundo é o token `rail` (a navy #0A2647 da marca), não o slate-900 cru que a
 * especificação sugeriu: a placa passa a pertencer ao produto em vez de parecer um
 * componente de biblioteca.
 */
function PlacasDeRua({ placas }: { placas: PlacaDeRua[] }) {
  return (
    <>
      {placas.map(placa => (
        <Html
          key={`${placa.rotulo}-${placa.z}`}
          position={[placa.x, placa.y, placa.z]}
          center
          // SEM `distanceFactor`, de propósito. Com ele a placa encolhia junto com a
          // perspectiva e, na vista geral, era pintada em 6x9 PIXELS — um borrão escuro
          // que no tema claro parecia sujeira na tela, não sinalização. Placa de
          // corredor existe para ser lida: como rótulo de mapa, mantém tamanho
          // constante na tela e continua legível em qualquer zoom.
          style={{ pointerEvents: 'none' }}
        >
          {/* `leading-none` e padding apertado: em tamanho fixo a placa não pode pesar
              mais que o armazém que ela rotula. */}
          {/* `w-max max-w-none` é obrigatório, não preferência de estilo.

              Os wrappers que o `<Html>` cria são âncoras absolutas de LARGURA ZERO. O
              index.css tem uma regra global `*, *::before, *::after { max-width: 100% }`
              para barrar overflow horizontal no app inteiro — e 100% de um pai de 0px é
              0px. A placa colapsava para 14px (só padding e borda) com o texto
              transbordando: era isso o "nome bugado".

              `w-max` dimensiona pelo conteúdo e `max-w-none` desarma o teto SÓ aqui
              dentro, sem mexer na guarda global. Medido: de 14px para a largura real do
              texto. */}
          <div className="inline-block w-max max-w-none whitespace-nowrap rounded-control border border-white/25 bg-rail px-1.5 py-0.5 text-code text-[10px] font-semibold leading-none tracking-wide text-rail-fg shadow-panel">
            RUA {placa.rotulo}
          </div>
        </Html>
      ))}
    </>
  );
}

/** O que a cena precisa para desenhar a rota. Montado fora, por `useMemo`. */
interface RotaDesenhavel {
  paradas: ParadaDaRota[];
  caminho: Ponto3D[];
  subidas: SubidaDaRota[];
}

/**
 * Rota de coleta: por onde andar, em que ordem, e em que altura pegar.
 *
 * Azul da BUSCA, de propósito — não o verde neon pedido. A rota só existe porque uma
 * busca produziu a lista; usar a mesma cor diz "é o mesmo assunto" em vez de somar uma
 * sétima cor a uma cena que já carrega seis significados. O brilho/neon também fica de
 * fora: a Design Constitution trata glow como defeito, e aqui ele não acrescenta
 * informação nenhuma — a direção quem dá é o tracejado em movimento.
 *
 * O tracejado anda no sentido da coleta. É o que transforma uma linha numa INSTRUÇÃO:
 * sem movimento, a mesma linha pode ser lida nos dois sentidos.
 */
function RotaDeColeta({ rota }: { rota: RotaDesenhavel }) {
  const linhaRef = useRef<ElementRef<typeof Line>>(null);
  const reduzido = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useFrame(({ clock }) => {
    const linha = linhaRef.current;
    if (!linha || reduzido) return;
    // Negativo para o tracejado correr da primeira parada para a última, que é o
    // sentido em que se caminha. Mutação direta no material: nada aqui re-renderiza.
    linha.material.dashOffset = -clock.elapsedTime * 0.35;
  });

  return (
    <>
      {rota.caminho.length > 1 && (
        <Line
          ref={linhaRef}
          points={rota.caminho}
          color={COR_BUSCA}
          lineWidth={3}
          dashed
          dashSize={0.45}
          gapSize={0.3}
        />
      )}

      {/* Subidas até a altura da vaga. Contínuas, não tracejadas: não é caminho, é
          indicação de onde a mercadoria está. */}
      {rota.subidas.map(subida => (
        <Line
          key={`subida-${subida.id}`}
          points={[subida.de, subida.ate]}
          color={COR_BUSCA}
          lineWidth={1.5}
          transparent
          opacity={0.55}
        />
      ))}

      {rota.paradas.map(parada => (
        <Html key={parada.slot.id} position={parada.naVaga} center style={{ pointerEvents: 'none' }}>
          {/* `w-max max-w-none` pelo mesmo motivo das placas de rua: a guarda global
              `max-width: 100%` do index.css colapsaria o rótulo contra a âncora de
              largura zero do drei. A cor vem da constante da cena, como nas legendas —
              não existe par de token `accent`/`accent-fg` para inventar aqui. */}
          <div
            className="inline-block w-max max-w-none whitespace-nowrap rounded-full px-1.5 py-0.5 text-code text-[10px] font-semibold leading-none text-white shadow-panel"
            style={{ backgroundColor: COR_BUSCA }}
          >
            {parada.ordem}
          </div>
        </Html>
      ))}
    </>
  );
}

function Cena({
  solidas,
  divergentes,
  raioX,
  fiosAtivos,
  colunas,
  montantes,
  travessas,
  comCarga,
  placas,
  achadas,
  marcadores,
  rota,
  fundo,
  chaveDeSombra,
  realce,
  extensao,
  deslocamento,
  theme,
  onHover,
  onSelect,
}: {
  solidas: VagaDesenhavel[];
  divergentes: VagaDesenhavel[];
  raioX: VagaDesenhavel[];
  fiosAtivos: VagaDesenhavel[];
  colunas: { x: number; z: number; altura: number }[];
  montantes: PecaDaEstrutura[];
  travessas: PecaDaEstrutura[];
  /** Vagas com carga, dentro e fora do filtro: o palete existe nas duas. */
  comCarga: VagaDesenhavel[];
  placas: PlacaDeRua[];
  achadas: VagaDesenhavel[];
  marcadores: [number, number, number][];
  rota: RotaDesenhavel | null;
  fundo: FundoDaCena;
  chaveDeSombra: string;
  realce: VagaDesenhavel | null;
  extensao: number;
  deslocamento: [number, number, number];
  theme: Theme;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}) {
  const [centro, linha] = COR_GRADE[theme];
  const arestasDaCarga = useArestasFundidas(solidas, GEOMETRIA_ARESTAS_CAMADA, CAMADAS_NO_VAO);
  const arestasAchadas = useArestasFundidas(achadas);

  return (
    <>
      {/* Duas luzes. A ambiente sozinha achata todas as faces no mesmo tom e o cubo
          vira um hexágono chapado; a direcional é o que devolve a aresta entre topo e
          lateral — ou seja, o que faz ler como volume. */}
      {/* Dois cenários mutuamente exclusivos. O "limpo" é EXATAMENTE o que a tela
          sempre mostrou — mesmas luzes, mesma grade —, para que trocar o fundo nunca
          seja um caminho sem volta. O galpão traz as próprias luzes; somá-las às daqui
          estouraria a cena. */}
      {fundo === 'galpao' ? (
        <WarehouseEnvironment extensao={extensao} theme={theme} chaveDeSombra={chaveDeSombra} />
      ) : (
        <>
          <ambientLight intensity={theme === 'dark' ? 1.15 : 1.35} />
          <directionalLight position={[6, 12, 8]} intensity={theme === 'dark' ? 1.6 : 2.1} />

          {/* Piso. Sem referência de chão, orbitar desorienta: os cubos parecem flutuar
              no vazio e some a noção de qual rua está na frente. */}
          <gridHelper args={[extensao, Math.max(1, Math.round(extensao)), centro, linha]} position={[0, 0, 0]} />
        </>
      )}

      <group position={deslocamento}>
        {/* Montantes, quando o pulmão é suspenso. */}
        <Vigas colunas={colunas} />

        {/* Sinalização aérea do corredor. */}
        <PlacasDeRua placas={placas} />

        {/* Alerta de giro. Lista vazia fora do modo Curva ABC — e vazia também dentro
            dele quando não há item de alto giro em nível elevado, que é o resultado
            correto e não uma falha de carregamento. */}
        <MarcadoresDeGiro pontos={marcadores} />

        {/* Rota de coleta. Dentro deste grupo porque suas coordenadas vêm de
            `posicaoDaVaga`, as mesmas das vagas — fora dele, o traçado apareceria
            deslocado do armazém por metade da largura. */}
        {rota && <RotaDeColeta rota={rota} />}

        {/* A estante física. Vem antes da carga para o pallet ser desenhado dentro do
            vão que ela delimita. */}
        <EstruturaDeRack montantes={montantes} travessas={travessas} theme={theme} />

        {/* Paletes de madeira sob toda vaga com carga — inclusive as que estão fora do
            filtro: a estrutura não é filtrada, só o que ela guarda. */}
        <LoteInstanciado
          key={`paletes-${comCarga.length}`}
          vagas={comCarga}
          material={MATERIAL_PALETE}
          geometria={GEOMETRIA_PALETE}
          deslocamentoY={DESLOCA_PALETE}
          corUniforme
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Vagas com conteúdo: um único objeto de GPU para todas. */}
        <LoteInstanciado
          key={`solidas-${solidas.length}`}
          vagas={solidas}
          material={MATERIAL_SOLIDO}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Divisão entre as duas camadas de caixas do pallet, e o contorno externo. É o
            que faz o bloco ser lido como CAIXAS empilhadas em vez de um volume sólido. */}
        <lineSegments geometry={arestasDaCarga}>
          <lineBasicMaterial color={COR_DIVISAO_CAIXA[theme]} transparent opacity={0.55} />
        </lineSegments>

        {/* Divergências em lote próprio, para poderem pulsar sem arrastar o resto. */}
        <PulsoDeAlerta material={MATERIAL_ALERTA} ativo={divergentes.length > 0} />
        <LoteInstanciado
          key={`alerta-${divergentes.length}`}
          vagas={divergentes}
          material={MATERIAL_ALERTA}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Raio-X: vaga com carga que ficou FORA do filtro vira vidro em vez de sumir.
            É o que deixa ver a posição exata do alerta no meio da estante, sem perder a
            noção de onde ele está. O filtro isola, não amputa. */}
        <LoteInstanciado
          key={`raiox-${raioX.length}`}
          vagas={raioX}
          material={MATERIAL_RAIOX}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Apanhador de clique das vagas livres. A carga não existe aqui, e a estante é
            um objeto só — sem isto o raycast não saberia QUAL vão foi apontado. As
            instâncias cobrem o vão INTEIRO, não só a carga, para a vaga vazia continuar
            clicável. `opacity: 0` em vez de `visible={false}` porque o three não faz
            raycast em objeto invisível. */}
        <LoteInstanciado
          key={`fios-${fiosAtivos.length}`}
          vagas={fiosAtivos}
          material={MATERIAL_INVISIVEL}
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Contorno dos resultados da busca, por cima do vidro. É o que faz o produto
            procurado saltar mesmo quando está no fundo da estante. */}
        <lineSegments geometry={arestasAchadas} renderOrder={1}>
          <lineBasicMaterial color={COR_BUSCA} depthTest={false} />
        </lineSegments>

        {/* Realce da vaga sob o cursor. Um objeto só, desenhado por cima — contorno por
            instância não existe em InstancedMesh, e emitir um objeto extra apenas para
            o item apontado custa muito menos que abrir mão do lote. */}
        {realce && (
          <lineSegments position={realce.posicao} geometry={GEOMETRIA_ARESTAS} renderOrder={1}>
            <lineBasicMaterial color={COR_REALCE[theme]} depthTest={false} />
          </lineSegments>
        )}
      </group>
    </>
  );
}

// ── Proteção contra falha ──────────────────────────────────────────────────────
//
// WebGL falha de formas que um `try/catch` não alcança: driver bloqueado, contexto
// recusado, máquina sem GPU. Sem esta fronteira, qualquer uma dessas derruba a árvore
// React INTEIRA — ou seja, a tela do WMS junto. O armazém some; o resto fica de pé.
//
// Precisa ser classe: React só oferece `componentDidCatch` nessa forma.
interface FronteiraState {
  falhou: boolean;
}

class FronteiraDeErro extends Component<{ children: ReactNode; aoFalhar: ReactNode }, FronteiraState> {
  state: FronteiraState = { falhou: false };

  static getDerivedStateFromError(): FronteiraState {
    return { falhou: true };
  }

  render() {
    return this.state.falhou ? this.props.aoFalhar : this.props.children;
  }
}

// ── Painel de detalhe ──────────────────────────────────────────────────────────

/** Data curta para a grade. Formatada à mão, como no módulo de captura: o painel é
 *  lido no corredor e a data não pode mudar de formato conforme a locale da máquina. */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const doisDigitos = (n: number) => String(n).padStart(2, '0');
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ROTULO_STATUS: Record<SlotStatus, string> = {
  occupied: 'Ocupada',
  empty: 'Livre',
  divergence: 'Acima da capacidade',
  blocked: 'Bloqueada',
};

function PainelDetalhe({
  slot,
  abc,
  onFechar,
  onScanRequest,
  onOperate,
}: {
  slot: Slot;
  /** Classificação de giro desta vaga. `undefined` = nenhum SKU daqui está na análise. */
  abc?: AbcDaVaga;
  onFechar: () => void;
  onScanRequest?: (slot: Slot) => void;
  onOperate?: (slot: Slot) => void;
}) {
  // Hook em vez de prop: a especificação pede para NÃO mexer na interface do
  // componente, e o tema é exatamente o tipo de contexto que não deve virar prop só
  // para pintar um quadradinho.
  const { theme } = useTheme();
  const [conteudo, setConteudo] = useState<BinStockRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /** Curva por SKU, para marcar cada linha do conteúdo. A cor do cubo diz a classe que
   *  DOMINA a vaga; aqui é preciso dizer de qual produto ela veio, senão numa vaga
   *  misturada a pessoa desce o pallet errado. */
  const curvaPorSku = useMemo(
    () => new Map((abc?.itens ?? []).map(i => [i.sku, i.classe])),
    [abc],
  );

  const altoGiroElevado = abc?.classe === 'A' && slot.nivel > NIVEL_DE_PISO;

  /**
   * Blocos da grade técnica.
   *
   * Montados numa lista, e não escritos no JSX, porque QUASE TODOS são condicionais:
   * sem produto não há unidades nem data de entrada, sem análise publicada não há
   * curva. Célula com travessão ocupa o mesmo espaço de uma com dado e não diz nada.
   *
   * O que NÃO está aqui, e por quê: a especificação pedia `LOTE / VALIDADE` e
   * `ÚLTIMA AUDITORIA`. Conferido no banco — não existe coluna de lote, validade nem
   * carimbo de auditoria em `warehouse_bin_stock`, `warehouse_storage_bins`,
   * `warehouse_bin_movements` nem `products`. O controle de lote da 125 vive no fluxo
   * de NF-e (`lot_control_settings`, `nfe_putaway_assignments`), não no saldo do
   * pulmão. No lugar deles entra ENTRADA, que é real e é a data que manda na coleta:
   * `first_stored_at` é o critério FIFO que a busca já usa para ordenar.
   */
  const blocos = useMemo(() => {
    const lista: { rotulo: string; valor: ReactNode }[] = [
      {
        rotulo: 'Situação',
        valor: (
          <>
            {/* Mesmo quadradinho da legenda do mapa: o painel repete o código visual da
                cena em vez de inventar um segundo. */}
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={
                slot.status === 'empty'
                  ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                  : { backgroundColor: COR_VAGA[theme][slot.status] }
              }
            />
            <span className="truncate text-xs">{ROTULO_STATUS[slot.status]}</span>
          </>
        ),
      },
      {
        rotulo: 'Caixas',
        valor: (
          <span className="text-code">
            {/* Sem capacidade cadastrada mostra só a contagem. Exibir "18/—" sugeriria
                um limite que ninguém definiu. */}
            {slot.capacidade !== null ? `${slot.caixas}/${slot.capacidade}` : slot.caixas}
          </span>
        ),
      },
    ];

    const linhas = conteudo ?? [];
    if (linhas.length > 0) {
      const unidades = linhas.reduce((total, l) => total + l.units, 0);
      lista.push({ rotulo: 'Unidades', valor: <span className="text-code">{int(unidades)}</span> });

      const maisAntiga = linhas.reduce(
        (menor, l) => (l.firstStoredAt < menor ? l.firstStoredAt : menor),
        linhas[0].firstStoredAt,
      );
      lista.push({ rotulo: 'Entrada', valor: <span className="text-code">{dataCurta(maisAntiga)}</span> });
    }

    if (abc) {
      lista.push({
        rotulo: 'Curva de giro',
        valor: (
          <>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: ESCALA_ABC[theme][abc.classe] }}
            />
            <span className="text-code">{abc.classe}</span>
          </>
        ),
      });
    }

    // Endereço misturado é digno de nota: muda o que o operador vai encontrar lá.
    if (linhas.length > 1) {
      lista.push({ rotulo: 'SKUs na vaga', valor: <span className="text-code">{linhas.length}</span> });
    }

    return lista;
  }, [slot, conteudo, abc, theme]);

  useEffect(() => {
    let vivo = true;
    setConteudo(null);
    setErro(null);
    listBinContents(slot.id)
      .then(linhas => {
        if (vivo) setConteudo(linhas);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivo = false;
    };
  }, [slot.id]);

  return (
    <Panel className="pointer-events-auto absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[19rem] flex-col">
      {/* Cabeçalho: o endereço é o assunto, então ele é o maior elemento do painel. O
          fechar virou ícone — a palavra "Fechar" competia em peso com o código da vaga
          que a pessoa veio ler. */}
      <PanelSection padding="sm" className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-code truncate text-base font-semibold tracking-tight text-fg">{slot.id}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-fg-subtle">
            Rua {slot.ruaCodigo} · Mód <span className="text-code">{slot.modulo}</span> · Nív{' '}
            <span className="text-code">{slot.nivel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar detalhe da vaga"
          className="-mr-1 -mt-1 shrink-0 rounded-control p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </PanelSection>

      {/* Grade técnica. Substitui as linhas rótulo-à-esquerda/valor-à-direita: em duas
          colunas o olho varre os VALORES numa coluna só, que é como se lê terminal. Os
          blocos sem dado não entram — célula com travessão é ruído com aparência de
          informação. */}
      <PanelSection padding="sm">
        <dl className="grid grid-cols-2 gap-1.5">
          {blocos.map(bloco => (
            <div key={bloco.rotulo} className="rounded-control border border-edge bg-surface-2 px-2.5 py-2">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                {bloco.rotulo}
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm text-fg">{bloco.valor}</dd>
            </div>
          ))}
        </dl>
      </PanelSection>

      {/* O alerta é dito por extenso, não só pelo losango na cena. Filete à esquerda em
          vez de balão preenchido: o painel inteiro cabe em uma tela, e um bloco de cor
          sólida no meio dele rouba a atenção do conteúdo da vaga, que é o assunto.
          O vermelho é o MESMO do marcador 3D — antes este aviso saía âmbar enquanto o
          losango sobre a vaga era vermelho, dois tons para um alerta só. */}
      {altoGiroElevado && (
        <PanelSection padding="sm">
          <div className="flex gap-2.5 border-l-2 pl-2.5" style={{ borderColor: COR_ALERTA_GIRO }}>
            <ShieldAlert
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: COR_ALERTA_GIRO }}
            />
            <p className="text-xs leading-relaxed text-fg-muted">
              Alto giro no nível <span className="text-code text-fg">{slot.nivel}</span>. Cada
              retirada exige ciclo de elevação — descer para a face de piso reduz o tempo de
              separação.
            </p>
          </div>
        </PanelSection>
      )}

      <PanelSection padding="sm" className="min-h-0 flex-1 overflow-auto">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          <Package aria-hidden className="h-3 w-3 shrink-0" />
          Conteúdo
        </p>
        {erro !== null ? (
          <p className="text-xs leading-relaxed text-danger">Não foi possível ler o conteúdo desta vaga.</p>
        ) : conteudo === null ? (
          <p className="text-xs text-fg-muted">Lendo…</p>
        ) : conteudo.length === 0 ? (
          <p className="text-xs text-fg-muted">Nenhum produto armazenado aqui.</p>
        ) : (
          <ul className="space-y-2">
            {conteudo.map(linha => (
              <li key={linha.productId} className="border-t border-edge pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-code text-xs font-medium text-fg">{linha.sku}</p>
                  {/* Só quando há classe. "—" em todas as linhas de quem nunca publicou
                      análise seria uma coluna de nada ocupando a largura do painel.
                      Quadrado, não pílula: aqui ele é um MARCADOR de uma letra, e a
                      pílula o faria concorrer em peso com o SKU ao lado. */}
                  {curvaPorSku.get(linha.sku) && (
                    <span
                      className="text-code shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                      style={{ backgroundColor: ESCALA_ABC[theme][curvaPorSku.get(linha.sku)!] }}
                      title={`Curva de giro ${curvaPorSku.get(linha.sku)}`}
                    >
                      {curvaPorSku.get(linha.sku)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{linha.productName}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  <span className="text-code">{linha.boxes}</span> cx ·{' '}
                  <span className="text-code">{linha.units}</span> un
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {/* Os botões só existem quando há quem os atenda. Botão que não faz o que o
          rótulo diz é pior que botão nenhum: o operador confia nele. Em particular,
          "Ler QR Code" só aparece para quem de fato abre um leitor — ligá-lo a
          qualquer outra coisa seria um rótulo mentindo. */}
      {(onOperate || onScanRequest) && (
        <PanelSection padding="sm" className="space-y-2">
          {onOperate && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => onOperate(slot)}>
              Movimentar esta vaga
            </Button>
          )}
          {/* Ação principal do painel: é a leitura que confirma fisicamente o endereço.
              `primary` em vez de `secondary` — com os dois botões no mesmo peso, nada
              indicava por onde começar. */}
          {onScanRequest && (
            <Button variant="primary" size="sm" className="w-full" onClick={() => onScanRequest(slot)}>
              <ScanLine aria-hidden className="h-3.5 w-3.5 shrink-0" />
              Ler QR Code
            </Button>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}

// ── Ajuste da estrutura ────────────────────────────────────────────────────────

/** Campo numérico com unidade e limites do próprio domínio. */
function CampoMetros({
  rotulo,
  ajuda,
  valor,
  min,
  max,
  onMudar,
}: {
  rotulo: string;
  ajuda?: string;
  valor: number;
  min: number;
  max: number;
  onMudar: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{rotulo}</span>
      {ajuda && <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{ajuda}</span>}
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          step={0.1}
          min={min}
          max={max}
          value={valor}
          // Campo vazio vira NaN em `Number('')`, e um NaN no eixo Y faz a vaga sumir
          // da cena sem erro nenhum. O valor anterior fica até digitarem um número.
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onMudar(n);
          }}
          className="w-full"
        />
        <span className="text-xs text-fg-muted">m</span>
      </div>
    </label>
  );
}

/**
 * Ajuste da estrutura física do porta-pallets.
 *
 * Estas medidas NÃO vêm do banco: são propriedade do galpão, não do endereço. Ficam
 * no navegador de quem monta o mapa, e por isso o painel é uma preferência local, não
 * um cadastro — gravar isso como dado da empresa sem alguém decidir seria inventar
 * uma regra de negócio.
 *
 * O que NÃO está aqui, de propósito: número de níveis por rua. Quantos níveis uma rua
 * tem é consequência dos endereços cadastrados, não escolha de exibição. Um campo
 * para isso desenharia vagas que não existem ou esconderia vagas que existem.
 */
function AjusteDeEstrutura({
  aberto,
  onFechar,
  layout,
  ruas,
  onMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  layout: Layout3DConfig;
  ruas: string[];
  onMudar: (patch: Partial<Layout3DConfig>) => void;
}) {
  const [ruaEmFoco, setRuaEmFoco] = useState<string>('');

  if (!aberto) return null;

  const elevacaoDaRua = ruaEmFoco ? baseDaRua(ruaEmFoco, layout) : layout.baseOffsetY;

  return (
    <Modal open onClose={onFechar} title="Ajustar estrutura do porta-pallets">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-fg-muted">
          Medidas do galpão, em metros. Ficam salvas neste navegador e não alteram nenhum
          endereço cadastrado.
        </p>

        <CampoMetros
          rotulo="Elevação da base"
          ajuda="Altura do piso até a primeira prateleira. Use 0 para estrutura apoiada no chão; acima disso o mapa desenha os montantes de sustentação."
          valor={layout.baseOffsetY}
          min={LIMITES.baseOffsetY.min}
          max={LIMITES.baseOffsetY.max}
          onMudar={v => onMudar({ baseOffsetY: v })}
        />

        <CampoMetros
          rotulo="Altura por nível"
          ajuda="Distância entre andares, incluindo a longarina e a folga de entrada do garfo."
          valor={layout.levelHeight}
          min={LIMITES.levelHeight.min}
          max={LIMITES.levelHeight.max}
          onMudar={v => onMudar({ levelHeight: v })}
        />

        <CampoMetros
          rotulo="Passo entre módulos"
          ajuda="Distância de um módulo ao seguinte, ao longo da rua."
          valor={layout.moduleWidth}
          min={LIMITES.moduleWidth.min}
          max={LIMITES.moduleWidth.max}
          onMudar={v => onMudar({ moduleWidth: v })}
        />

        <CampoMetros
          rotulo="Distância entre ruas"
          ajuda="Inclui o corredor de manobra. Encolher aqui faz o desenho mentir sobre caber a empilhadeira."
          valor={layout.rowSpacing}
          min={LIMITES.rowSpacing.min}
          max={LIMITES.rowSpacing.max}
          onMudar={v => onMudar({ rowSpacing: v })}
        />

        {ruas.length > 1 && (
          <div className="border-t border-edge pt-4">
            <p className="text-xs font-medium text-fg">Elevação de uma rua específica</p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
              Para quando só parte do pulmão é suspensa. Sem ajuste próprio, a rua segue a
              elevação geral acima.
            </p>
            <Select
              value={ruaEmFoco}
              onChange={e => setRuaEmFoco(e.target.value)}
              className="mt-2 w-full"
            >
              <option value="">Escolha a rua…</option>
              {ruas.map(r => (
                <option key={r} value={r}>
                  Rua {r}
                  {layout.baseByStreet[r] !== undefined ? ` · ${layout.baseByStreet[r]} m` : ''}
                </option>
              ))}
            </Select>

            {ruaEmFoco && (
              <div className="mt-3 space-y-2">
                <CampoMetros
                  rotulo={`Elevação da rua ${ruaEmFoco}`}
                  valor={elevacaoDaRua}
                  min={LIMITES.baseOffsetY.min}
                  max={LIMITES.baseOffsetY.max}
                  onMudar={v => onMudar({ baseByStreet: { ...layout.baseByStreet, [ruaEmFoco]: v } })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const resto = { ...layout.baseByStreet };
                    delete resto[ruaEmFoco];
                    onMudar({ baseByStreet: resto });
                  }}
                >
                  Voltar ao padrão geral
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-edge pt-4">
          <Button variant="ghost" size="sm" onClick={() => onMudar({ ...LAYOUT_PADRAO })}>
            Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={onFechar}>
            Concluir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────────

// ── Radar (planta baixa) ───────────────────────────────────────────────────────

/**
 * Vista de cima do armazém, com onde a câmera está e para onde ela olha.
 *
 * Orbitar em 3D desorienta: três arrastes e já não se sabe qual corredor está na
 * frente. O radar devolve a referência que a vista em perspectiva tira — é o mesmo
 * papel do "você está aqui" de um mapa de shopping.
 *
 * O cone e o marcador são movidos por `setAttribute`, de fora do React. Este componente
 * só re-renderiza quando o ARMAZÉM muda (filtro, layout, alerta), nunca quando a câmera
 * se move — e a câmera se move em todo quadro.
 */
function Radar({
  celulas,
  area,
  theme,
  aberto,
  onAlternar,
  onIrPara,
  grupoRef,
  coneRef,
}: {
  celulas: CelulaRadar[];
  area: AreaRadar;
  theme: Theme;
  aberto: boolean;
  onAlternar: () => void;
  onIrPara: (x: number, z: number) => void;
  grupoRef: RefObject<SVGGElement>;
  coneRef: RefObject<SVGPathElement>;
}) {
  // Uma linha por rua, do primeiro ao último módulo: é o corredor, e é o que dá ao
  // radar a forma de planta em vez de nuvem de pontos soltos.
  const corredores = useMemo(() => {
    const porRua = new Map<number, { x: number; z1: number; z2: number; rotulo: string }>();
    for (const c of celulas) {
      const atual = porRua.get(c.rua);
      if (atual) {
        atual.z1 = Math.min(atual.z1, c.z);
        atual.z2 = Math.max(atual.z2, c.z);
      } else {
        porRua.set(c.rua, { x: c.x, z1: c.z, z2: c.z, rotulo: c.ruaCodigo });
      }
    }
    return [...porRua.values()];
  }, [celulas]);

  const alcanceDoCone = Math.max(area.largura, area.profundidade) * 0.55;
  const [grade, linha] = COR_GRADE[theme];

  const aoClicar = (evento: ReactMouseEvent<SVGSVGElement>) => {
    // A matriz do próprio SVG faz a inversão. Calcular na mão a partir do
    // `getBoundingClientRect` erraria sempre que o `preserveAspectRatio` sobrasse
    // margem — e ele sobra, porque o armazém quase nunca tem a proporção do quadro.
    const svg = evento.currentTarget;
    const matriz = svg.getScreenCTM();
    if (!matriz) return;
    const ponto = svg.createSVGPoint();
    ponto.x = evento.clientX;
    ponto.y = evento.clientY;
    const local = ponto.matrixTransform(matriz.inverse());
    onIrPara(local.x, local.y);
  };

  return (
    <Panel className="pointer-events-auto absolute bottom-3 right-3 w-[12rem]">
      <PanelSection padding="sm" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          {/* `aria-hidden`: o ícone repete o rótulo ao lado, e um leitor de tela que
              anuncia "bússola Radar" só atrapalha. */}
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <Compass aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
            Radar
          </span>
          <Button variant="ghost" size="sm" onClick={onAlternar} aria-expanded={aberto}>
            {aberto ? 'Recolher' : 'Expandir'}
          </Button>
        </div>

        {aberto && (
          <>
            <svg
              viewBox={`${area.minX} ${area.minZ} ${area.largura} ${area.profundidade}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-28 w-full cursor-pointer rounded-control bg-surface-2"
              onClick={aoClicar}
              role="img"
              aria-label={`Planta do armazém com ${celulas.length} posições vistas de cima. Clique para levar a câmera.`}
            >
              {/* Corredores. `non-scaling-stroke` mantém a espessura em PIXELS: sem
                  isso a linha engrossaria junto com o zoom do viewBox e um armazém
                  pequeno viraria um borrão de traços. */}
              {corredores.map(c => (
                <line
                  key={c.rotulo}
                  x1={c.x}
                  y1={c.z1}
                  x2={c.x}
                  y2={c.z2}
                  stroke={linha}
                  strokeWidth={6}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

              {celulas.map(c => (
                <circle
                  key={`${c.rua}-${c.modulo}`}
                  cx={c.x}
                  cy={c.z}
                  r={Math.max(area.largura, area.profundidade) * 0.012}
                  fill={
                    // A MESMA linguagem de cor da cena 3D. O radar é um mapa do que está
                    // ali do lado; ensinar duas cores para o mesmo alerta faria o
                    // operador reaprender o significado ao mudar de instrumento.
                    c.altoGiro ? COR_ALERTA_GIRO : c.divergencia ? COR_VAGA[theme].divergence : grade
                  }
                />
              ))}

              {/* Câmera: cone de visão e vértice. Movido por fora do React. */}
              <g ref={grupoRef}>
                <path ref={coneRef} d={caminhoDoCone(0.6, alcanceDoCone)} fill={COR_REALCE[theme]} opacity={0.22} />
                <circle cx={0} cy={0} r={Math.max(area.largura, area.profundidade) * 0.018} fill={COR_REALCE[theme]} />
              </g>
            </svg>

            <p className="text-xs leading-relaxed text-fg-subtle">
              Clique na planta para levar a câmera até o ponto.
            </p>
          </>
        )}
      </PanelSection>
    </Panel>
  );
}

interface Warehouse3DViewerProps {
  /**
   * Vagas a desenhar. Omitido, o componente busca os endereços reais do Pulmão.
   * Passar explicitamente serve para teste e para telas que já carregaram os dados.
   */
  slots?: readonly Slot[];
  /**
   * Empresa cuja Curva ABC publicada colore o modo "Curva ABC".
   *
   * Prop, e não `useAuth()` aqui dentro: o componente é renderizável isolado — é para
   * isso que `slots` existe —, e chamar o contexto de autenticação passaria a exigir o
   * `AuthProvider` para desenhar um cubo. Omitido, o modo Curva ABC avisa que não há
   * classificação em vez de sumir.
   */
  companyId?: string;
  /** Chamado ao clicar numa vaga, além de abrir o painel de detalhe interno. */
  onSelectSlot?: (slot: Slot) => void;
  /** Omitido, o botão de leitura de QR Code não aparece. */
  onScanRequest?: (slot: Slot) => void;
  /** Omitido, o botão de movimentação não aparece. */
  onOperate?: (slot: Slot) => void;
  className?: string;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; dados: WarehouseSlots };

// `hud-3d` é o escopo da JetBrains Mono: a regra no index.css só alcança o que está
// dentro desta moldura, então a tipografia técnica do resto do produto fica intocada.
const MOLDURA = 'hud-3d relative h-full min-h-[24rem] w-full overflow-hidden rounded-container bg-surface-2';
const TODAS_AS_RUAS = '';

export function Warehouse3DViewer({
  slots: slotsExternos,
  companyId,
  onSelectSlot,
  onScanRequest,
  onOperate,
  className = '',
}: Warehouse3DViewerProps) {
  const { theme } = useTheme();
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [estado, setEstado] = useState<Estado>(() =>
    slotsExternos ? { fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } } : { fase: 'carregando' },
  );

  const [modo, setModo] = useState<ModoCor>('status');
  const [filtro, setFiltro] = useState<FiltroStatus>('todas');
  const [rua, setRua] = useState<string>(TODAS_AS_RUAS);
  // Lido do localStorage uma vez, na montagem. É preferência de quem monta o mapa, não
  // dado do armazém — o banco não guarda a altura da estrutura.
  const [layout, setLayout] = useState<Layout3DConfig>(carregarLayout);
  const [ajustando, setAjustando] = useState(false);
  const [busca, setBusca] = useState('');
  /** Códigos de vaga que contêm o termo. `null` = nenhuma busca em curso. */
  const [achados, setAchados] = useState<Set<string> | null>(null);
  /** Os mesmos endereços de `achados`, na ordem FIFO que o banco devolveu. */
  const [ordemFifo, setOrdemFifo] = useState<string[]>([]);
  const [rotaAberta, setRotaAberta] = useState(true);
  const [paradaAtual, setParadaAtual] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [apontada, setApontada] = useState<Slot | null>(null);
  const [selecionada, setSelecionada] = useState<Slot | null>(null);
  /** Classificação de giro por endereço. Carregada UMA vez, separada das vagas: o mapa
   *  abre e já desenha no modo Status enquanto isto ainda vem. */
  const [abc, setAbc] = useState<AbcDoArmazem>(ABC_VAZIO);
  const [abcFalhou, setAbcFalhou] = useState(false);
  const [radarAberto, setRadarAberto] = useState(true);
  const [fundo, setFundo] = useState<FundoDaCena>('galpao');
  /** Preenchida pelo `CapturadorDeCena` assim que o Canvas monta. */
  const capturarRef = useRef<(() => string) | null>(null);
  /** Vagas mexidas por outro operador nos últimos segundos. */
  const [pulsando, setPulsando] = useState<ReadonlySet<string>>(() => new Set());
  const relogiosDoPulso = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Mapa UUID -> código sempre atual, sem refazer a inscrição a cada recarga. */
  const codigoPorBinIdRef = useRef<ReadonlyMap<string, string>>(new Map());
  const recargaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nós do radar movidos por fora do React, a cada quadro. Ver `SondaDeCamera`.
  const radarGrupoRef = useRef<SVGGElement>(null);
  const radarConeRef = useRef<SVGPathElement>(null);
  /** Destino da transição suave. Ref, não estado: muda a cada quadro durante o pan. */
  const destinoRef = useRef<DestinoDeCamera | null>(null);

  useEffect(() => {
    if (!companyId) {
      setAbc(ABC_VAZIO);
      return;
    }
    let vivo = true;
    setAbcFalhou(false);
    loadAbcDoArmazem(companyId)
      .then(dados => {
        if (vivo) setAbc(dados);
      })
      .catch(() => {
        // Falhar aqui NÃO derruba o mapa: a curva é uma camada a mais sobre um mapa que
        // já é útil sem ela. Mas o modo Curva ABC não pode fingir que está colorindo o
        // armazém inteiro de cinza por não haver classificação — isso é dito na tela.
        if (vivo) {
          setAbc(ABC_VAZIO);
          setAbcFalhou(true);
        }
      });
    return () => {
      vivo = false;
    };
  }, [companyId]);

  const buscar = useCallback(() => {
    let vivo = true;
    setEstado({ fase: 'carregando' });
    loadWarehouseSlots()
      .then(dados => {
        if (vivo) setEstado({ fase: 'pronto', dados });
      })
      .catch((erro: unknown) => {
        // A mensagem do Supabase é mostrada como está: inventar um texto genérico
        // ("algo deu errado") esconde justamente o que distingue rede caída de
        // permissão negada, que é o que decide o que fazer em seguida.
        if (vivo) setEstado({ fase: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) });
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (slotsExternos) {
      setEstado({ fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } });
      return;
    }
    return buscar();
  }, [slotsExternos, buscar]);

  /**
   * Busca o termo no saldo e guarda os endereços que o contêm.
   *
   * Usa `searchStock`, que já roda em produção na seção "Consultar SKU" e casa por SKU
   * ou nome do produto. Nenhuma query nova, nenhuma fonte nova de verdade.
   *
   * O atraso de 300 ms existe porque cada tecla dispararia uma ida ao banco: digitar
   * "GCGCM116" seriam oito consultas, sete delas descartadas. `cancelado` descarta a
   * resposta de um termo que já não é o atual — sem isso, uma resposta lenta de um
   * termo antigo sobrescreveria a do termo novo.
   */
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setAchados(null);
      setOrdemFifo([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      searchStock(termo)
        .then(linhas => {
          if (!cancelado) {
            setAchados(new Set(linhas.map(l => l.binCode)));
            // A ORDEM das linhas é informação, e o Set a joga fora. `searchStock`
            // devolve do saldo mais antigo para o mais novo — é a ordem em que o
            // estoque deve ser consumido, e é ela que vira a rota de coleta.
            setOrdemFifo(linhas.map(l => l.binCode));
            setParadaAtual(0);
            setBuscando(false);
          }
        })
        .catch(() => {
          // Busca que falha não derruba o mapa: volta a mostrar tudo, sem alarde.
          if (!cancelado) {
            setAchados(null);
            setOrdemFifo([]);
            setBuscando(false);
          }
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const vagas = useMemo(() => dados?.slots ?? [], [dados]);

  // ── Tempo real ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (dados) codigoPorBinIdRef.current = dados.codigoPorBinId;
  }, [dados]);

  /** Recarga SEM passar por "carregando": o loader apagaria a cena inteira a cada
   *  movimentação alheia, e quem está olhando o mapa perderia o próprio enquadramento
   *  várias vezes por minuto num galpão em operação. */
  const recarregarSilencioso = useCallback(() => {
    loadWarehouseSlots()
      .then(novos => {
        // Só atualiza se a tela JÁ estava pronta. Sobrescrever um estado de erro ou de
        // carga em curso faria duas fontes disputarem a mesma tela.
        setEstado(atual => (atual.fase === 'pronto' ? { fase: 'pronto', dados: novos } : atual));
      })
      .catch(() => {
        // Falha de recarga em segundo plano não derruba o que está na tela: o mapa
        // continua mostrando o último estado bom, que é melhor que um erro no lugar de
        // um armazém.
      });
  }, []);

  /** Uma rajada de movimentações vira UMA recarga. Sem isto, descarregar um pallet de
   *  vinte caixas dispararia vinte consultas ao banco em sequência. */
  const agendarRecarga = useCallback(() => {
    if (recargaRef.current) clearTimeout(recargaRef.current);
    recargaRef.current = setTimeout(() => {
      recargaRef.current = null;
      recarregarSilencioso();
    }, 400);
  }, [recarregarSilencioso]);

  const destacarVaga = useCallback((codigo: string) => {
    setPulsando(anterior => new Set(anterior).add(codigo));
    const relogios = relogiosDoPulso.current;
    // Mexer de novo na mesma vaga reinicia a contagem em vez de somar um segundo
    // temporizador — dois relógios para a mesma vaga apagariam o destaque cedo demais.
    const anterior = relogios.get(codigo);
    if (anterior) clearTimeout(anterior);
    relogios.set(
      codigo,
      setTimeout(() => {
        relogios.delete(codigo);
        setPulsando(atual => {
          const proximo = new Set(atual);
          proximo.delete(codigo);
          return proximo;
        });
      }, DURACAO_PULSO),
    );
  }, []);

  useEffect(() => {
    // Sem empresa, ou com vagas vindas por prop (uso isolado/teste), não há canal a
    // abrir: assinar ali seria socket aberto para dado que ninguém vai usar.
    if (!companyId || slotsExternos) return;
    const assinatura = assinarMudancasDoPulmao(
      companyId,
      () => codigoPorBinIdRef.current,
      codigo => {
        // Sem código conhecido ainda assim recarrega: pode ser vaga criada por outro
        // operador, que precisa APARECER mesmo sem ter o que destacar.
        if (codigo) destacarVaga(codigo);
        agendarRecarga();
      },
    );
    return () => assinatura.cancelar();
  }, [companyId, slotsExternos, destacarVaga, agendarRecarga]);

  // Desmontagem: nenhum temporizador sobrevive à tela que os criou.
  useEffect(() => {
    const relogios = relogiosDoPulso.current;
    return () => {
      relogios.forEach(clearTimeout);
      relogios.clear();
      if (recargaRef.current) clearTimeout(recargaRef.current);
    };
  }, []);

  const contagem = useMemo(() => {
    const base: Record<SlotStatus, number> = { empty: 0, occupied: 0, divergence: 0, blocked: 0 };
    for (const s of vagas) base[s.status] += 1;
    return base;
  }, [vagas]);

  const ruas = useMemo(() => [...new Set(vagas.map(s => s.ruaCodigo))].sort(), [vagas]);

  /** Quantas vagas cada curva colore. Vaga vazia não entra: ela não guarda SKU nenhum,
   *  então não tem giro — entrar como "sem classificação" inflaria esse número com o
   *  armazém vazio e esconderia o que de fato falta classificar. */
  const contagemAbc = useMemo(() => {
    const porClasse: Record<AbcClasse, number> = { A: 0, B: 0, C: 0 };
    let semCurva = 0;
    for (const s of vagas) {
      if (s.status === 'empty') continue;
      const classe = abc.porVaga.get(s.id)?.classe;
      if (classe) porClasse[classe] += 1;
      else semCurva += 1;
    }
    return { porClasse, semCurva };
  }, [vagas, abc]);

  /** Vagas de alto giro fora da face de piso. Calculado FORA do modo de cor: o atalho
   *  precisa aparecer mesmo para quem está olhando o mapa por Status, senão só descobre
   *  o problema quem já foi procurar. */
  const alertasGiro = useMemo(() => alertasDeGiro(vagas, abc.porVaga), [vagas, abc]);

  // Posição e cor de cada vaga, calculadas uma vez por mudança real de entrada. Sem
  // isto, cada movimento do mouse (que muda `apontada`) recalcularia a cena inteira.
  const {
    solidas, divergentes, raioX, fiosAtivos, fiosAtenuados,
    colunas, comCarga, placas, achadas, marcadores, extensao, deslocamento,
  } = useMemo(() => {
    const maxCaixas = vagas.reduce((m, s) => Math.max(m, s.caixas), 0);
    const atenuada = COR_ATENUADA[theme];

    const desenhaveis: VagaDesenhavel[] = vagas.map(slot => {
      const achada = achados !== null && achados.has(slot.id);
      const ativa =
        (rua === TODAS_AS_RUAS || slot.ruaCodigo === rua) &&
        (filtro === 'todas' || slot.status === filtro) &&
        // Busca em curso restringe junto com os demais filtros, em vez de substituí-los.
        (achados === null || achada);
      return {
        slot,
        posicao: posicaoDaVaga(slot, layout),
        // O azul da busca vence a cor de status: achado o produto, a pergunta na tela
        // passou a ser "onde está", não "como está".
        // O pulso vence tudo: é a informação mais NOVA da tela. Durante dois segundos
        // a pergunta deixa de ser "como está esta vaga" e passa a ser "alguém acabou
        // de mexer aqui".
        cor: pulsando.has(slot.id)
          ? COR_PULSO
          : achada
            ? COR_BUSCA
            : ativa
              ? corDaVaga(slot, modo, theme, maxCaixas, abc.porVaga)
              : atenuada,
        ativa,
      };
    });

    // Só no modo Curva ABC: fora dele a cor não está falando de giro, e um losango
    // vermelho pairando sobre o mapa de Status não teria como ser interpretado.
    const marcadores: [number, number, number][] =
      modo === 'abc'
        ? alertasGiro.map(slot => {
            const [x, y, z] = posicaoDaVaga(slot, layout);
            return [x, y + VAGA.altura / 2 + 0.45, z];
          })
        : [];

    const vazio = {
      solidas: [], divergentes: [], raioX: [], fiosAtivos: [], fiosAtenuados: [],
      colunas: [], comCarga: [], placas: [], achadas: [], marcadores: [],
      extensao: 10, deslocamento: [0, 0, 0] as [number, number, number],
    };
    if (vagas.length === 0) return vazio;

    const maxRua = Math.max(...vagas.map(s => s.rua));
    const maxModulo = Math.max(...vagas.map(s => s.modulo));
    const larguraTotal = (maxRua - 1) * layout.rowSpacing;
    const profundidadeTotal = (maxModulo - 1) * layout.moduleWidth;

    // Montantes só onde a estrutura está elevada. Um por extremidade de rua e um a
    // cada 4 módulos: o suficiente para ler "isto está suspenso" sem virar floresta.
    const colunas: { x: number; z: number; altura: number }[] = [];
    const placas: PlacaDeRua[] = [];
    for (const letra of new Set(vagas.map(s => s.ruaCodigo))) {
      const daRua = vagas.filter(s => s.ruaCodigo === letra);
      const base = baseDaRua(letra, layout);
      const x = (daRua[0].rua - 1) * layout.rowSpacing;
      const modulos = [...new Set(daRua.map(s => s.modulo))].sort((a, b) => a - b);

      if (base > 0) {
        const escolhidos = modulos.filter((m, i) => i === 0 || i === modulos.length - 1 || m % 4 === 0);
        for (const m of escolhidos) colunas.push({ x, z: (m - 1) * layout.moduleWidth, altura: base });
      }

      // Placa um metro ACIMA do último nível daquela rua, nas duas pontas do corredor.
      // A altura é por rua, não global: com uma rua suspensa e outra no chão, uma placa
      // na média ficaria enterrada numa e perdida no alto da outra.
      const maxNivel = Math.max(...daRua.map(s => s.nivel));
      const y = base + maxNivel * layout.levelHeight + 1;
      const pontas = modulos.length > 1 ? [modulos[0], modulos[modulos.length - 1]] : [modulos[0]];
      for (const m of pontas) placas.push({ rotulo: letra, x, y, z: (m - 1) * layout.moduleWidth });
    }

    return {
      solidas: desenhaveis.filter(v => v.ativa && v.slot.status !== 'empty' && v.slot.status !== 'divergence'),
      divergentes: desenhaveis.filter(v => v.ativa && v.slot.status === 'divergence'),
      // Fora do filtro, mas com carga: vidro, para dar a profundidade do raio-X.
      raioX: desenhaveis.filter(v => !v.ativa && v.slot.status !== 'empty'),
      fiosAtivos: desenhaveis.filter(v => v.ativa && v.slot.status === 'empty'),
      fiosAtenuados: desenhaveis.filter(v => !v.ativa && v.slot.status === 'empty'),
      // Contorno dos achados: inclui a vaga VAZIA que casou com a busca, que de outro
      // modo seria só um fio cinza e sumiria no meio dos outros fios.
      achadas: achados === null ? [] : desenhaveis.filter(v => achados.has(v.slot.id)),
      colunas,
      // Toda vaga com carga ganha palete, dentro ou fora do filtro: o filtro esconde o
      // destaque da mercadoria, não faz o estrado sumir de baixo dela.
      comCarga: desenhaveis.filter(v => v.slot.status !== 'empty'),
      placas,
      marcadores,
      extensao: Math.max(larguraTotal, profundidadeTotal) + 4,
      // Centraliza na origem para o OrbitControls orbitar o armazém, não um canto dele.
      deslocamento: [-larguraTotal / 2, 0, -profundidadeTotal / 2] as [number, number, number],
    };
  }, [vagas, modo, theme, rua, filtro, layout, achados, abc, alertasGiro, pulsando]);

  const todasDesenhaveis = useMemo(
    () => [...solidas, ...divergentes, ...raioX, ...fiosAtivos, ...fiosAtenuados],
    [solidas, divergentes, raioX, fiosAtivos, fiosAtenuados],
  );

  const realce = useMemo(() => {
    const alvo = apontada ?? selecionada;
    if (!alvo) return null;
    return todasDesenhaveis.find(v => v.slot.id === alvo.id) ?? null;
  }, [apontada, selecionada, todasDesenhaveis]);

  // Planta baixa. Depende do alerta de giro porque o radar marca as duas famílias de
  // problema — capacidade e giro mal posicionado —, com as cores da própria cena.
  const celulasRadar = useMemo(
    () => celulasDoRadar(vagas, layout, new Set(alertasGiro.map(s => s.id))),
    [vagas, layout, alertasGiro],
  );
  const areaRadar = useMemo(() => areaDoRadar(celulasRadar), [celulasRadar]);

  // A estante NÃO depende de filtro, modo de cor nem busca: ela é física e está sempre
  // lá. Memos próprios para não refazer a geometria da estrutura a cada troca de modo.
  const montantes = useMemo(() => montantesDoArmazem(vagas, layout), [vagas, layout]);
  const travessas = useMemo(() => vigasDoArmazem(vagas, layout), [vagas, layout]);

  /** Escreve a posição e a abertura da câmera direto nos nós do SVG. Chamado por
   *  quadro: nada aqui pode disparar render. */
  const atualizarRadar = useCallback(
    (x: number, z: number, graus: number, meiaAbertura: number) => {
      const grupo = radarGrupoRef.current;
      if (!grupo) return;
      const [localX, localZ] = mundoParaLocal(x, z, deslocamento);
      const [presoX, presoZ] = prenderNaArea(localX, localZ, areaRadar);
      grupo.setAttribute(
        'transform',
        `translate(${presoX.toFixed(3)} ${presoZ.toFixed(3)}) rotate(${graus.toFixed(2)})`,
      );
      const cone = radarConeRef.current;
      if (cone) {
        const alcance = Math.max(areaRadar.largura, areaRadar.profundidade) * 0.55;
        cone.setAttribute('d', caminhoDoCone(meiaAbertura, alcance));
      }
    },
    [deslocamento, areaRadar],
  );

  /**
   * Clique no radar: PAN puro, preservando ângulo e distância.
   *
   * Move só o ponto para onde se olha. Recalcular a posição da câmera do zero giraria a
   * cena junto, e quem clicou no radar justamente para não se perder acabaria mais
   * perdido do que antes.
   */
  const irParaNoRadar = useCallback(
    (localX: number, localZ: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const [mundoX, mundoZ] = localParaMundo(localX, localZ, deslocamento);
      const alvo = new Vector3(mundoX, controls.target.y, mundoZ);
      const afastamento = controls.object.position.clone().sub(controls.target);
      destinoRef.current = { alvo, posicao: alvo.clone().add(afastamento) };
    },
    [deslocamento],
  );

  /**
   * Rota de coleta sobre o resultado da busca.
   *
   * A lista de paradas é o que a busca achou, na ordem FIFO. NÃO há pedido de
   * separação no banco — não existe tabela de ordem, nem doca, nem área de picking
   * (as 71 vagas são todas pulmão). A busca é a única lista de coleta real que este
   * sistema sabe produzir hoje.
   *
   * Com uma parada só não há rota: há um destino, e para isso a busca já oferece o
   * "Ir até".
   */
  const rota = useMemo<RotaDesenhavel | null>(() => {
    if (ordemFifo.length < 2) return null;
    const paradas = paradasDaRota(ordemFifo, vagas, layout);
    if (paradas.length < 2) return null;
    return { paradas, caminho: caminhoNoPiso(paradas, layout), subidas: subidasAteAVaga(paradas) };
  }, [ordemFifo, vagas, layout]);

  /** Muda quando o conjunto desenhado muda — é o gatilho para refazer a sombra. */
  const chaveDeSombra = `${solidas.length}-${divergentes.length}-${fiosAtivos.length}-${raioX.length}-${extensao.toFixed(1)}`;

  const registrarCapturador = useCallback((fn: (() => string) | null) => {
    capturarRef.current = fn;
  }, []);

  /**
   * Baixa a vista atual como PNG, com uma tarja de data, hora e ângulo.
   *
   * A tarja é acrescentada ABAIXO do desenho, num canvas 2D à parte — escrever por
   * cima cobriria justamente a parte do armazém que alguém quis registrar.
   *
   * O que a imagem NÃO traz: as placas de rua e os números das paradas. São elementos
   * HTML sobrepostos ao Canvas, não pixels do WebGL, e nenhum `toDataURL` os alcança.
   */
  const capturarCena = useCallback(() => {
    const capturar = capturarRef.current;
    const controls = controlsRef.current;
    if (!capturar || !controls) return;

    const desenho = new Image();
    desenho.onload = () => {
      const folha = document.createElement('canvas');
      folha.width = desenho.width;
      folha.height = desenho.height + ALTURA_DA_TARJA;
      const ctx = folha.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(desenho, 0, 0);

      const quando = new Date();
      const { x, y, z } = controls.object.position;
      const alvo = controls.target;
      const angulo = anguloDaCamera([x, y, z], [alvo.x, alvo.y, alvo.z]);
      desenharLegenda(ctx, desenho.width, desenho.height, legendaDaAuditoria(quando, angulo));

      const link = document.createElement('a');
      link.download = nomeDoArquivo(quando);
      link.href = folha.toDataURL('image/png');
      link.click();
    };
    desenho.src = capturar();
  }, []);

  const posicaoCamera = useMemo(() => enquadrarCamera(vagas, layout), [vagas, layout]);
  const distancia = Math.hypot(...posicaoCamera);

  // A MESMA conta do enquadramento inicial: se o reset usasse um valor próprio, o
  // botão devolveria uma vista que a tela nunca mostrou ao abrir.
  const resetarCamera = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...posicaoCamera);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  /**
   * Leva a câmera até a primeira vaga com alerta.
   *
   * A posição vem do mesmo `deslocamento` que a cena aplica ao grupo, senão a câmera
   * miraria o endereço absoluto e o armazém apareceria deslocado no quadro.
   *
   * O recuo é proporcional ao tamanho da vaga, não um número fixo: com o pulmão
   * suspenso ou com módulos mais largos, uma distância fixa colaria a câmera na vaga.
   */
  const focarVaga = (alvo: VagaDesenhavel | undefined) => {
    const controls = controlsRef.current;
    if (!controls || !alvo) return;
    const [x, y, z] = alvo.posicao;
    const alvoX = x + deslocamento[0];
    const alvoZ = z + deslocamento[2];
    const recuo = Math.max(layout.rowSpacing, layout.moduleWidth) * 2.2;
    controls.target.set(alvoX, y, alvoZ);
    controls.object.position.set(alvoX + recuo, y + recuo * 0.6, alvoZ + recuo);
    controls.update();
  };

  /**
   * Voo suave até uma parada da rota.
   *
   * Mesmo enquadramento do "Ir até" (`focarVaga`), mas animado pelo `PanSuave` em vez
   * de instantâneo. Percorrer a rota é uma sequência: saltar de corte em corte faria
   * perder a relação entre uma parada e a seguinte, que é o que a rota existe para
   * mostrar. O "Ir até" continua instantâneo — ali o salto é o comportamento atual e
   * não há sequência a preservar.
   */
  const voarAteParada = useCallback(
    (parada: ParadaDaRota) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const [x, y, z] = parada.naVaga;
      const alvo = new Vector3(x + deslocamento[0], y, z + deslocamento[2]);
      const recuo = Math.max(layout.rowSpacing, layout.moduleWidth) * 2.2;
      destinoRef.current = {
        alvo,
        posicao: new Vector3(alvo.x + recuo, y + recuo * 0.6, alvo.z + recuo),
      };
    },
    [deslocamento, layout],
  );

  const trocarLayout = (patch: Partial<Layout3DConfig>) => {
    setLayout(anterior => {
      const proximo = { ...anterior, ...patch };
      salvarLayout(proximo);
      return proximo;
    });
  };

  const selecionar = useCallback(
    (slot: Slot) => {
      setSelecionada(slot);
      onSelectSlot?.(slot);
    },
    [onSelectSlot],
  );

  if (estado.fase === 'carregando') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center ${className}`}>
        <BrandLoader label="Lendo os endereços do Pulmão" />
      </div>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md space-y-3">
          <Notice tone="danger">
            Não foi possível carregar os endereços do Pulmão. Nada foi alterado no armazém — é só a
            leitura que falhou.
            <span className="mt-2 block text-code text-xs text-fg-muted">{estado.mensagem}</span>
          </Notice>
          <Button variant="secondary" size="sm" onClick={buscar}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (vagas.length === 0) {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md">
          <Notice tone="neutral">
            {estado.dados.naoPosicionaveis.length > 0
              ? `Nenhum endereço com posição no espaço. As ${estado.dados.naoPosicionaveis.length} vagas cadastradas não seguem o padrão de código (ex.: PP-A01-N1), então não há como situá-las no mapa 3D.`
              : 'Nenhum endereço cadastrado no Pulmão ainda. Assim que as vagas forem criadas, elas aparecem aqui.'}
          </Notice>
        </div>
      </div>
    );
  }

  const emDestaque = solidas.length + divergentes.length + fiosAtivos.length;

  return (
    // `relative` ancora os overlays; `overflow-hidden` impede que o canvas vaze no
    // instante em que o pai redimensiona. A altura vem do pai — o `min-h` é só a rede
    // de segurança para um pai sem altura definida, onde o canvas colapsaria em 0.
    <div className={`${MOLDURA} ${apontada ? 'cursor-pointer' : ''} ${className}`}>
      <FronteiraDeErro
        aoFalhar={
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Notice tone="warning">
                A visualização 3D não pôde ser desenhada neste dispositivo. Os dados estão corretos —
                o mapa 2D do Pulmão mostra os mesmos endereços.
              </Notice>
            </div>
          </div>
        }
      >
        {/* Sem `background` na cena: o fundo é a div, em `bg-surface-2`. Assim o tema
            continua vindo dos tokens em vez de um hex paralelo dentro do WebGL. */}
        <Canvas
          camera={{ position: posicaoCamera, fov: FOV_BASE, near: 0.1, far: Math.max(200, distancia * 4) }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onPointerMissed={() => setSelecionada(null)}
        >
          <EnquadramentoResponsivo />
          <Cena
            solidas={solidas}
            divergentes={divergentes}
            raioX={raioX}
            fiosAtivos={fiosAtivos}
            colunas={colunas}
            montantes={montantes}
            travessas={travessas}
            comCarga={comCarga}
            placas={placas}
            achadas={achadas}
            marcadores={marcadores}
            rota={rota}
            fundo={fundo}
            chaveDeSombra={chaveDeSombra}
            realce={realce}
            extensao={extensao}
            deslocamento={deslocamento}
            theme={theme}
            onHover={setApontada}
            onSelect={selecionar}
          />
          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.08}
            // Também proporcionais: um teto fixo prenderia a câmera dentro de um
            // armazém grande, impedindo justamente a vista geral que o 3D existe para dar.
            minDistance={2}
            maxDistance={distancia * 2.5}
            // Trava acima do piso: por baixo do chão não existe ponto de vista real no
            // armazém, e chegar lá é o jeito mais rápido de o operador se perder.
            maxPolarAngle={Math.PI / 2.05}
          />

          {/* Dentro do Canvas porque é onde `useFrame` existe. Nenhum dos dois desenha
              nada: um lê a câmera para o radar, o outro conduz a transição do clique. */}
          <SondaDeCamera controlsRef={controlsRef} aoAtualizar={atualizarRadar} />
          <PanSuave controlsRef={controlsRef} destinoRef={destinoRef} />
          <CapturadorDeCena registrar={registrarCapturador} />
        </Canvas>
      </FronteiraDeErro>

      <Panel className="pointer-events-auto absolute left-3 top-3 w-[15rem]">
        {/* A legenda acompanha o modo. Mostrar as duas ao mesmo tempo obrigaria a
            pessoa a descobrir sozinha qual delas explica o que está na tela. */}
        {modo === 'abc' ? (
          <PanelSection padding="sm" className="space-y-2">
            {LEGENDA_ABC.map(({ classe, rotulo }) => (
              <div key={classe} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: ESCALA_ABC[theme][classe] }}
                  />
                  {rotulo}
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.porClasse[classe]}</span>
              </div>
            ))}

            {contagemAbc.semCurva > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: COR_ATENUADA[theme] }}
                  />
                  Sem classificação
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.semCurva}</span>
              </div>
            )}

            {/* A curva tem DATA. A análise classifica um período fechado e não é
                recalculada quando o estoque se move — dizer qual período está colorindo
                é a diferença entre um mapa e um palpite com cara de mapa. */}
            {abc.analise ? (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                Curva de giro de <span className="text-fg-muted">{abc.analise.nome}</span>, com
                vendas até <span className="text-code">{abc.analise.periodoFim}</span>.
              </p>
            ) : (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                {abcFalhou
                  ? 'Não foi possível carregar a Curva ABC agora. O mapa segue válido nos demais modos.'
                  : 'Nenhuma Curva ABC publicada. Publique uma análise para colorir o armazém por giro.'}
              </p>
            )}
          </PanelSection>
        ) : (
        <PanelSection padding="sm" className="space-y-2">
          {LEGENDA.map(({ status, rotulo }) => (
            <div key={status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-fg-muted">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={
                    status === 'empty'
                      ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                      : { backgroundColor: COR_VAGA[theme][status] }
                  }
                />
                {rotulo}
              </span>
              {/* `.text-code`: é contagem numa coluna, e alinhar na vertical é o que
                  torna a legenda legível de relance. */}
              <span className="text-code text-xs text-fg">{contagem[status]}</span>
            </div>
          ))}
        </PanelSection>
        )}

        <PanelSection padding="sm" className="space-y-2">
          {/* "SKU ou produto", NÃO "SKU ou lote". O WMS não tem camadas de lote: o saldo
              é uma linha por endereço e produto, com uma única data de entrada. Oferecer
              busca por lote prometeria algo que nunca encontraria nada. */}
          <Input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar SKU ou produto…"
            className="w-full"
          />

          {busca.trim().length >= 2 && (
            <p className="text-xs text-fg-muted">
              {buscando ? (
                'Procurando…'
              ) : achados === null || achados.size === 0 ? (
                'Nenhuma vaga com esse produto.'
              ) : (
                <>
                  <span className="text-code">{achadas.length}</span>{' '}
                  {achadas.length === 1 ? 'vaga encontrada' : 'vagas encontradas'}
                  {/* Com um único resultado, levar a câmera até lá é a ação óbvia — e
                      com vários seria arbitrário escolher qual. */}
                  {achadas.length === 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => focarVaga(achadas[0])}
                    >
                      Ir até <span className="text-code ml-1">{achadas[0].slot.id}</span>
                    </Button>
                  )}
                </>
              )}
            </p>
          )}

          {/* Rota de coleta. Vive AQUI, colada na busca, e não num quarto painel
              flutuante: a rota não existe sozinha — ela é a lista que a busca
              produziu, e separá-las esconderia de onde ela veio. */}
          {rota && (
            <div className="space-y-2 border-t border-edge pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                  <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  Rota de coleta
                </span>
                <Button variant="ghost" size="sm" onClick={() => setRotaAberta(a => !a)} aria-expanded={rotaAberta}>
                  {rotaAberta ? 'Recolher' : 'Expandir'}
                </Button>
              </div>

              {rotaAberta && (
                <>
                  {/* O rótulo diz o que a ordem É. Chamar isto de "rota ideal" seria
                      prometer uma otimização que exige distância — e o pulmão não tem
                      distância cadastrada, só a hierarquia do endereço. */}
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    Da entrada mais antiga para a mais nova. Não é a rota mais curta: o pulmão não
                    tem distâncias cadastradas.
                  </p>

                  <ol className="space-y-1">
                    {rota.paradas.map((parada, i) => (
                      <li key={parada.slot.id}>
                        <button
                          type="button"
                          onClick={() => {
                            voarAteParada(parada);
                            setParadaAtual(i + 1);
                          }}
                          className={`flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2 ${
                            i === Math.min(paradaAtual, rota.paradas.length - 1)
                              ? 'bg-surface-2 text-fg'
                              : 'text-fg-muted'
                          }`}
                        >
                          <span className="text-code text-fg-subtle">{parada.ordem}</span>
                          <span className="text-code">{parada.slot.id}</span>
                          <span className="ml-auto shrink-0 text-fg-subtle">N{parada.slot.nivel}</span>
                        </button>
                      </li>
                    ))}
                  </ol>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      if (paradaAtual >= rota.paradas.length) {
                        setParadaAtual(0);
                        voarAteParada(rota.paradas[0]);
                        setParadaAtual(1);
                        return;
                      }
                      voarAteParada(rota.paradas[paradaAtual]);
                      setParadaAtual(paradaAtual + 1);
                    }}
                  >
                    {paradaAtual >= rota.paradas.length
                      ? 'Recomeçar a rota'
                      : `Avançar para a parada ${paradaAtual + 1}`}
                  </Button>
                </>
              )}
            </div>
          )}

          <SegmentedControl options={MODOS} value={modo} onChange={setModo} label="Colorir por" width="full" />

          <Select value={rua} onChange={e => setRua(e.target.value)} className="w-full">
            <option value={TODAS_AS_RUAS}>Todas as ruas</option>
            {ruas.map(r => (
              <option key={r} value={r}>
                Rua {r}
              </option>
            ))}
          </Select>

          <Select
            value={filtro}
            onChange={e => setFiltro(e.target.value as FiltroStatus)}
            className="w-full"
          >
            {FILTROS.map(f => (
              <option key={f.value} value={f.value}>
                {f.rotulo}
                {f.value === 'todas' ? '' : ` (${contagem[f.value]})`}
              </option>
            ))}
          </Select>

          {/* Atalho para o alerta. Aparece SÓ quando há alerta: um botão permanente
              marcando zero vira ruído e, pior, treina a pessoa a ignorá-lo. */}
          {contagem.divergence > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                setFiltro('divergence');
                focarVaga(divergentes[0]);
              }}
            >
              {/* A cor vem da CENA, não de `text-amber-400`: o ícone tem de ser
                  exatamente o âmbar que pinta a vaga lá dentro. Paleta Tailwind crua
                  aqui criaria um segundo amarelo, parecido e diferente. */}
              <ShieldAlert
                aria-hidden
                className="mr-1.5 h-3.5 w-3.5 shrink-0"
                style={{ color: COR_VAGA[theme].divergence }}
              />
              Ver <span className="text-code mx-1">{contagem.divergence}</span> acima da capacidade
            </Button>
          )}

          {/* Mesma regra do atalho acima: aparece só quando há o que apontar. Leva junto
              o modo de cor, porque o alerta não faz sentido sobre o mapa de Status — o
              losango explica POR QUE a vaga está marcada apenas quando a cor é a curva. */}
          {alertasGiro.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => {
                setModo('abc');
                focarVaga(todasDesenhaveis.find(v => v.slot.id === alertasGiro[0].id));
              }}
            >
              {/* Vermelho do marcador 3D do mesmo alerta — o losango que paira sobre a
                  vaga. Ícone e marcador têm de ser a mesma cor, senão são lidos como
                  dois avisos diferentes. */}
              <ShieldAlert
                aria-hidden
                className="mr-1.5 h-3.5 w-3.5 shrink-0"
                style={{ color: COR_ALERTA_GIRO }}
              />
              <span className="text-code mr-1">{alertasGiro.length}</span>
              {alertasGiro.length === 1 ? 'vaga de alto giro elevada' : 'vagas de alto giro elevadas'}
            </Button>
          )}

          {/* O filtro isola, não amputa: as demais vagas continuam desenhadas em tom
              apagado, senão o armazém perderia a forma e o 3D perderia a razão. */}
          <p className="text-xs text-fg-subtle">
            <span className="text-code">{emDestaque}</span> de{' '}
            <span className="text-code">{vagas.length}</span> em destaque
          </p>
        </PanelSection>

        {/* Vaga sem posição não é descartada em silêncio: some do desenho, mas o
            número fica à vista. Senão o 3D mostraria menos armazém do que existe. */}
        {estado.dados.naoPosicionaveis.length > 0 && (
          <PanelSection padding="sm">
            <p className="text-xs leading-relaxed text-fg-muted">
              <span className="text-code">{estado.dados.naoPosicionaveis.length}</span> vaga(s) fora do
              padrão de código não aparecem no mapa.
            </p>
          </PanelSection>
        )}

        <PanelSection padding="sm" className="space-y-2">
          <Button variant="secondary" size="sm" className="w-full" onClick={resetarCamera}>
            Resetar câmera
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAjustando(true)}>
            Ajustar estrutura
          </Button>
          {/* "Limpo" existe para quem precisa de quadro: o cenário custa um piso, quatro
              paredes e um passe de sombra, e numa máquina fraca isso é o que sobra de
              orçamento. Voltar para ele devolve exatamente a cena anterior. */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setFundo(f => (f === 'galpao' ? 'limpo' : 'galpao'))}
          >
            Fundo: {fundo === 'galpao' ? 'galpão' : 'limpo'}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={capturarCena}>
            Capturar visão 3D
          </Button>
        </PanelSection>
      </Panel>

      <AjusteDeEstrutura
        aberto={ajustando}
        onFechar={() => setAjustando(false)}
        layout={layout}
        ruas={ruas}
        onMudar={trocarLayout}
      />

      {/* Antes do painel de detalhe DE PROPÓSITO: quando os dois ficam altos e se
          sobrepõem, quem vence é o detalhe da vaga selecionada. O radar ajuda a chegar
          lá; depois de chegar, o conteúdo da vaga é a tarefa. */}
      {celulasRadar.length > 0 && (
        <Radar
          celulas={celulasRadar}
          area={areaRadar}
          theme={theme}
          aberto={radarAberto}
          onAlternar={() => setRadarAberto(a => !a)}
          onIrPara={irParaNoRadar}
          grupoRef={radarGrupoRef}
          coneRef={radarConeRef}
        />
      )}

      {selecionada && (
        <PainelDetalhe
          slot={selecionada}
          abc={abc.porVaga.get(selecionada.id)}
          onFechar={() => setSelecionada(null)}
          onScanRequest={onScanRequest}
          onOperate={onOperate}
        />
      )}
    </div>
  );
}
