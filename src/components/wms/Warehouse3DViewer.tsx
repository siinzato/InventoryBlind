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
  type ElementRef, type ReactNode,
} from 'react';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, EdgesGeometry,
  Matrix4, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
  type InstancedMesh,
} from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Badge, BrandLoader, Button, Notice, Panel, PanelSection, Select, SegmentedControl, type SegmentedOption } from '../ui';
import { useTheme, type Theme } from '../../lib/useTheme';
import { loadWarehouseSlots, type Slot, type SlotStatus, type WarehouseSlots } from '../../lib/wms/warehouse3dSlots';
import { listBinContents, type BinStockRow } from '../../lib/wms/wmsService';

export type { Slot, SlotStatus } from '../../lib/wms/warehouse3dSlots';

// ── Geometria ──────────────────────────────────────────────────────────────────
//
// Uma vaga é mais funda (Z) que larga (X) e mais baixa (Y) que ambas — é a proporção
// de um pallet PBR em pé numa longarina, não um cubo. Cubo perfeito faria o armazém
// parecer uma estante de cubos, que é justamente a leitura errada.
// Em METROS, não em unidades arbitrárias. Um palete PBR carregado ocupa cerca de
// 1,2 m de frente por 1,2 m de fundo, e a carga sobe ~1,4 m. A altura anterior (0,72)
// era de meio palete: as vagas pareciam gavetas, e o porta-pallets perdia o pé-direito.
const VAGA = { largura: 1.2, altura: 1.4, profundidade: 1.2 } as const;

// Os três passos NÃO são o mesmo número, e é aí que mora a proporcionalidade:
//
// X (entre ruas)    — leva o corredor de empilhadeira inteiro no meio. É de longe o
//                     maior vão, e é o que faz a cena parecer um armazém em vez de uma
//                     matriz. Comprimir isto é o erro mais comum numa planta 3D.
// Z (entre módulos) — módulos vizinhos dividem o montante vertical. Vão quase nulo.
// Y (entre níveis)  — a espessura da longarina mais a folga de manobra do pallet.
const PASSO = {
  // 1,2 de vaga + 2,8 de corredor = 4,0 m entre eixos de rua. 2,8 m é a faixa de
  // manobra de uma empilhadeira contrabalançada; abaixo disso o desenho mentiria
  // sobre caber a máquina.
  rua: VAGA.largura + 2.8,
  modulo: VAGA.profundidade + 0.1,
  // 1,4 de carga + 0,4 de longarina e folga de entrada do garfo = 1,8 m de pé-direito
  // por nível, que é o passo típico de porta-pallets.
  nivel: VAGA.altura + 0.4,
} as const;

/**
 * Converte um endereço lógico (rua, módulo, nível) na posição no espaço.
 *
 * Pura e 1-based: rua/módulo/nível começam em 1, como o endereço impresso na etiqueta.
 * A origem fica no canto da rua 1 / módulo 1, com o nível 1 apoiado no chão (y = 0),
 * para que o piso da cena seja o piso do armazém e não um plano arbitrário.
 *
 * `rua` aqui é o ÍNDICE da rua, não a letra: no banco a rua é 'A', 'B', 'C'. A
 * conversão letra -> índice acontece em `buildSlots`, que enxerga o conjunto inteiro.
 *
 * O resultado é absoluto, não centralizado — centralizar é trabalho da cena, que
 * conhece a extensão total.
 */
export function getSlotPosition(rua: number, modulo: number, nivel: number): [number, number, number] {
  return [
    (rua - 1) * PASSO.rua,
    (nivel - 1) * PASSO.nivel + VAGA.altura / 2,
    (modulo - 1) * PASSO.modulo,
  ];
}

// ── Cor ────────────────────────────────────────────────────────────────────────
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então o arquivo
// mantém o seu próprio mapa — um único ponto de verdade, como um token — em vez de
// espalhar literais pelo JSX.
//
// A navy é #0A2647, o mesmo `--rail`/`--action` do index.css. No escuro ela clareia
// para #1C4A85, exatamente como o `--action` já faz lá ("#0A2647 sobre o #12151C do
// painel não tem aresta nenhuma"): cubo quase preto sobre fundo quase preto não é
// sóbrio, é invisível.
const COR_VAGA: Record<Theme, Record<SlotStatus, string>> = {
  light: { empty: '#64748B', occupied: '#0A2647', divergence: '#F59E0B', blocked: '#94A3B8' },
  dark: { empty: '#64748B', occupied: '#1C4A85', divergence: '#F59E0B', blocked: '#475569' },
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

type ModoCor = 'status' | 'ocupacao';

// Mutável de propósito: `SegmentedControl` recebe `SegmentedOption<T>[]`, não
// ReadonlyArray. Anotar como readonly aqui só obrigaria a copiar no ponto de uso.
const MODOS: SegmentedOption<ModoCor>[] = [
  { value: 'status', label: 'Status' },
  { value: 'ocupacao', label: 'Ocupação' },
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

function corDaVaga(slot: Slot, modo: ModoCor, theme: Theme, maxCaixas: number): string {
  if (modo === 'status') return COR_VAGA[theme][slot.status];
  if (slot.status === 'empty') return COR_VAGA[theme].empty;
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
export function enquadrarCamera(slots: readonly Slot[]): [number, number, number] {
  const magnitude = Math.hypot(...DIRECAO_CAMERA);
  if (slots.length === 0) return DIRECAO_CAMERA;

  const largura = (Math.max(...slots.map(s => s.rua)) - 1) * PASSO.rua + VAGA.largura;
  const profundidade = (Math.max(...slots.map(s => s.modulo)) - 1) * PASSO.modulo + VAGA.profundidade;
  const altura = Math.max(...slots.map(s => s.nivel)) * PASSO.nivel;

  const distancia = Math.max(Math.hypot(largura, profundidade, altura) * FOLGA_CAMERA, 6);
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
function fundirArestas(vagas: readonly VagaDesenhavel[]): BufferGeometry {
  const base = GEOMETRIA_ARESTAS.getAttribute('position').array as Float32Array;
  const destino = new Float32Array(base.length * vagas.length);

  vagas.forEach((vaga, indice) => {
    const salto = indice * base.length;
    const [dx, dy, dz] = vaga.posicao;
    for (let k = 0; k < base.length; k += 3) {
      destino[salto + k] = base[k] + dx;
      destino[salto + k + 1] = base[k + 1] + dy;
      destino[salto + k + 2] = base[k + 2] + dz;
    }
  });

  const geometria = new BufferGeometry();
  geometria.setAttribute('position', new BufferAttribute(destino, 3));
  return geometria;
}

/** Geometria fundida que se descarta sozinha quando a entrada muda. Sem o dispose, cada
 *  troca de filtro deixaria um buffer órfão na GPU — o three não recolhe isso. */
function useArestasFundidas(vagas: readonly VagaDesenhavel[]): BufferGeometry {
  const geometria = useMemo(() => fundirArestas(vagas), [vagas]);
  useEffect(() => () => geometria.dispose(), [geometria]);
  return geometria;
}

// Materiais no módulo: nenhum dos dois depende do tema (a cor vem por instância), então
// recriá-los a cada render só geraria recompilação de shader.
const MATERIAL_SOLIDO = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.05 });
/** Apanhador de clique: ocupa espaço para o raycast e não desenha nada. */
const MATERIAL_INVISIVEL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

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
  onHover,
  onSelect,
}: {
  vagas: VagaDesenhavel[];
  material: MeshBasicMaterial | MeshStandardMaterial;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = Math.max(1, vagas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    vagas.forEach((vaga, i) => {
      MATRIZ.makeTranslation(vaga.posicao[0], vaga.posicao[1], vaga.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
      malha.setColorAt(i, COR.set(vaga.cor));
    });
    malha.count = vagas.length;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }, [vagas]);

  return (
    <instancedMesh
      ref={ref}
      args={[GEOMETRIA_VAGA, material, capacidade]}
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

function Cena({
  solidas,
  fiosAtivos,
  fiosAtenuados,
  realce,
  extensao,
  deslocamento,
  theme,
  onHover,
  onSelect,
}: {
  solidas: VagaDesenhavel[];
  fiosAtivos: VagaDesenhavel[];
  fiosAtenuados: VagaDesenhavel[];
  realce: VagaDesenhavel | null;
  extensao: number;
  deslocamento: [number, number, number];
  theme: Theme;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}) {
  const [centro, linha] = COR_GRADE[theme];
  const arestasAtivas = useArestasFundidas(fiosAtivos);
  const arestasAtenuadas = useArestasFundidas(fiosAtenuados);

  return (
    <>
      {/* Duas luzes. A ambiente sozinha achata todas as faces no mesmo tom e o cubo
          vira um hexágono chapado; a direcional é o que devolve a aresta entre topo e
          lateral — ou seja, o que faz ler como volume. */}
      <ambientLight intensity={theme === 'dark' ? 1.15 : 1.35} />
      <directionalLight position={[6, 12, 8]} intensity={theme === 'dark' ? 1.6 : 2.1} />

      {/* Piso. Sem referência de chão, orbitar desorienta: os cubos parecem flutuar no
          vazio e some a noção de qual rua está na frente. */}
      <gridHelper args={[extensao, Math.max(1, Math.round(extensao)), centro, linha]} position={[0, 0, 0]} />

      <group position={deslocamento}>
        {/* Vagas com conteúdo: um único objeto de GPU para todas. */}
        <LoteInstanciado
          key={`solidas-${solidas.length}`}
          vagas={solidas}
          material={MATERIAL_SOLIDO}
          onHover={onHover}
          onSelect={onSelect}
        />

        {/* Vaga livre é ausência de pallet, e sólido cinza comunica o contrário — parece
            ocupada por algo cinza. Por isso ela é contorno: o vão da estrutura continua
            visível, e a vaga com carga ao lado ganha o peso visual que de fato tem. */}
        <lineSegments geometry={arestasAtivas}>
          <lineBasicMaterial color={COR_VAGA[theme].empty} />
        </lineSegments>

        {/* Fora do filtro. Continua desenhado porque o filtro ISOLA, não amputa: sem
            estas vagas o armazém perderia a forma e sobrariam cubos flutuando. */}
        <lineSegments geometry={arestasAtenuadas}>
          <lineBasicMaterial color={COR_ATENUADA[theme]} />
        </lineSegments>

        {/* Apanhador de clique das vagas livres. A geometria fundida acima é um objeto
            só, então o raycast não saberia QUAL vaga foi apontada. Estas instâncias
            invisíveis devolvem essa resolução sem desenhar nada — `opacity: 0` em vez
            de `visible={false}` porque o three não faz raycast em objeto invisível. */}
        <LoteInstanciado
          key={`fios-${fiosAtivos.length}`}
          vagas={fiosAtivos}
          material={MATERIAL_INVISIVEL}
          onHover={onHover}
          onSelect={onSelect}
        />

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

const ROTULO_STATUS: Record<SlotStatus, string> = {
  occupied: 'Ocupada',
  empty: 'Livre',
  divergence: 'Acima da capacidade',
  blocked: 'Bloqueada',
};

const TOM_STATUS: Record<SlotStatus, 'neutral' | 'accent' | 'warning'> = {
  occupied: 'accent',
  empty: 'neutral',
  divergence: 'warning',
  blocked: 'neutral',
};

function PainelDetalhe({
  slot,
  onFechar,
  onScanRequest,
  onOperate,
}: {
  slot: Slot;
  onFechar: () => void;
  onScanRequest?: (slot: Slot) => void;
  onOperate?: (slot: Slot) => void;
}) {
  const [conteudo, setConteudo] = useState<BinStockRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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
      <PanelSection padding="sm" className="flex items-start justify-between gap-2">
        <div>
          <p className="text-code text-sm font-medium text-fg">{slot.id}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Rua {slot.ruaCodigo} · módulo <span className="text-code">{slot.modulo}</span> · nível{' '}
            <span className="text-code">{slot.nivel}</span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </PanelSection>

      <PanelSection padding="sm" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-muted">Situação</span>
          <Badge variant={TOM_STATUS[slot.status]}>{ROTULO_STATUS[slot.status]}</Badge>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-muted">Caixas</span>
          <span className="text-code text-xs text-fg">
            {/* Sem capacidade cadastrada mostra só a contagem. Exibir "18/—" sugeriria
                um limite que ninguém definiu. */}
            {slot.capacidade !== null ? `${slot.caixas}/${slot.capacidade}` : slot.caixas}
          </span>
        </div>
      </PanelSection>

      <PanelSection padding="sm" className="min-h-0 flex-1 overflow-auto">
        <p className="mb-2 text-xs font-medium text-fg">Conteúdo</p>
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
                <p className="text-code text-xs text-fg">{linha.sku}</p>
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
          {onScanRequest && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => onScanRequest(slot)}>
              Ler QR Code
            </Button>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────────

interface Warehouse3DViewerProps {
  /**
   * Vagas a desenhar. Omitido, o componente busca os endereços reais do Pulmão.
   * Passar explicitamente serve para teste e para telas que já carregaram os dados.
   */
  slots?: readonly Slot[];
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

const MOLDURA = 'relative h-full min-h-[24rem] w-full overflow-hidden rounded-container bg-surface-2';
const TODAS_AS_RUAS = '';

export function Warehouse3DViewer({
  slots: slotsExternos,
  onSelectSlot,
  onScanRequest,
  onOperate,
  className = '',
}: Warehouse3DViewerProps) {
  const { theme } = useTheme();
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [estado, setEstado] = useState<Estado>(() =>
    slotsExternos ? { fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [] } } : { fase: 'carregando' },
  );

  const [modo, setModo] = useState<ModoCor>('status');
  const [apenasAlertas, setApenasAlertas] = useState(false);
  const [rua, setRua] = useState<string>(TODAS_AS_RUAS);
  const [apontada, setApontada] = useState<Slot | null>(null);
  const [selecionada, setSelecionada] = useState<Slot | null>(null);

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
      setEstado({ fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [] } });
      return;
    }
    return buscar();
  }, [slotsExternos, buscar]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const vagas = useMemo(() => dados?.slots ?? [], [dados]);

  const contagem = useMemo(() => {
    const base: Record<SlotStatus, number> = { empty: 0, occupied: 0, divergence: 0, blocked: 0 };
    for (const s of vagas) base[s.status] += 1;
    return base;
  }, [vagas]);

  const ruas = useMemo(() => [...new Set(vagas.map(s => s.ruaCodigo))].sort(), [vagas]);

  // Posição e cor de cada vaga, calculadas uma vez por mudança real de entrada. Sem
  // isto, cada movimento do mouse (que muda `apontada`) recalcularia a cena inteira.
  const { solidas, fiosAtivos, fiosAtenuados, extensao, deslocamento } = useMemo(() => {
    const maxCaixas = vagas.reduce((m, s) => Math.max(m, s.caixas), 0);
    const atenuada = COR_ATENUADA[theme];

    const desenhaveis: VagaDesenhavel[] = vagas.map(slot => {
      const ativa =
        (rua === TODAS_AS_RUAS || slot.ruaCodigo === rua) &&
        (!apenasAlertas || slot.status === 'divergence' || slot.status === 'blocked');
      return {
        slot,
        posicao: getSlotPosition(slot.rua, slot.modulo, slot.nivel),
        cor: ativa ? corDaVaga(slot, modo, theme, maxCaixas) : atenuada,
        ativa,
      };
    });

    if (vagas.length === 0) {
      return {
        solidas: [], fiosAtivos: [], fiosAtenuados: [],
        extensao: 10, deslocamento: [0, 0, 0] as [number, number, number],
      };
    }

    const maxRua = Math.max(...vagas.map(s => s.rua));
    const maxModulo = Math.max(...vagas.map(s => s.modulo));
    const larguraTotal = (maxRua - 1) * PASSO.rua;
    const profundidadeTotal = (maxModulo - 1) * PASSO.modulo;

    return {
      solidas: desenhaveis.filter(v => v.ativa && v.slot.status !== 'empty'),
      fiosAtivos: desenhaveis.filter(v => v.ativa && v.slot.status === 'empty'),
      // Vaga atenuada vai para o contorno mesmo quando tem carga: fora do filtro ela é
      // contexto, e contexto não compete com o que se quis isolar.
      fiosAtenuados: desenhaveis.filter(v => !v.ativa),
      extensao: Math.max(larguraTotal, profundidadeTotal) + 4,
      // Centraliza na origem para o OrbitControls orbitar o armazém, não um canto dele.
      deslocamento: [-larguraTotal / 2, 0, -profundidadeTotal / 2] as [number, number, number],
    };
  }, [vagas, modo, theme, rua, apenasAlertas]);

  const realce = useMemo(() => {
    const alvo = apontada ?? selecionada;
    if (!alvo) return null;
    return [...solidas, ...fiosAtivos, ...fiosAtenuados].find(v => v.slot.id === alvo.id) ?? null;
  }, [apontada, selecionada, solidas, fiosAtivos, fiosAtenuados]);

  const posicaoCamera = useMemo(() => enquadrarCamera(vagas), [vagas]);
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

  const emDestaque = solidas.length + fiosAtivos.length;

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
            fiosAtivos={fiosAtivos}
            fiosAtenuados={fiosAtenuados}
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
        </Canvas>
      </FronteiraDeErro>

      <Panel className="pointer-events-auto absolute left-3 top-3 w-[15rem]">
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

        <PanelSection padding="sm" className="space-y-2">
          <SegmentedControl options={MODOS} value={modo} onChange={setModo} label="Colorir por" width="full" />

          <Select value={rua} onChange={e => setRua(e.target.value)} className="w-full">
            <option value={TODAS_AS_RUAS}>Todas as ruas</option>
            {ruas.map(r => (
              <option key={r} value={r}>
                Rua {r}
              </option>
            ))}
          </Select>

          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={apenasAlertas}
              onChange={e => setApenasAlertas(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[3px] border-edge accent-action"
            />
            Só o que pede atenção
          </label>

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

        <PanelSection padding="sm">
          <Button variant="secondary" size="sm" className="w-full" onClick={resetarCamera}>
            Resetar câmera
          </Button>
        </PanelSection>
      </Panel>

      {selecionada && (
        <PainelDetalhe
          slot={selecionada}
          onFechar={() => setSelecionada(null)}
          onScanRequest={onScanRequest}
          onOperate={onOperate}
        />
      )}
    </div>
  );
}
