// Tudo que vive DENTRO do `<Canvas>`: a cena, os lotes instanciados, a estrutura da
// planta, o realce do hover e a caminhada.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo, sem mudança de
// comportamento. O corte é por fronteira real: daqui para dentro é WebGL e `useFrame`;
// de lá para fora é HUD, estado e carregamento de dado.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxGeometry, MeshStandardMaterial, PerspectiveCamera, SRGBColorSpace, TextureLoader,
  MeshBasicMaterial, Vector3, type InstancedMesh, type Texture,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { ElementRef, MutableRefObject, RefObject } from 'react';
import type { Theme } from '../../../lib/useTheme';
import type { Slot } from '../../../lib/wms/warehouse3dSlots';
import {
  equipamentosDaExpedicao, faixasDaExpedicao, faixasDePiso, pecasDaFileira,
  placasDasFileiras, sapatasDasFileiras, LARGURA_DO_PREDIO,
  type BlocoFisico, type PecaDaFileira,
} from '../../../lib/wms/warehouse3dPlantaFisica';
import type { ContextoDeDestaque } from '../../../lib/wms/warehouse3dDestaque';
import { lotesDaPlanta, type InstanciaDeVao } from '../../../lib/wms/warehouse3dLotesDaPlanta';
import { deslizar, pontoDeEntrada, type CaixaPlana } from '../../../lib/wms/warehouse3dColisao';
import type { Ponto } from '../../../lib/wms/warehouse3dCoordenadas';
import { grausDeVisao, meiaAberturaHorizontal } from '../../../lib/wms/warehouse3dRadar';
import type { ParadaDaRota, Ponto3D, SubidaDaRota } from '../../../lib/wms/warehouse3dRota';
import type { AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';
import {
  ESTRUTURA,
  sapatasDosMontantes,
  type PecaDaEstrutura, type PecaInclinada,
} from '../../../lib/wms/warehouse3dEstrutura';
import { WarehouseEnvironment, type FundoDaCena } from '../WarehouseEnvironment';
import {
  ALTURA_DOS_OLHOS, ALTURA_DO_PALETE, ALTURA_DO_PISO_DO_VAO, CATALOGO, CORES_DE_ESTANTE,
  COR_ATENUADA, COR_BUILDER, COR_BUSCA, COR_GRADE, COR_PULSO,
  COR_REALCE, COR_VAGA, ESTANTES, PASSO_GRADE_BUILDER,
  RAIO_DO_CAMINHANTE, VELOCIDADE_A_PE, alturaDoCentro, corDaVaga,
  type FerramentaBuilder, type ModoCor, type ModoVisor, type ObjetoConstruido,
  type PecaDoCatalogo, type TipoConstruido, type TipoDeEstante,
} from './aparencia';
import {
  CAMADAS_NO_VAO, COR as COR_ESCRATCH, COR_DIVISAO_CAIXA, DESLOCA_CARGA, DESLOCA_PALETE,
  ESCALA, GEOMETRIA_ARESTAS_CAMADA, PONTOS_DO_CONTORNO,
  GEOMETRIA_CARGA,
  GEOMETRIA_MARCADOR, GEOMETRIA_PALETE, GEOMETRIA_TRAVESSA_RACK,
  GEOMETRIA_UNITARIA, GEOMETRIA_VAGA, GEOMETRIA_VIGA, MATERIAL_ALERTA,
  MATERIAL_CARGA_ATENUADA, MATERIAL_CARGA_PLANTA, MATERIAL_INVISIVEL,
  MATERIAIS_DA_ESTRUTURA, MATERIAL_MARCADOR, MATERIAL_PISO,
  MATERIAIS_DO_EQUIPAMENTO, MATERIAIS_DO_GALPAO,
  MATERIAL_DEMARCACAO, MATERIAL_PISO_ATENUADO, MATERIAL_PISO_FANTASMA, MATERIAL_RAIOX,
  MATERIAL_SOLIDO,
  MATERIAL_VIGA, MATRIZ, SEM_ACAO_APONTAR, SEM_ACAO_SELECIONAR, capacidadeDoLote,
  aplicarPecas, useArestasDeCaixas, useArestasFundidas,
  type PecaDeQuadro, type VagaDesenhavel,
} from './recursos3d';

// ── Cena ───────────────────────────────────────────────────────────────────────
//
// Todas as vagas têm a mesma dimensão, então a geometria é UMA, criada no módulo e
// compartilhada. Construir `new BoxGeometry(...)` dentro do componente alocaria um
// buffer de GPU a cada render, e o three não libera isso sozinho — é o vazamento
// clássico de cena react-three.

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
export function LoteInstanciado({
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
  // Capacidade com folga: a contagem varia DENTRO dela e só `.count` muda, sem remontar
  // o objeto de GPU a cada vaga que troca de status.
  const capacidade = capacidadeDoLote(vagas.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    vagas.forEach((vaga, i) => {
      MATRIZ.makeTranslation(vaga.posicao[0], vaga.posicao[1] + deslocamentoY, vaga.posicao[2]);
      malha.setMatrixAt(i, MATRIZ);
      if (!corUniforme) malha.setColorAt(i, COR_ESCRATCH.set(vaga.cor));
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
export function PulsoDeAlerta({ material, ativo }: { material: MeshStandardMaterial; ativo: boolean }) {
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
export function Vigas({ colunas }: { colunas: { x: number; z: number; altura: number }[] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(colunas.length);

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
 * A estante em si: o quadro (montantes e diagonais) e as travessas horizontais.
 *
 * Dois objetos de GPU para o armazém inteiro, não por vaga. A escala por instância é o
 * que permite peças de medidas diferentes dividirem um lote só — é o mesmo recurso que
 * os montantes de elevação já usam.
 *
 * ── Por que montante e diagonal moram no MESMO lote ─────────────────────────────
 * São a mesma peça de aço do ponto de vista do desenho: mesmo material, mesma cor. O
 * que as separa é só a matriz — a diagonal carrega um giro. Em lotes separados a
 * treliça custaria um desenho a mais por nada, e é exatamente assim que a planta física
 * já faz (`EstruturaDaPlanta`, lote `quadro`).
 *
 * Derivada do CONJUNTO de vagas, não de cada uma: o montante é compartilhado entre
 * vãos vizinhos e a travessa corre a rua inteira. Ver `warehouse3dEstrutura`.
 */
export function EstruturaDeRack({
  montantes,
  diagonais,
  travessas,
  theme,
}: {
  montantes: PecaDaEstrutura[];
  diagonais: PecaInclinada[];
  travessas: PecaDaEstrutura[];
  theme: Theme;
}) {
  const refQuadro = useRef<InstancedMesh>(null);
  const refTravessas = useRef<InstancedMesh>(null);
  // Pede o conjunto do tema em vez de pintar um material compartilhado: ninguém aqui pode
  // mais mudar a cor do aço de outro componente.
  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  /**
   * O quadro na forma que o desenho consome: três medidas e um giro.
   *
   * O montante entra convertido — ele é descrito por um comprimento só, porque se
   * estende num eixo conhecido, e aqui vira a caixa de seção quadrada que ele é.
   */
  const quadro = useMemo<PecaDeQuadro[]>(
    () => [
      ...montantes.map(peca => ({
        centro: peca.posicao,
        tamanho: [ESTRUTURA.montante, peca.comprimento, ESTRUTURA.montante] as Ponto,
      })),
      ...diagonais,
      // Sapata no MESMO lote: é aço da mesma cor do montante que ela sustenta, então ela
      // entra sem custar uma chamada de desenho. Derivada dos montantes, nunca recalculada
      // — sapata que não nasce debaixo de um montante é sapata no lugar errado.
      ...sapatasDosMontantes(montantes),
    ],
    [montantes, diagonais],
  );

  useEffect(() => { aplicarPecas(refQuadro.current, quadro); }, [quadro]);

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
        ref={refQuadro}
        args={[GEOMETRIA_UNITARIA, materiais.coluna, capacidadeDoLote(quadro.length)]}
      />
      <instancedMesh
        ref={refTravessas}
        args={[GEOMETRIA_TRAVESSA_RACK, materiais.travessa, capacidadeDoLote(travessas.length)]}
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
export function MarcadoresDeGiro({ pontos }: { pontos: [number, number, number][] }) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(pontos.length);

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
export function SondaDeCamera({
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
export function CapturadorDeCena({ registrar }: { registrar: (fn: (() => string) | null) => void }) {
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
export interface DestinoDeCamera {
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
export function PanSuave({
  controlsRef,
  destinoRef,
  aoParar,
}: {
  controlsRef: RefObject<ElementRef<typeof OrbitControls>>;
  destinoRef: MutableRefObject<DestinoDeCamera | null>;
  /**
   * Avisa que a transição acabou — por chegada ou por cancelamento.
   *
   * Existe porque o destino mora num REF, e com `frameloop="demand"` quem não aparece no
   * estado do React não mantém o laço vivo: sem este aviso, a tela não teria como saber
   * que precisa continuar desenhando enquanto a câmera voa, nem quando pode parar.
   */
  aoParar?: () => void;
}) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cancelar = () => {
      destinoRef.current = null;
      aoParar?.();
    };
    controls.addEventListener('start', cancelar);
    return () => controls.removeEventListener('start', cancelar);
  }, [controlsRef, destinoRef, aoParar]);

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
      aoParar?.();
    }
  });

  return null;
}

export interface PlacaDeRua {
  rotulo: string;
  x: number;
  y: number;
  z: number;
  /** Posições de palete da rua, quando a vista souber contá-las. A placa anuncia o
   *  TAMANHO da rua, não só o nome dela — é o que diz se vale entrar por aqui. */
  posicoes?: number;
  /** Rua fora do filtro: a placa continua no lugar, apagada. Sumir com ela faria o
   *  galpão perder a referência justamente quando se está isolando uma rua. */
  atenuada?: boolean;
}

/**
 * Sinalização aérea: a placa que diz em que corredor você está.
 *
 * UMA para as duas vistas. A vista da planta tinha a sua, com cor fora do sistema de
 * tokens e encolhendo com a perspectiva; a vista por código tinha esta. Era a mesma
 * informação desenhada de dois jeitos — e "duas descrições do mesmo galpão" é
 * exatamente o que este mapa existe para não ser.
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
/**
 * Distância da câmera ao centro da cena, em metros, a partir da qual a placa encolhe
 * para só a letra e sobra uma por rua.
 *
 * MEDIDO, não estimado. No enquadramento inicial do galpão de 45 m, as oito ruas ocupam
 * cerca de 110 px de largura na tela — 15 px entre uma placa e a vizinha. Com dezesseis
 * placas de 95 px nesse espaço deram 22 sobreposições: texto legível, cada um por cima
 * do outro, que é tão inútil quanto texto pequeno demais.
 *
 * A raiz é geométrica e não tem saída por tamanho de fonte: oito rótulos legíveis não
 * cabem em 110 px. Escalar com a perspectiva (o `distanceFactor` que isto usava antes)
 * resolve a sobreposição e devolve o borrão de 6 px, porque placa legível de longe é
 * placa gigante de perto. Então o que muda com a distância é o QUE a placa diz: de longe
 * a letra basta para situar a rua no galpão; de perto, onde há espaço, ela diz tudo.
 */
const DISTANCIA_DA_PLACA_COMPLETA = 28;

export function PlacasDeRua({ placas }: { placas: PlacaDeRua[] }) {
  const camera = useThree(estado => estado.camera);
  const [longe, setLonge] = useState(true);

  // `useFrame` em `frameloop="demand"` roda só nos quadros desenhados, e a câmera só se
  // move em quadro desenhado — então isto não acorda o laço. O `setState` dispara apenas
  // na TROCA de regime, não a cada quadro: sem essa comparação, orbitar re-renderizaria
  // as placas sessenta vezes por segundo para desenhar exatamente a mesma coisa.
  useFrame(() => {
    const agora = camera.position.length() > DISTANCIA_DA_PLACA_COMPLETA;
    if (agora !== longe) setLonge(agora);
  });

  // De longe, UMA por rua. Qual delas é escolhido pela ordem da lista, não pela proximidade
  // da câmera: "a ponta mais perto" mudaria a cada giro e traria de volta o re-render por
  // quadro que o parágrafo acima acabou de evitar.
  const visiveis = useMemo(() => {
    if (!longe) return placas;
    const vistas = new Set<string>();
    return placas.filter(placa => {
      const rua = `${placa.rotulo}-${placa.x}`;
      if (vistas.has(rua)) return false;
      vistas.add(rua);
      return true;
    });
  }, [longe, placas]);

  return (
    <>
      {visiveis.map(placa => (
        <Html
          key={`${placa.rotulo}-${placa.x}-${placa.z}`}
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
          <div
            className="inline-flex w-max max-w-none items-center gap-1.5 whitespace-nowrap rounded-control border border-white/25 bg-rail px-1.5 py-0.5 text-code text-[10px] font-semibold leading-none tracking-wide text-rail-fg shadow-panel"
            // Fora do filtro a placa recua em vez de sumir: ela é a única coisa na cena
            // que diz onde a rua isolada está em relação às outras.
            style={placa.atenuada ? { opacity: 0.35 } : undefined}
          >
            {/* De longe só a letra. "RUA" é a mesma palavra nas oito placas e não
                distingue nada — é justamente o que se corta primeiro quando falta
                espaço. O `title` segue completo para quem passa o mouse. */}
            <span title={`Rua ${placa.rotulo}`}>{longe ? placa.rotulo : `RUA ${placa.rotulo}`}</span>
            {/* Separador e contagem em peso menor: o nome da rua é o assunto, o
                tamanho dela é o detalhe. */}
            {!longe && placa.posicoes !== undefined && (
              <span className="font-normal opacity-70">{placa.posicoes} pos.</span>
            )}
          </div>
        </Html>
      ))}
    </>
  );
}

/** O que a cena precisa para desenhar a rota. Montado fora, por `useMemo`. */
export interface RotaDesenhavel {
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
export function RotaDeColeta({ rota }: { rota: RotaDesenhavel }) {
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

/**
 * A cena, memoizada.
 *
 * `React.memo` aqui só passou a valer depois que o realce saiu das props: enquanto
 * `realce` chegava por prop, ele mudava a cada movimento do mouse e a memoização não
 * segurava nada. Com o hover num canal próprio, todas as props são memos ou callbacks
 * estáveis — então mover o mouse deixou de reconciliar a cena.
 */
// ── Props agrupadas ──────────────────────────────────────────────────────────────
//
// Eram 36 soltas, e a assinatura não dizia o que andava junto. Agrupadas por assunto, o
// grupo vira a unidade de leitura — e a desestruturação logo abaixo mantém os nomes que o
// corpo já usava, para o agrupamento não virar também uma renomeação.

/** Os lotes de vaga, já classificados pelo filtro e pelo status. */
export interface VagasDaCena {
  solidas: VagaDesenhavel[];
  divergentes: VagaDesenhavel[];
  raioX: VagaDesenhavel[];
  fiosAtivos: VagaDesenhavel[];
  /** Vaga livre FORA do filtro. Desenhada como contorno apagado. */
  fiosAtenuados: VagaDesenhavel[];
  /** Vagas com carga, dentro e fora do filtro: o palete existe nas duas. */
  comCarga: VagaDesenhavel[];
  achadas: VagaDesenhavel[];
}

/** O aço: o que a estante tem de fixo, independente de filtro ou modo de cor. */
export interface EstruturaDaCena {
  colunas: { x: number; z: number; altura: number }[];
  montantes: PecaDaEstrutura[];
  diagonais: PecaInclinada[];
  travessas: PecaDaEstrutura[];
  placas: PlacaDeRua[];
}

/** O galpão em volta e o referencial em que tudo é desenhado. */
export interface CenarioDaCena {
  fundo: FundoDaCena;
  chaveDeSombra: string;
  extensao: number;
  deslocamento: [number, number, number];
  /**
   * Offset da vista ATIVA. Igual a `deslocamento` na vista por código; o offset da planta
   * quando ela está desenhada. Rota e marcadores vivem nele, porque suas coordenadas
   * passaram a ser resolvidas pela vista ativa.
   */
  deslocamentoAtivo: [number, number, number];
  plantaNoPiso: PlantaNoPiso | null;
}

/** O Modo Edição. Nada aqui existe fora dele. */
export interface BuilderDaCena {
  modoVisor: ModoVisor;
  ferramenta: FerramentaBuilder;
  estanteEscolhida: TipoDeEstante;
  objetos: ObjetoConstruido[];
  selecionadoNoBuilder: string | null;
  onConstruir: (x: number, z: number) => void;
  onSelecionarObjeto: (id: string) => void;
  onGirarObjeto: (id: string) => void;
  onExcluirObjeto: (id: string) => void;
}

/** Quem aponta, quem clica e quem está caminhando. */
export interface InteracaoDaCena {
  /** Canal do hover. Função estável, para o realce assinar sem forçar re-render. */
  assinarHover: (ouvinte: (slot: Slot | null) => void) => () => void;
  selecionada: Slot | null;
  /**
   * Contorno da vaga apontada na vista ATIVA — onde ela está e quanto mede.
   *
   * Função, e não lista: a grade devolve a caixa fixa da vaga e a planta devolve o vão
   * daquela fileira, que muda de medida de rua para rua.
   */
  contornoDaVaga: (slot: Slot) => { centro: Ponto; tamanho: Ponto } | null;
  /** Com o ponteiro travado, clique e hover saem de cena — ver `SEM_ACAO`. */
  caminhando: boolean;
  onHover: (slot: Slot | null) => void;
  onSelect: (slot: Slot) => void;
}

/** Tudo que a planta física precisa, ou null quando a vista por código está ligada. */
export interface PlantaDaCena {
  blocos: BlocoFisico[];
  mesas: BlocoFisico[];
  /** Comprimento total em metros, já calculado a partir das medidas carregadas. */
  comprimento: number;
  vagasPorCodigo: Map<string, Slot>;
  modoCor: ModoCor;
  maxCaixas: number;
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>;
  /** Filtro de rua, filtro de status, busca e pulso — o mesmo da vista por código. */
  destaque: ContextoDeDestaque;
}

export const Cena = memo(function Cena({
  vagas,
  estrutura,
  cenario,
  builder,
  interacao,
  plantaFisica,
  rota,
  marcadores,
  theme,
}: {
  vagas: VagasDaCena;
  estrutura: EstruturaDaCena;
  cenario: CenarioDaCena;
  builder: BuilderDaCena;
  interacao: InteracaoDaCena;
  plantaFisica: PlantaDaCena | null;
  rota: RotaDesenhavel | null;
  marcadores: [number, number, number][];
  theme: Theme;
}) {
  const { solidas, divergentes, raioX, fiosAtivos, fiosAtenuados, comCarga, achadas } = vagas;
  const { colunas, montantes, diagonais, travessas, placas } = estrutura;
  const { fundo, chaveDeSombra, extensao, deslocamento, deslocamentoAtivo, plantaNoPiso } = cenario;
  const {
    modoVisor, ferramenta, estanteEscolhida, objetos, selecionadoNoBuilder,
    onConstruir, onSelecionarObjeto, onGirarObjeto, onExcluirObjeto,
  } = builder;
  const { assinarHover, selecionada, contornoDaVaga, caminhando, onHover, onSelect } = interacao;
  const [centro, linha] = COR_GRADE[theme];

  // O HUD promete que, caminhando, clicar não abre vaga. Até aqui era só texto: os lotes
  // seguiam com `onClick` registrado, e com o ponteiro travado o raycast usa a última
  // posição conhecida — ou seja, dava para abrir uma vaga sem querer, mirando no nada.
  // Trocar os handlers por funções estáveis que não fazem nada é o que cumpre a promessa.
  const aoSelecionar = caminhando ? SEM_ACAO_SELECIONAR : onSelect;
  const aoApontar = caminhando ? SEM_ACAO_APONTAR : onHover;
  const arestasDaCarga = useArestasFundidas(solidas, GEOMETRIA_ARESTAS_CAMADA, CAMADAS_NO_VAO);
  const arestasAchadas = useArestasFundidas(achadas);
  // Vaga livre volta a ter contorno. `fundirArestas` sempre esteve aqui para isto — o
  // lote vinha sendo calculado e nunca chegava à cena, e o resultado é que a legenda
  // contava "Livre 207" sem nenhuma delas aparecer no desenho.
  const arestasLivres = useArestasFundidas(fiosAtivos);
  const arestasLivresAtenuadas = useArestasFundidas(fiosAtenuados);

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

      {/* Grade de construção. Separada da grade decorativa acima de propósito: aquela
          só existe no fundo "limpo" e serve para não perder a noção de chão ao orbitar;
          esta precisa aparecer TAMBÉM dentro do galpão, porque é nela que se mira para
          posicionar estrutura. Fica 1 cm acima do piso para não brigar por z-fighting
          com a laje do cenário. */}
      {/* Fora do bloco de Modo Edição: a planta é referência dos DOIS modos — no
          operacional ela diz onde a vaga fica no galpão de verdade. */}
      {plantaNoPiso && <PlantaDesenhadaNoPiso planta={plantaNoPiso} theme={theme} />}

      {plantaFisica && (
        <PlantaFisica3D
          blocos={plantaFisica.blocos}
          mesas={plantaFisica.mesas}
          comprimento={plantaFisica.comprimento}
          vagasPorCodigo={plantaFisica.vagasPorCodigo}
          modoCor={plantaFisica.modoCor}
          maxCaixas={plantaFisica.maxCaixas}
          abcPorVaga={plantaFisica.abcPorVaga}
          destaque={plantaFisica.destaque}
          theme={theme}
          onSelecionarVaga={aoSelecionar}
          onApontarVaga={aoApontar}
        />
      )}

      {/* Rota e marcador de giro valem para as DUAS vistas, então saíram de dentro do
          grupo da grade por código e passaram a viver no offset da vista ativa. Suas
          coordenadas já vêm resolvidas pela vista que está na tela; o que muda aqui é só
          onde o grupo é centrado. */}
      <group position={deslocamentoAtivo}>
        {/* Alerta de giro. Lista vazia fora do modo Curva ABC — e vazia também dentro
            dele quando não há item de alto giro em nível elevado, que é o resultado
            correto e não uma falha de carregamento. */}
        <MarcadoresDeGiro pontos={marcadores} />
        {rota && <RotaDeColeta rota={rota} />}

        {/* Realce da vaga sob o cursor (ou da selecionada). Um objeto só, desenhado por
            cima — contorno por instância não existe em InstancedMesh, e emitir um objeto
            extra apenas para o item apontado custa muito menos que abrir mão do lote.
            Vive AQUI, e não dentro de uma das vistas: apontar uma vaga acontece nas duas,
            e enquanto ele morava no ramo da grade a planta — que é o padrão da tela —
            recebia o hover, trocava o cursor e não desenhava contorno nenhum.
            Componente próprio, assinando o canal de hover: o movimento do mouse
            re-renderiza este contorno e mais nada. */}
        <RealceDaVaga
          assinar={assinarHover}
          selecionada={selecionada}
          contornoDe={contornoDaVaga}
          theme={theme}
        />
      </group>

      {modoVisor === 'edicao' && (
        <>
          <gridHelper
            args={[
              Math.ceil(extensao / PASSO_GRADE_BUILDER) * PASSO_GRADE_BUILDER,
              Math.ceil(extensao / PASSO_GRADE_BUILDER),
              linha,
              linha,
            ]}
            position={[0, 0.01, 0]}
          />
          <Construcao
            ferramenta={ferramenta}
            estanteEscolhida={estanteEscolhida}
            objetos={objetos}
            selecionado={selecionadoNoBuilder}
            extensao={extensao}
            theme={theme}
            onConstruir={onConstruir}
            onSelecionar={onSelecionarObjeto}
            onGirar={onGirarObjeto}
            onExcluir={onExcluirObjeto}
          />
        </>
      )}

      {/* As vagas montadas pelo CÓDIGO. Saem de cena enquanto a planta física está
          desenhada: as duas juntas foi o que produziu o mapa errado por cima do desenho
          certo — grade regular atravessando fileira posicionada por medida. */}
      {!plantaFisica && (
      <group position={deslocamento}>
        {/* Montantes, quando o pulmão é suspenso. */}
        <Vigas colunas={colunas} />

        {/* Sinalização aérea do corredor. */}
        <PlacasDeRua placas={placas} />

        {/* A estante física. Vem antes da carga para o pallet ser desenhado dentro do
            vão que ela delimita. */}
        <EstruturaDeRack
          montantes={montantes}
          diagonais={diagonais}
          travessas={travessas}
          theme={theme}
        />

        {/* Paletes de madeira sob toda vaga com carga — inclusive as que estão fora do
            filtro: a estrutura não é filtrada, só o que ela guarda. */}
        <LoteInstanciado
          vagas={comCarga}
          material={MATERIAIS_DA_ESTRUTURA[theme].palete}
          geometria={GEOMETRIA_PALETE}
          deslocamentoY={DESLOCA_PALETE}
          corUniforme
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Vagas com conteúdo: um único objeto de GPU para todas. */}
        <LoteInstanciado
          vagas={solidas}
          material={MATERIAL_SOLIDO}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Divisão entre as duas camadas de caixas do pallet, e o contorno externo. É o
            que faz o bloco ser lido como CAIXAS empilhadas em vez de um volume sólido. */}
        <lineSegments geometry={arestasDaCarga}>
          <lineBasicMaterial color={COR_DIVISAO_CAIXA[theme]} transparent opacity={0.55} />
        </lineSegments>

        {/* Divergências em lote próprio, para poderem pulsar sem arrastar o resto. */}
        <PulsoDeAlerta material={MATERIAL_ALERTA} ativo={divergentes.length > 0} />
        <LoteInstanciado
          vagas={divergentes}
          material={MATERIAL_ALERTA}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Raio-X: vaga com carga que ficou FORA do filtro vira vidro em vez de sumir.
            É o que deixa ver a posição exata do alerta no meio da estante, sem perder a
            noção de onde ele está. O filtro isola, não amputa. */}
        <LoteInstanciado
          vagas={raioX}
          material={MATERIAL_RAIOX}
          geometria={GEOMETRIA_CARGA}
          deslocamentoY={DESLOCA_CARGA}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* Apanhador de clique das vagas livres. A carga não existe aqui, e a estante é
            um objeto só — sem isto o raycast não saberia QUAL vão foi apontado. As
            instâncias cobrem o vão INTEIRO, não só a carga, para a vaga vazia continuar
            clicável. `opacity: 0` em vez de `visible={false}` porque o three não faz
            raycast em objeto invisível. */}
        <LoteInstanciado
          vagas={fiosAtivos}
          material={MATERIAL_INVISIVEL}
          onHover={aoApontar}
          onSelect={aoSelecionar}
        />

        {/* O CONTORNO da vaga livre: o vão vazio da estante, desenhado como aresta.
            Dois lotes, e não um, porque a cor é uniforme dentro de cada geometria
            fundida: o que está no filtro sai na cor de "livre" da legenda, o que ficou
            de fora sai no cinza de fundo. Sem `depthTest={false}` de propósito — o
            contorno é geometria do armazém e deve ser escondido pelo que está na
            frente, ao contrário do realce e dos achados. */}
        <lineSegments geometry={arestasLivres}>
          <lineBasicMaterial color={COR_VAGA[theme].empty} transparent opacity={0.75} />
        </lineSegments>
        <lineSegments geometry={arestasLivresAtenuadas}>
          <lineBasicMaterial color={COR_ATENUADA[theme]} transparent opacity={0.45} />
        </lineSegments>

        {/* Contorno dos resultados da busca, por cima do vidro. É o que faz o produto
            procurado saltar mesmo quando está no fundo da estante. */}
        <lineSegments geometry={arestasAchadas} renderOrder={1}>
          <lineBasicMaterial color={COR_BUSCA} depthTest={false} />
        </lineSegments>

      </group>
      )}
    </>
  );
});


// ── Painel de detalhe ──────────────────────────────────────────────────────────

/**
 * A planta reproduzida em três dimensões, a partir das MEDIDAS.
 *
 * Diferença de origem, e é a diferença que importa: as vagas por código produzem uma
 * grade regular (rua × 4 m, módulo × 1,3 m) que não tem como coincidir com o desenho,
 * porque `PP-E03-N1` não diz onde a rua E fica no prédio. Aqui cada fileira vem com
 * lugar, comprimento e direção lidos da planta, então ela cai em cima do desenho.
 *
 * Os blocos chegam com a origem no canto (X 0→10,3, Z 0→45,2) e são centrados aqui, no
 * mesmo referencial em que a imagem da planta é desenhada — é isso que faz as duas
 * coisas se sobreporem em vez de flutuarem uma sobre a outra.
 */
/**
 * A estrutura da planta: quadros e longarinas, como DOIS objetos de GPU.
 *
 * Antes era um `<mesh>` por peça — 274 deles no térreo. Com a diagonal de
 * contraventamento entrando seriam 604, e o custo não é teórico: cada malha é uma
 * chamada de desenho por quadro. Instanciando, as 604 peças viram duas chamadas, e o
 * número para de crescer quando o galpão crescer.
 *
 * MONTANTE E DIAGONAL DIVIDEM A MALHA porque dividem a cor: no galpão o quadro é uma
 * peça só, pintada de uma cor só, e a longarina é que destaca em laranja. Separá-los
 * por tipo daria dois azuis idênticos em dois objetos.
 *
 * Os materiais são os MESMOS da vista por código, de propósito. Cor própria aqui faria
 * a mesma estante aparecer de duas cores conforme a aba aberta — duas descrições do
 * mesmo galpão é exatamente o que este mapa existe para não ser.
 */
export function EstruturaDaPlanta({ pecas, theme }: { pecas: PecaDaFileira[]; theme: Theme }) {
  const refQuadro = useRef<InstancedMesh>(null);
  const refLongarinas = useRef<InstancedMesh>(null);

  // Montante, diagonal E SAPATA no mesmo lote: as três são a mesma peça de aço pintada da
  // mesma cor, e a sapata entra sem custar uma chamada de desenho nova.
  const quadro = useMemo<PecaDeQuadro[]>(
    () => [...pecas.filter(p => p.tipo !== 'viga'), ...sapatasDasFileiras(pecas)],
    [pecas],
  );
  const longarinas = useMemo(() => pecas.filter(p => p.tipo === 'viga'), [pecas]);

  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  useEffect(() => { aplicarPecas(refQuadro.current, quadro); }, [quadro]);
  useEffect(() => { aplicarPecas(refLongarinas.current, longarinas); }, [longarinas]);

  return (
    <>
      <instancedMesh
        ref={refQuadro}
        args={[GEOMETRIA_UNITARIA, materiais.coluna, capacidadeDoLote(quadro.length)]}
      />
      <instancedMesh
        ref={refLongarinas}
        args={[GEOMETRIA_UNITARIA, materiais.travessa, capacidadeDoLote(longarinas.length)]}
      />
    </>
  );
}

/**
 * Um lote de peças de CENÁRIO: tinta no chão, zebrado, sapata, equipamento.
 *
 * Um `InstancedMesh` por material, não um `<mesh>` por peça. A demarcação são nove faixas
 * hoje, o zebrado são trinta e poucos traços e a empilhadeira são oito caixas cada — somadas
 * seriam dezenas de chamadas de desenho para coisas que não carregam dado nenhum. Como
 * nada aqui tem cor por instância, cada grupo cabe num objeto de GPU só e o custo para de
 * crescer junto com o galpão.
 *
 * Caixa achatada em vez de `planeGeometry` para a tinta: o plano tem face única e some
 * visto de baixo, e quem caminha passa com os olhos a 1,65 m — rasante o bastante para a
 * marcação desaparecer justo no ângulo em que ela é a referência mais útil.
 */
export function LoteDoCenario({
  pecas,
  material,
}: {
  pecas: PecaDeQuadro[];
  material: MeshStandardMaterial;
}) {
  const malha = useRef<InstancedMesh>(null);
  useEffect(() => { aplicarPecas(malha.current, pecas); }, [pecas]);

  return (
    <instancedMesh
      ref={malha}
      args={[GEOMETRIA_UNITARIA, material, capacidadeDoLote(pecas.length)]}
    />
  );
}

/**
 * O canal do hover: quem aponta avisa, quem desenha escuta.
 *
 * Existe para tirar `apontada` do estado do componente de cima. Com ele lá, cada
 * movimento do mouse re-renderizava o visualizador inteiro — e, na planta, os ~1.245
 * elementos React dos vãos junto. O dado do hover muda dezenas de vezes por segundo e
 * interessa a UM desenho: o contorno da vaga apontada.
 */
export interface CanalDeHover {
  atual: Slot | null;
  ouvintes: Set<(slot: Slot | null) => void>;
}

/**
 * Contorno da vaga sob o cursor, desenhado por fora do ciclo de render do visualizador.
 *
 * Assina o canal e guarda o próprio estado: por movimento de mouse re-renderiza só este
 * componente. A vaga SELECIONADA continua vindo por prop — ela muda por clique, não por
 * movimento, e um render a mais ali não custa nada.
 */
export function RealceDaVaga({
  assinar,
  selecionada,
  contornoDe,
  theme,
}: {
  assinar: (ouvinte: (slot: Slot | null) => void) => () => void;
  selecionada: Slot | null;
  /**
   * O contorno da vaga na vista ATIVA: onde ela está e quanto mede, em coordenada local.
   *
   * Injetado porque as duas vistas respondem diferente — a grade devolve a caixa fixa da
   * vaga, a planta devolve o vão real daquela fileira. Antes isto era uma lista de vagas
   * da grade, e por isso o realce não existia na planta: a lista não a descrevia, e o
   * componente nem chegava a ser montado lá.
   */
  contornoDe: (slot: Slot) => { centro: Ponto; tamanho: Ponto } | null;
  theme: Theme;
}) {
  const [apontada, setApontada] = useState<Slot | null>(null);

  useEffect(() => assinar(setApontada), [assinar]);

  const alvo = apontada ?? selecionada;
  const contorno = alvo ? contornoDe(alvo) : null;

  return (
    // Arestas de um cubo de 1 m, ESCALADAS: o vão muda de medida por fileira, e um
    // contorno de tamanho fixo desenharia a caixa de uma rua em cima de outra.
    //
    // ── Por que `<Line>` e não `lineSegments` ──────────────────────────────────
    // O `linewidth` do `lineBasicMaterial` é IGNORADO em WebGL: a linha sai sempre com
    // 1 pixel físico, qualquer que seja o valor. Num monitor de densidade 2 isso é meio
    // pixel de tela, e o realce da vaga — que é o que diz "é esta aqui" — ficava mais
    // fino que as arestas da própria estante. O `<Line>` do drei desenha a linha como
    // geometria (Line2), então a espessura vale de verdade.
    //
    // Largura em PIXELS, não em metros: o contorno é sinalização de interface, não peça
    // do armazém. Em metros ele engrossaria ao aproximar e sumiria ao afastar, que é o
    // oposto do que se quer de um indicador.
    //
    // ── Por que não desmonta quando não há alvo ────────────────────────────────
    // `visible` em vez de `return null`: o `<Line>` aloca geometria e material próprios,
    // e desmontar a cada entrada e saída do mouse faria alocação de GPU a cada
    // movimento. Invisível, ele não custa desenho nenhum.
    <Line
      points={PONTOS_DO_CONTORNO}
      segments
      visible={!!contorno}
      position={contorno?.centro ?? ORIGEM}
      scale={contorno?.tamanho ?? UNIDADE}
      color={COR_REALCE[theme]}
      lineWidth={2}
      depthTest={false}
      renderOrder={1}
    />
  );
}

/** Pousos do contorno quando não há vaga apontada. Constantes para a referência ser
 *  estável e não disparar atualização de matriz a cada render. */
const ORIGEM: Ponto = [0, 0, 0];
const UNIDADE: Ponto = [1, 1, 1];

/**
 * Um lote de vãos da planta como UM objeto de GPU.
 *
 * Mesmo recurso do `LoteInstanciado` da vista por código, com uma diferença que obriga a
 * ter os dois: aqui a ESCALA vai por instância. O passo do vão muda por fileira — a rua A
 * tem 13 posições em 15,6 m e a rua E tem 12 em 15 m —, então a geometria é um cubo
 * unitário e a matriz carrega tamanho junto com posição.
 *
 * `instancias` sem handler (o lote fantasma) não recebe clique: ali o lugar existe no
 * desenho e não há vaga para receber mercadoria.
 */
export function LoteDeVaos({
  instancias,
  material,
  corPorInstancia = true,
  vagasPorCodigo,
  onSelecionarVaga,
  onApontarVaga,
}: {
  instancias: InstanciaDeVao[];
  material: MeshStandardMaterial;
  /** O palete é madeira em todo o armazém: a cor vem do material, não da instância. */
  corPorInstancia?: boolean;
  vagasPorCodigo?: ReadonlyMap<string, Slot>;
  onSelecionarVaga?: (slot: Slot) => void;
  onApontarVaga?: (slot: Slot | null) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const capacidade = capacidadeDoLote(instancias.length);

  useEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    instancias.forEach((inst, i) => {
      // Escala primeiro, posição depois: `setPosition` não mexe na parte linear.
      MATRIZ.identity();
      MATRIZ.scale(ESCALA.set(inst.tamanho[0], inst.tamanho[1], inst.tamanho[2]));
      MATRIZ.setPosition(inst.centro[0], inst.centro[1], inst.centro[2]);
      malha.setMatrixAt(i, MATRIZ);
      if (corPorInstancia) malha.setColorAt(i, COR_ESCRATCH.set(inst.cor));
    });
    malha.count = instancias.length;
    malha.instanceMatrix.needsUpdate = true;
    if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  }, [instancias, corPorInstancia]);

  const vagaDe = (id: number | undefined): Slot | null => {
    if (id === undefined || !vagasPorCodigo) return null;
    const codigo = instancias[id]?.codigo;
    return codigo ? vagasPorCodigo.get(codigo) ?? null : null;
  };

  const interativo = !!vagasPorCodigo && (!!onSelecionarVaga || !!onApontarVaga);

  return (
    <instancedMesh
      ref={ref}
      args={[GEOMETRIA_UNITARIA, material, capacidade]}
      // `onPointerMove` e não `onPointerOver`: o lote inteiro é UM objeto, então "entrar"
      // dispara uma vez só — é o movimento que revela a troca de instância.
      onPointerMove={
        interativo
          ? e => {
              e.stopPropagation();
              onApontarVaga?.(vagaDe(e.instanceId));
            }
          : undefined
      }
      onPointerOut={interativo ? () => onApontarVaga?.(null) : undefined}
      onClick={
        interativo
          ? e => {
              const slot = vagaDe(e.instanceId);
              if (!slot) return;
              e.stopPropagation();
              onSelecionarVaga?.(slot);
            }
          : undefined
      }
    />
  );
}

export function PlantaFisica3D({
  blocos,
  mesas,
  comprimento,
  vagasPorCodigo,
  modoCor,
  maxCaixas,
  abcPorVaga,
  destaque,
  theme,
  onSelecionarVaga,
  onApontarVaga,
}: {
  blocos: BlocoFisico[];
  mesas: BlocoFisico[];
  /** Comprimento total do conjunto, em metros — é por ele que a cena é centrada. */
  comprimento: number;
  /** Vaga real de cada código, para o vão saber o que mostrar e o clique saber o que abrir. */
  vagasPorCodigo: Map<string, Slot>;
  modoCor: ModoCor;
  /** Os mesmos dois que a vista por código usa, para as cores não divergirem entre elas. */
  maxCaixas: number;
  abcPorVaga: ReadonlyMap<string, AbcDaVaga>;
  /**
   * Filtro de rua, filtro de status, busca e pulso de tempo real — o MESMO contexto que
   * a vista por código aplica. Antes só o filtro de rua chegava aqui, e por isso buscar
   * um SKU dizia "3 vagas encontradas" sem acender nada na cena.
   */
  destaque: ContextoDeDestaque;
  theme: Theme;
  onSelecionarVaga: (slot: Slot) => void;
  onApontarVaga: (slot: Slot | null) => void;
}) {
  const cores = COR_BUILDER[theme];
  const largura = LARGURA_DO_PREDIO;

  // Todas as peças de todas as fileiras, num conjunto só: é o que permite desenhá-las
  // como duas instâncias em vez de centenas de malhas.
  const pecasDaEstrutura = useMemo(
    () => blocos.filter(b => b.tipo === 'fileira').flatMap(b => pecasDaFileira(b)),
    [blocos],
  );

  const fileiras = useMemo(() => blocos.filter(b => b.tipo === 'fileira'), [blocos]);
  const demarcacoes = useMemo(() => blocos.filter(b => b.tipo === 'expedicao'), [blocos]);

  /**
   * Os vãos agrupados nos sete lotes.
   *
   * A paleta entra resolvida e a cor do modo entra como função: a regra de precedência
   * mora no módulo puro, a paleta mora aqui, e nenhuma das duas precisa da outra para ser
   * conferida.
   */
  const lotes = useMemo(
    () =>
      lotesDaPlanta(
        fileiras,
        vagasPorCodigo,
        destaque,
        {
          pulso: COR_PULSO,
          busca: COR_BUSCA,
          atenuada: COR_ATENUADA[theme],
          fantasma: cores.peca,
        },
        slot => corDaVaga(slot, modoCor, theme, maxCaixas, abcPorVaga),
        { alturaDoPalete: ALTURA_DO_PALETE, alturaDoPiso: ALTURA_DO_PISO_DO_VAO },
      ),
    [fileiras, vagasPorCodigo, destaque, theme, cores.peca, modoCor, maxCaixas, abcPorVaga],
  );

  // Conjunto do tema, sem mutar material nenhum.
  const materiais = MATERIAIS_DA_ESTRUTURA[theme];

  /** A tinta do pé de cada fileira. Vista de cima, estante e corredor têm o mesmo chão
   *  cinza e nada diz onde um acaba; com o pé pintado, o corredor passa a ser o que
   *  sobrou entre duas marcações. Aritmética pura, conferida por teste. */
  const faixas = useMemo(() => faixasDePiso(fileiras), [fileiras]);

  /** Placas das duas pontas de cada rua, apagadas quando a rua está fora do filtro. */
  const placas = useMemo<PlacaDeRua[]>(
    () =>
      placasDasFileiras(fileiras).map(placa => ({
        ...placa,
        atenuada:
          destaque.ruasSelecionadas.size > 0 && !destaque.ruasSelecionadas.has(placa.rotulo),
      })),
    [fileiras, destaque.ruasSelecionadas],
  );

  /** Contorno em duas camadas das cargas em destaque — escalado por caixa, porque o vão
   *  muda de medida de fileira para fileira. */
  const arestasDaCarga = useArestasDeCaixas(lotes.cargaDestaque, 2);

  /** Zebrado de advertência em volta da área de manobra. */
  const zebrado = useMemo(() => faixasDaExpedicao(blocos), [blocos]);

  /** As duas empilhadeiras estacionadas na doca. Existem para dar ESCALA: um rack de
   *  4,2 m só parece 4,2 m ao lado de algo cujo tamanho o olho já conhece. */
  const equipamentos = useMemo(() => equipamentosDaExpedicao(blocos), [blocos]);

  return (
    <group position={[-largura / 2, 0, -comprimento / 2]}>
      {/* A tinta que delimita o pé das fileiras. Um objeto de GPU para todas elas. */}
      <LoteDoCenario pecas={faixas} material={MATERIAL_DEMARCACAO[theme]} />

      {/* Demarcação de solo continua sendo um plano: expedição é tinta no chão.
          A opacidade caiu de 0,5 para 0,28 porque o zebrado passou a carregar a leitura
          da área: com os dois no mesmo peso, 74 m² de âmbar chapado abafavam os traços
          que de fato dizem "aqui manobra empilhadeira". */}
      {demarcacoes.map(b => (
        <mesh key={b.id} position={b.centro}>
          <boxGeometry args={b.tamanho} />
          <meshStandardMaterial color={cores.doca} roughness={0.9} metalness={0} transparent opacity={0.28} />
        </mesh>
      ))}

      {/* Zebrado de advertência e as duas empilhadeiras da doca: três objetos de GPU para
          tudo. O amarelo é o de MARCAÇÃO de solo, que esta cena já declara não-semântico —
          o amarelo de empilhadeira de verdade é vizinho do âmbar de "acima da capacidade",
          e um equipamento quase da cor do alerta apaga o alerta. */}
      <LoteDoCenario pecas={zebrado} material={MATERIAIS_DO_GALPAO[theme].zebrado} />
      <LoteDoCenario pecas={equipamentos.corpo} material={MATERIAIS_DO_EQUIPAMENTO[theme].corpo} />
      <LoteDoCenario pecas={equipamentos.aco} material={MATERIAIS_DO_EQUIPAMENTO[theme].aco} />

      {/* A fileira é DECOMPOSTA em quadro (montantes + diagonais) e longarinas. Caixa
          cheia no lugar disso vira muro: some o vão onde o palete entra e some a leitura
          de quantas posições a rua tem. Porta-pallets vazio é quase todo ar. */}
      <EstruturaDaPlanta pecas={pecasDaEstrutura} theme={theme} />

      {/* Mesas de embalagem e baias de expedição. Não guardam endereço: são superfície
          de trabalho, e contá-las como estante inventaria posição que não existe. */}
      {mesas.map(m => (
        <mesh key={m.id} position={m.centro}>
          <boxGeometry args={m.tamanho} />
          <meshStandardMaterial color={cores.fantasma} roughness={0.8} metalness={0} />
        </mesh>
      ))}

      {/* Os VÃOS, em sete lotes instanciados.
          Antes era um `<mesh>` por vão — 311 malhas e ~1.245 elementos React para 215
          endereços, e cada malha é uma chamada de desenho por quadro. O agrupamento é por
          OPACIDADE porque alpha não cabe em `instanceColor`; dentro de cada lote, posição,
          escala e cor vão por instância.
          Clicar num vão abre a MESMA vaga que a vista por código abre — é o mesmo objeto,
          e não duas descrições paralelas do mesmo galpão. */}
      <LoteDeVaos
        instancias={lotes.pisoDestaque}
        material={MATERIAL_PISO}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      <LoteDeVaos
        instancias={lotes.pisoAtenuado}
        material={MATERIAL_PISO_ATENUADO}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      {/* Fantasma SEM handler: o lugar existe no desenho, a vaga não. */}
      <LoteDeVaos
        instancias={lotes.pisoFantasma}
        material={MATERIAL_PISO_FANTASMA}
      />
      <LoteDeVaos
        instancias={lotes.paleteDestaque}
        material={materiais.palete}
        corPorInstancia={false}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
      />
      <LoteDeVaos
        instancias={lotes.paleteAtenuado}
        material={materiais.paleteAtenuado}
        corPorInstancia={false}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
      />
      <LoteDeVaos
        instancias={lotes.cargaDestaque}
        material={MATERIAL_CARGA_PLANTA}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />
      <LoteDeVaos
        instancias={lotes.cargaAtenuada}
        material={MATERIAL_CARGA_ATENUADA}
        vagasPorCodigo={vagasPorCodigo}
        onSelecionarVaga={onSelecionarVaga}
        onApontarVaga={onApontarVaga}
      />

      {/* Contorno da carga, em duas camadas.
          A vista por código sempre teve esta divisão; a da planta, que é o PADRÃO da
          tela, não tinha nenhuma — o pallet era um bloco de cor chapado, e o mesmo
          endereço aparecia como duas coisas diferentes conforme a vista. Só as cargas em
          destaque: dar aresta ao que está fora do filtro devolveria o peso visual que o
          filtro acabou de tirar. */}
      <lineSegments geometry={arestasDaCarga}>
        <lineBasicMaterial color={COR_DIVISAO_CAIXA[theme]} transparent opacity={0.55} />
      </lineSegments>

      {/* Sinalização aérea: a MESMA placa da vista por código, duas por rua, uma em cada
          ponta do corredor. Antes esta vista tinha uma placa própria, no meio da fileira,
          com cor fora do sistema de tokens e encolhendo com a perspectiva — a mesma coisa
          desenhada de dois jeitos em duas vistas do mesmo galpão. */}
      <PlacasDeRua placas={placas} />
    </group>
  );
}

/** O que o 3D precisa para desenhar a planta no chão: a imagem e o tamanho REAL dela. */
export interface PlantaNoPiso {
  url: string;
  /** Largura da planta em metros: grid_width × cell_size_meters da planta publicada. */
  largura: number;
  /** Profundidade em metros: grid_height × cell_size_meters. */
  profundidade: number;
}

/**
 * A planta do armazém desenhada no piso da cena 3D.
 *
 * É a mesma imagem que o configurador usa de fundo na grade 2D, servida pela mesma URL
 * assinada — não é uma segunda cópia que poderia divergir. O tamanho vem da escala
 * calibrada da planta publicada, então ela ocupa no 3D os metros que ocupa no galpão.
 *
 * ── A textura é carregada à mão, e não por `useTexture` ───────────────────────────
 * `useTexture` do drei suspende, e suspender aqui congelaria a cena inteira enquanto a
 * imagem baixa — inclusive as vagas, que já estão prontas. Carregando por fora, a cena
 * aparece primeiro e a planta entra quando chega.
 *
 * ── Falhar aqui não pode derrubar o mapa ──────────────────────────────────────────
 * URL assinada expira e imagem some. No erro, o componente simplesmente não desenha: o
 * piso fica liso, que é exatamente o que a tela era antes desta camada existir.
 */
export function PlantaDesenhadaNoPiso({ planta, theme }: { planta: PlantaNoPiso; theme: Theme }) {
  const [textura, setTextura] = useState<Texture | null>(null);

  useEffect(() => {
    let cancelado = false;
    const carregador = new TextureLoader();
    carregador.load(
      planta.url,
      t => {
        if (cancelado) { t.dispose(); return; }
        // Sem isto a imagem entra em linear e aparece lavada contra o piso.
        t.colorSpace = SRGBColorSpace;
        setTextura(t);
      },
      undefined,
      () => { if (!cancelado) console.error('[WMS 3D] Não foi possível carregar a planta do piso.'); },
    );
    return () => { cancelado = true; };
  }, [planta.url]);

  useEffect(() => () => { textura?.dispose(); }, [textura]);

  if (!textura) return null;

  return (
    // Entre o piso (-0,01) e as faixas de circulação (0,005): a planta cobre o concreto
    // sem apagar a sinalização pintada por cima dele.
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
      <planeGeometry args={[planta.largura, planta.profundidade]} />
      {/* `color` MULTIPLICA a textura. Planta técnica é quase toda branca, e branco sobre
          o piso claro do tema light é invisível — foi assim que esta camada pareceu não
          existir no primeiro teste. O cinza puxa o fundo da planta para baixo do tom do
          concreto sem tocar nas linhas, que já são escuras. No tema escuro não há o que
          corrigir: branco sobre piso escuro contrasta sozinho. */}
      <meshBasicMaterial
        map={textura}
        color={theme === 'light' ? '#C2C6CE' : '#FFFFFF'}
        transparent
        opacity={0.92}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Camada de construção do Modo Edição.
 *
 * Três coisas, nesta ordem de profundidade: o plano que captura o ponteiro, o fantasma
 * que segue o cursor, e as peças já colocadas.
 *
 * ── Por que o plano é transparente e não `visible={false}` ────────────────────────
 * O raycaster do three PULA objeto invisível. Com `visible={false}` o plano existiria na
 * cena e nunca seria atingido pelo ponteiro — o fantasma simplesmente não apareceria, sem
 * erro nenhum para explicar. Por isso ele é visível com `opacity: 0`, e `depthWrite`
 * desligado para não recortar o que está atrás dele.
 *
 * ── O estado do fantasma mora AQUI ────────────────────────────────────────────────
 * `onPointerMove` dispara dezenas de vezes por segundo. Guardar a posição no componente
 * de cima redesenharia o armazém inteiro a cada movimento do mouse; aqui só este subtree
 * se redesenha.
 */
export function Construcao({
  ferramenta,
  estanteEscolhida,
  objetos,
  selecionado,
  extensao,
  theme,
  onConstruir,
  onSelecionar,
  onGirar,
  onExcluir,
}: {
  ferramenta: FerramentaBuilder;
  /** Variante que o fantasma deve mostrar — a mesma que a próxima peça vai nascer. */
  estanteEscolhida: TipoDeEstante;
  objetos: ObjetoConstruido[];
  selecionado: string | null;
  extensao: number;
  theme: Theme;
  onConstruir: (x: number, z: number) => void;
  onSelecionar: (id: string) => void;
  onGirar: (id: string) => void;
  onExcluir: (id: string) => void;
}) {
  const [alvo, setAlvo] = useState<[number, number] | null>(null);
  const cores = COR_BUILDER[theme];
  const construindo = ferramenta !== 'navegar';

  /** Tamanho da peça: porta-pallets segue a VARIANTE escolhida, o resto segue o catálogo. */
  const tamanhoDe = (tipo: TipoConstruido, estante: TipoDeEstante): [number, number, number] =>
    tipo === 'porta-pallets' ? ESTANTES[estante].tamanho : CATALOGO[tipo].tamanho;

  const hexDe = (chave: string) =>
    CORES_DE_ESTANTE.find(c => c.chave === chave)?.hex ?? cores.peca;

  const tamanhoAtivo = construindo
    ? tamanhoDe(ferramenta as TipoConstruido, estanteEscolhida)
    : null;

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={e => {
          if (!construindo) return;
          e.stopPropagation();
          // Snap: o metro é a unidade da grade desenhada, então arredondar para inteiro
          // é literalmente encaixar na linha que a pessoa está vendo.
          setAlvo([Math.round(e.point.x), Math.round(e.point.z)]);
        }}
        onPointerLeave={() => setAlvo(null)}
        onClick={e => {
          if (!construindo || !alvo) return;
          e.stopPropagation();
          onConstruir(alvo[0], alvo[1]);
        }}
      >
        {/* Maior que a cena: construir fora do contorno atual do armazém é justamente o
            caso de uso quando o galpão cresce. */}
        <planeGeometry args={[extensao * 2.5, extensao * 2.5]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {tamanhoAtivo && alvo && (
        <mesh
          position={[
            alvo[0],
            CATALOGO[ferramenta as TipoConstruido].noChao
              ? tamanhoAtivo[1] / 2 + 0.02
              : tamanhoAtivo[1] / 2,
            alvo[1],
          ]}
        >
          <boxGeometry args={tamanhoAtivo} />
          <meshStandardMaterial color={cores.fantasma} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}

      {objetos.map(obj => {
        const tamanho = tamanhoDe(obj.tipo, obj.estante);
        const peca: PecaDoCatalogo = { ...CATALOGO[obj.tipo], tamanho };
        const ativo = selecionado === obj.id;
        const cor = ativo
          ? cores.selecionada
          : obj.tipo === 'doca'
            ? cores.doca
            : hexDe(obj.cor);
        return (
          <group
            key={obj.id}
            position={[obj.x, alturaDoCentro(peca), obj.z]}
            rotation={[0, obj.rotacaoY, 0]}
          >
            {/* Porta-pallets colocado é DESENHADO como porta-pallets: montantes e
                longarinas, a mesma decomposição da planta. Caixa cheia faria o builder
                construir uma coisa e o mapa mostrar outra. */}
            {obj.tipo === 'porta-pallets' ? (
              <group onClick={e => { e.stopPropagation(); onSelecionar(obj.id); }}>
                {pecasDaFileira({
                  id: obj.id,
                  tipo: 'fileira',
                  centro: [0, tamanho[1] / 2, 0],
                  tamanho,
                  rotulo: '',
                }).map((p, i) => (
                  <mesh key={i} position={[p.centro[0], p.centro[1] - tamanho[1] / 2, p.centro[2]]}>
                    <boxGeometry args={p.tamanho} />
                    <meshStandardMaterial color={cor} roughness={0.6} metalness={0.15} />
                  </mesh>
                ))}
              </group>
            ) : (
              <mesh
                onClick={e => {
                  e.stopPropagation();
                  onSelecionar(obj.id);
                }}
              >
                <boxGeometry args={peca.tamanho} />
                <meshStandardMaterial color={cor} />
              </mesh>
            )}

            {ativo && (
              <Html center distanceFactor={22} position={[0, peca.tamanho[1] / 2 + 0.8, 0]}>
                <div className="flex gap-1 whitespace-nowrap rounded-control border border-edge bg-surface px-1.5 py-1 shadow-control">
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 text-xs text-fg hover:bg-surface-3"
                    onClick={() => onGirar(obj.id)}
                  >
                    Girar 90°
                  </button>
                  <button
                    type="button"
                    className="rounded-control px-2 py-1 text-xs text-red-600 hover:bg-surface-3 dark:text-red-400"
                    onClick={() => onExcluir(obj.id)}
                  >
                    Excluir
                  </button>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/**
 * Caminhada em primeira pessoa dentro do galpão.
 *
 * `PointerLockControls` do drei resolve só o OLHAR — travar o ponteiro e girar a câmera.
 * O andar é daqui: W/A/S/D movendo no plano, com a altura presa na dos olhos.
 *
 * ── Por que a frente é achatada antes de normalizar ──────────────────────────────
 * `getWorldDirection` devolve para onde a câmera APONTA, inclusive para cima e para
 * baixo. Usada crua, olhar para o teto faria o W subir voando. Zerar o Y antes de
 * normalizar é o que transforma "para onde olho" em "para onde ando".
 *
 * ── Por que o tempo do quadro entra na conta ─────────────────────────────────────
 * Somar um passo fixo por quadro faria a pessoa andar mais rápido numa máquina que
 * roda a 120 FPS do que numa de 30. Multiplicar pelo delta mantém 2,2 m/s em qualquer
 * uma — é metro por segundo, não metro por quadro.
 */
export function Caminhada({ caixas, cerca }: { caixas: CaixaPlana[]; cerca: CaixaPlana }) {
  const { camera } = useThree();
  const teclas = useRef<Record<string, boolean>>({});

  // Entrada: põe a pessoa DENTRO do galpão, na altura dos olhos, olhando para o centro.
  // Sem isto a caminhada começa de onde a órbita parou — tipicamente a dezenas de metros
  // e lá no alto, de onde W não chega a lugar nenhum em tempo razoável.
  //
  // O ponto é VALIDADO contra as caixas: antes era fixo, e com colisão um ponto dentro de
  // geometria prende a pessoa — ela aperta W e nada acontece, sem nada explicando.
  useEffect(() => {
    // Preferido: o CENTRO do prédio, onde estão as estantes — e não o portão.
    //
    // Medido na planta real: entrando a 92% do comprimento (a área de expedição), as cinco
    // baias de pallet vedam a largura do galpão. Elas deixam vãos de 0,617 m, que o raio de
    // 0,30 m fecha, e a pessoa andava 1,1 m e travava. O centro cai entre as fileiras, que
    // é de onde se anda pelos corredores.
    const preferido: [number, number] = [(cerca.x0 + cerca.x1) / 2, (cerca.z0 + cerca.z1) / 2];
    const [x, z] = pontoDeEntrada(preferido, caixas, cerca, RAIO_DO_CAMINHANTE);
    camera.position.set(x, ALTURA_DOS_OLHOS, z);
    camera.lookAt((cerca.x0 + cerca.x1) / 2, ALTURA_DOS_OLHOS, (cerca.z0 + cerca.z1) / 2);
  }, [camera, caixas, cerca]);

  useEffect(() => {
    const aperta = (e: KeyboardEvent) => { teclas.current[e.code] = true; };
    const solta = (e: KeyboardEvent) => { teclas.current[e.code] = false; };
    window.addEventListener('keydown', aperta);
    window.addEventListener('keyup', solta);
    // Soltar tudo ao sair: com a tecla "presa" no desmonte, voltar para a caminhada
    // começaria andando sozinho.
    return () => {
      window.removeEventListener('keydown', aperta);
      window.removeEventListener('keyup', solta);
      teclas.current = {};
    };
  }, []);

  useFrame((_, delta) => {
    const passo = VELOCIDADE_A_PE * delta;

    const frente = new Vector3();
    camera.getWorldDirection(frente);
    frente.y = 0;
    if (frente.lengthSq() === 0) return;
    frente.normalize();

    const lado = new Vector3().crossVectors(frente, new Vector3(0, 1, 0)).normalize();

    // O passo é calculado numa posição CANDIDATA, não aplicado direto na câmera: é o que
    // permite recusar a componente que bateu e aceitar a outra.
    const origem: [number, number] = [camera.position.x, camera.position.z];
    let dx = 0;
    let dz = 0;
    if (teclas.current.KeyW || teclas.current.ArrowUp) { dx += frente.x * passo; dz += frente.z * passo; }
    if (teclas.current.KeyS || teclas.current.ArrowDown) { dx -= frente.x * passo; dz -= frente.z * passo; }
    if (teclas.current.KeyD || teclas.current.ArrowRight) { dx += lado.x * passo; dz += lado.z * passo; }
    if (teclas.current.KeyA || teclas.current.ArrowLeft) { dx -= lado.x * passo; dz -= lado.z * passo; }

    // Altura fixa: sem isto qualquer imprecisão acumularia e a pessoa afundaria no piso
    // ou subiria devagar sem perceber.
    camera.position.y = ALTURA_DOS_OLHOS;

    if (dx === 0 && dz === 0) return;

    // Cerca de verdade (o contorno do prédio) e colisão eixo a eixo, para encostar na
    // fileira virar deslizar em vez de grudar.
    const [x, z] = deslizar(origem, [origem[0] + dx, origem[1] + dz], caixas, cerca, RAIO_DO_CAMINHANTE);
    camera.position.x = x;
    camera.position.z = z;
  });

  return null;
}
