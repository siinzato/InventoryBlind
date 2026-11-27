// A linguagem visual do mapa 3D: cor, escala, catálogo e as medidas que o desenho usa.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. Nada mudou de valor — o
// arquivo existe porque HUD, cena, radar e painel de detalhe precisam das MESMAS cores, e
// cada um importando do componente de cima criaria dependência circular assim que o
// componente passasse a importá-los de volta.
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então este módulo é o
// ponto único de verdade da paleta da cena — o equivalente a um token.

import { Activity, BarChart3, TrendingUp } from 'lucide-react';
import { IconeCodigoDeVaga, IconePlantaDoGalpao, IconePortaPallets, IconeSelecionar } from './icones3d';
import type { SegmentedOption } from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import type { AbcClasse, AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';

export const COR_VAGA: Record<Theme, Record<SlotStatus, string>> = {
  light: { empty: '#64748B', occupied: '#C8A070', divergence: '#F59E0B', blocked: '#94A3B8' },
  dark: { empty: '#64748B', occupied: '#A07E57', divergence: '#F59E0B', blocked: '#475569' },
};

/** Escala de ocupação: a MESMA navy em três intensidades, não três cores diferentes.
 *  Tom é quantidade; matiz continua sendo significado. Trocar o matiz aqui faria o
 *  modo de ocupação competir com o de status, e nenhum dos dois seria lido. */
export const ESCALA_OCUPACAO: Record<Theme, [string, string, string]> = {
  light: ['#7C9AC4', '#2F5A8F', '#0A2647'],
  dark: ['#3E6FA8', '#2A5FA3', '#1C4A85'],
};

/** Fora do filtro: presente, porque sumir destruiria a forma do armazém, mas sem
 *  nenhum peso visual. O filtro ISOLA, não amputa. */
export const COR_ATENUADA: Record<Theme, string> = { light: '#D8DEE7', dark: '#262C38' };

export const COR_REALCE: Record<Theme, string> = { light: '#0A2647', dark: '#9FC3F0' };

/**
 * Resultado de busca: azul, não dourado.
 *
 * A especificação ofereceu dourado (#EAB308) ou azul (#3B82F6). Dourado foi descartado
 * porque o âmbar #F59E0B já significa "pede atenção" NESTA MESMA cena — duas cores
 * quase idênticas com significados opostos ("achei o que você pediu" x "isto está
 * errado") treinariam o operador a ler errado as duas. Azul é a família de
 * selecionado/encontrado no resto do produto, então não disputa com o alerta.
 */
export const COR_BUSCA = '#3B82F6';

/** Vaga recém-mexida por OUTRO operador. Transitória — dura dois segundos e some.
 *  Vizinha do azul da busca, e isso é aceitável porque as duas nunca competem pelo
 *  mesmo papel: a busca é um estado que a pessoa escolheu e permanece; isto é um aviso
 *  que ninguém pediu e que se apaga sozinho. O que as distingue é a duração. */
export const COR_PULSO = '#38BDF8';

/** Dois segundos: tempo de perceber sem virar poluição quando o galpão está movimentado. */
export const DURACAO_PULSO = 2000;

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
export const ESCALA_ABC: Record<Theme, Record<AbcClasse, string>> = {
  light: { C: '#C4B0DC', B: '#8257B5', A: '#4C1D7A' },
  dark: { C: '#4A3A68', B: '#8B6BC0', A: '#C9A8F0' },
};

/** Alerta de giro mal posicionado. Vermelho é a única família semântica AINDA LIVRE na
 *  cena, e aqui ela é honesta: isto é um item de ação ("desça este pallet"), não um
 *  estado passivo. O âmbar não serve — já é "acima da capacidade". */
export const COR_ALERTA_GIRO = '#DC2626';

/**
 * Cores da estrutura física. Constantes em toda a cena, nunca semânticas.
 *
 * A referência traz montante azul e travessa laranja, que é o padrão da indústria. A
 * travessa aqui é um laranja QUEIMADO, não o `#F97316` sugerido: esse laranja é
 * vizinho do `#F59E0B` que significa "acima da capacidade" nesta mesma cena, e uma
 * estante inteira pintada quase da cor do alerta faz o alerta desaparecer dentro dela.
 * Queimando o tom, a estrutura recua e o âmbar volta a saltar.
 */
export const COR_COLUNA: Record<Theme, string> = { light: '#27497F', dark: '#2E5668' };
export const COR_TRAVESSA: Record<Theme, string> = { light: '#A8521C', dark: '#8A4418' };
export const COR_PALETE: Record<Theme, string> = { light: '#8A5A2B', dark: '#6B4522' };

/**
 * Demarcação do pé da fileira — a tinta que no galpão delimita onde a estante fica.
 *
 * NEUTRA de propósito. Rua não tem cor semântica, e dar uma a ela inventaria
 * significado onde não há. O amarelo do cenário já quer dizer "circulação"; isto é o
 * contrário — é a área onde não se circula, porque ali está a estante. Pintar as duas
 * da mesma cor faria o galpão parecer todo corredor.
 */
export const COR_DEMARCACAO: Record<Theme, string> = { light: '#9FAABA', dark: '#2C3747' };

/**
 * Amarelo de marcação de solo — o mesmo papel do amarelo pintado no chão do galpão:
 * sinalizar circulação e equipamento de movimentação.
 *
 * NÃO é cor semântica do produto e não entra em nenhuma legenda; por isso pode ser
 * literal sem disputar com o âmbar do alerta. Mora aqui, e não no componente de cenário
 * onde nasceu, porque dois lugares passaram a precisar dela — as faixas de circulação e o
 * zebrado da expedição — e este módulo é declaradamente o ponto único de verdade da
 * paleta da cena.
 */
export const COR_MARCACAO: Record<Theme, string> = { light: '#D9A514', dark: '#7A5E12' };

/**
 * O galpão em volta: vidro das janelas altas e aço da cobertura.
 *
 * A janela é EMISSIVA de propósito. Ela está a nove metros do chão, virada para dentro, e
 * as três luzes da cena vêm de cima — iluminada só por elas, a abertura sairia mais escura
 * que a parede, que é o oposto do que uma janela faz. Emissiva, ela lê como entrada de luz
 * sem custar uma quarta fonte de iluminação no orçamento.
 *
 * No escuro a emissão cai para um terço: janela de galpão à noite tem a luz vazando de
 * dentro, fraca, e não o dia inteiro atrás do vidro.
 */
export const COR_JANELA: Record<Theme, { vidro: string; brilho: number }> = {
  light: { vidro: '#E8F1FB', brilho: 0.9 },
  dark: { vidro: '#2A3C56', brilho: 0.3 },
};

/** Aço da treliça de cobertura. Mais claro que o montante no claro e mais escuro no
 *  escuro: a cobertura é fundo, e fundo nunca pode competir com a estante. */
export const COR_COBERTURA: Record<Theme, string> = { light: '#B9C2CE', dark: '#222936' };

export const COR_GRADE: Record<Theme, [string, string]> = {
  light: ['#CBD5E1', '#E2E8F0'],
  dark: ['#2A3140', '#1C212B'],
};

export const LEGENDA: ReadonlyArray<{ status: SlotStatus; rotulo: string }> = [
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
export type FiltroStatus = 'todas' | SlotStatus;

export const FILTROS: ReadonlyArray<{ value: FiltroStatus; rotulo: string }> = [
  { value: 'todas', rotulo: 'Todas as vagas' },
  { value: 'divergence', rotulo: 'Acima da capacidade' },
  { value: 'occupied', rotulo: 'Ocupadas' },
  { value: 'empty', rotulo: 'Livres' },
  { value: 'blocked', rotulo: 'Bloqueadas' },
];

/**
 * Para que serve a cena agora.
 *
 * `operacional` é tudo que esta tela sempre fez: saldo, busca, rota, tempo real. É o
 * padrão e continua idêntico — trocar de modo não pode ser caminho sem volta.
 *
 * `edicao` é o Galpão Builder: a cena deixa de ser só leitura e passa a aceitar
 * construção. Por ora acende a grade de referência do piso; o catálogo e a manipulação
 * de objeto entram nas etapas seguintes.
 */
export type ModoVisor = 'operacional' | 'edicao';

/**
 * De onde vem a geometria desenhada: das medidas da planta ou do código do endereço.
 *
 * É ESCOLHA entre duas coisas, não um interruptor — e era desenhada como um botão de
 * largura cheia que trocava de rótulo a cada clique. Botão que muda de nome ao ser clicado
 * não diz se o nome mostrado é o estado atual ou o destino do clique; num segmentado as
 * duas opções ficam na tela e a selecionada é óbvia.
 */
export type OrigemDoDesenho = 'planta' | 'codigo';

export const ORIGENS_DO_DESENHO: SegmentedOption<OrigemDoDesenho>[] = [
  { value: 'planta', label: 'Planta', icon: IconePlantaDoGalpao },
  { value: 'codigo', label: 'Código', icon: IconeCodigoDeVaga },
];

export const MODOS_VISOR: SegmentedOption<ModoVisor>[] = [
  { value: 'operacional', label: 'Operacional', icon: IconeSelecionar },
  { value: 'edicao', label: 'Edição', icon: IconePortaPallets },
];

/** Divisão da grade de construção, em metros. Um metro é a unidade em que se fala de
 *  corredor e de vão no galpão — meio metro polui e dois metros não ajuda a mirar. */
export const PASSO_GRADE_BUILDER = 1;

/** Espessura do palete de madeira desenhado dentro do vão, a mesma da estrutura por código. */
export const ALTURA_DO_PALETE = 0.12;

/**
 * Espessura do piso da vaga livre — a chapa sobre a qual o palete apoiaria.
 *
 * 8 cm, e não 2: fina demais ela vira uma linha vista de lado e deixa de ser clicável
 * em ângulo rasante, que é justo o ângulo de quem está caminhando no galpão.
 */
export const ALTURA_DO_PISO_DO_VAO = 0.08;

/** Pavimento em que o mapa abre. Os demais aparecem no seletor quando têm planta. */
export const ANDAR_INICIAL = 1;

/** Altura dos olhos de quem caminha, em metros. */
export const ALTURA_DOS_OLHOS = 1.65;

/** Velocidade da caminhada, em m/s. Passo de quem anda conferindo, não de quem corre. */
export const VELOCIDADE_A_PE = 2.2;

/**
 * Raio do caminhante, em metros — o quanto ele ocupa no piso.
 *
 * 0,30 m medido contra os corredores da planta: no de 1,20 m do prédio atual sobram
 * 0,60 m de passagem livre; no de 2,65 m do galpão novo, 2,05 m. Um raio maior fecharia o
 * corredor estreito, e a pessoa não entenderia por que não passa num lugar onde a
 * empilhadeira passa.
 */
export const RAIO_DO_CAMINHANTE = 0.3;

/** Folga entre a parede e o nariz de quem caminha. */
export const MARGEM_DA_CERCA = 0.2;

// ── Catálogo de construção ───────────────────────────────────────────────────────────
//
// O que o Modo Edição sabe colocar no chão. Tudo vive em ESTADO LOCAL do React: construir
// é imediato e reversível, sem ida ao banco. Gravar é etapa própria — e misturar as duas
// faria cada clique de teste virar uma linha em produção.

export type FerramentaBuilder = 'navegar' | 'porta-pallets' | 'mesa' | 'doca' | 'pallet';

export type TipoConstruido = Exclude<FerramentaBuilder, 'navegar'>;

export interface PecaDoCatalogo {
  rotulo: string;
  /** Dimensões em METROS: [largura (X), altura (Y), profundidade (Z)]. */
  tamanho: [number, number, number];
  /**
   * Demarcação de solo em vez de estrutura.
   *
   * Muda onde a peça se apoia: estrutura sobe a partir do piso, demarcação fica rente a
   * ele. Sem a distinção, uma área de doca nasceria flutuando a meia altura.
   */
  noChao: boolean;
}

export const CATALOGO: Record<TipoConstruido, PecaDoCatalogo> = {
  // Um trecho de estante com 3 posições e 3 níveis, nas MESMAS medidas da planta: 1,1 de
  // profundidade, 4,2 de altura, 3,6 de comprimento (3 × 1,2). Colocar um "porta-pallets"
  // que não tem a geometria do porta-pallets desenhado faria o builder construir outra
  // coisa diferente do galpão.
  'porta-pallets': { rotulo: 'Porta-Pallets', tamanho: [1.1, 4.2, 3.6], noChao: false },
  mesa: { rotulo: 'Mesa de expedição', tamanho: [1.6, 0.9, 0.8], noChao: false },
  doca: { rotulo: 'Área de doca', tamanho: [3, 0.04, 3], noChao: true },
  // Pallet no chão: estrado PBR mais a carga em cima. É a peça que faltava para
  // desenhar o que de fato ocupa corredor num galpão — mercadoria fora da estante,
  // esperando conferência ou carregamento. Medida real: 1,20 x 1,00 de estrado.
  pallet: { rotulo: 'Pallet no chão', tamanho: [1.2, 1.15, 1.0], noChao: false },
};

/** Cores do builder. Hex porque é WebGL, no mesmo padrão de COR_VAGA e COR_GRADE. */
export const COR_BUILDER: Record<Theme, { fantasma: string; peca: string; selecionada: string; doca: string }> = {
  light: { fantasma: '#3E7BE0', peca: '#64748B', selecionada: '#1E5FBF', doca: '#F59E0B' },
  dark: { fantasma: '#7FB3F5', peca: '#475569', selecionada: '#3E7BE0', doca: '#B45309' },
};

/**
 * Variante do porta-pallets.
 *
 * Muda a GEOMETRIA, não só a aparência: o duplo é duas fileiras costa-a-costa, como a
 * dupla central do galpão novo, e o de picking é mais baixo e mais raso. Tratar isso
 * como enfeite faria o builder desenhar um rack e a operação ter outro.
 */
export type TipoDeEstante = 'simples' | 'duplo' | 'picking';

export const ESTANTES: Record<TipoDeEstante, { rotulo: string; tamanho: [number, number, number] }> = {
  simples: { rotulo: 'Simples', tamanho: [1.1, 4.2, 3.6] },
  // Profundidade dobrada: duas fileiras encostadas, sem corredor entre elas.
  duplo: { rotulo: 'Duplo', tamanho: [2.2, 4.2, 3.6] },
  // Picking é para separar à mão: altura de alcance e prateleira rasa.
  picking: { rotulo: 'Picking', tamanho: [0.8, 2.4, 3.6] },
};

/** Cores de estante. Nomes do galpão, não hex, porque é isso que se fala na operação. */
export const CORES_DE_ESTANTE: { chave: string; rotulo: string; hex: string }[] = [
  { chave: 'laranja', rotulo: 'Laranja', hex: '#C8A070' },
  { chave: 'azul', rotulo: 'Azul', hex: '#3E6FA8' },
  { chave: 'cinza', rotulo: 'Cinza', hex: '#64748B' },
  { chave: 'verde', rotulo: 'Verde', hex: '#4B7F62' },
];

export interface ObjetoConstruido {
  id: string;
  tipo: TipoConstruido;
  /** Só faz sentido para porta-pallets; as outras peças ignoram. */
  estante: TipoDeEstante;
  /** Chave de CORES_DE_ESTANTE. */
  cor: string;
  /** Centro em metros, já alinhado à grade. */
  x: number;
  z: number;
  /** Múltiplos de 90°, em radianos. */
  rotacaoY: number;
}

/** Altura do centro da peça para que a BASE encoste no piso. */
export function alturaDoCentro(peca: PecaDoCatalogo): number {
  // Demarcação ganha 2 cm para não brigar por z-fighting com a laje do cenário.
  return peca.noChao ? peca.tamanho[1] / 2 + 0.02 : peca.tamanho[1] / 2;
}

export type ModoCor = 'status' | 'ocupacao' | 'abc';

// Mutável de propósito: `SegmentedControl` recebe `SegmentedOption<T>[]`, não
// ReadonlyArray. Anotar como readonly aqui só obrigaria a copiar no ponto de uso.
export const MODOS: SegmentedOption<ModoCor>[] = [
  { value: 'status', label: 'Status', icon: Activity },
  { value: 'ocupacao', label: 'Ocupação', icon: BarChart3 },
  { value: 'abc', label: 'Curva ABC', icon: TrendingUp },
];

export const LEGENDA_ABC: ReadonlyArray<{ classe: AbcClasse; rotulo: string }> = [
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

export function corDaVaga(
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

/**
 * Largura abaixo da qual os painéis flutuantes começam RECOLHIDOS, em pixels.
 *
 * É o `md` do Tailwind. Mora aqui porque HUD e radar decidem a mesma coisa pela mesma
 * régua, e porque um arquivo de componente que exporta constante perde o recarregamento a
 * quente do Vite.
 */
export const LARGURA_ESTREITA = 768;
