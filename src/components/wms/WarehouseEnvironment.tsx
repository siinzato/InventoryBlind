// Cenário do galpão: piso, paredes, marcação de solo e sombra de contato.
//
// 100% cosmético. Nenhuma vaga, nenhum dado, nenhum clique passa por aqui — este
// arquivo não importa nada do Supabase nem do domínio do WMS, e é assim que se garante
// que ele não tem como alterar comportamento.
//
// ── Por que NÃO usa `<Environment preset="...">` ───────────────────────────────
// O `preset` baixa um HDRI de um CDN externo em tempo de execução. Num WMS usado dentro
// do galpão — onde a rede é ruim e o app é PWA justamente por isso — isso significa um
// cenário que às vezes carrega e às vezes não, e uma dependência de terceiros no caminho
// de renderização. Isso continua valendo e continua fora.
//
// ── Por que o `<Environment>` com `<Lightformer>` entrou ───────────────────────
// Sem `preset`, o `<Environment>` não baixa nada: ele RENDERIZA os filhos num cube
// target e usa o resultado como mapa de ambiente. É gerado na máquina, offline, em 128
// pixels.
//
// Entrou porque sem ele o aço não tinha o que refletir. Montante e longarina têm
// `metalness` 0,45 e 0,35, e metal num PBR é quase só reflexo: sem ambiente, o cálculo
// acontece contra o vazio e a estante sai chapada, da cor lisa que o material declara.
// Não era a cor que estava errada — era não haver nada para o aço espelhar.
//
// Três emissores, na posição das luminárias em linha de um galpão: duas faixas no teto,
// uma de lado. `frames={1}` sozinho NÃO basta para cozinhar uma vez só — ver o `memo` em
// `AmbienteDoGalpao`, que é o que de fato segura isso, e a medição que o mostrou.
//
// ── Por que as paredes somem quando se olha de fora ─────────────────────────────
// As quatro paredes têm a normal apontando para DENTRO. O three descarta a face de
// trás, então a parede entre a câmera e o armazém simplesmente não é desenhada. Sem
// isso, afastar a câmera (o `maxDistance` permite) mostraria a tela inteira tapada por
// um retângulo cinza — o cenário esconderia o armazém que ele existe para situar.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import type { InstancedMesh } from 'three';
import type { Theme } from '../../lib/useTheme';
import {
  GEOMETRIA_UNITARIA, MATERIAIS_DO_GALPAO, aplicarPecas, capacidadeDoLote,
  type PecaDeQuadro,
} from './viewer3d/recursos3d';
import { COR_MARCACAO } from './viewer3d/aparencia';

export type FundoDaCena = 'galpao' | 'limpo';

/**
 * Concreto polido no claro; concreto de galpão à noite no escuro.
 *
 * O escuro NÃO é o claro invertido: um piso branco no tema escuro vira a coisa mais
 * clara da tela e rouba a atenção das vagas, que são o assunto. No escuro o piso recua.
 */
const PISO: Record<Theme, { cor: string; aspereza: number; metalicidade: number }> = {
  light: { cor: '#E4E2DC', aspereza: 0.38, metalicidade: 0.06 },
  dark: { cor: '#171A21', aspereza: 0.52, metalicidade: 0.04 },
};

const PAREDE: Record<Theme, string> = { light: '#EFEEEA', dark: '#12151C' };

/**
 * O ambiente que o metal reflete.
 *
 * `teto` é a luminária; `fundo` é a claridade difusa que vem do resto do galpão. No tema
 * escuro os dois caem junto — um reflexo branco no escuro faria a estante brilhar mais
 * que no claro, e o aço ficaria sendo a coisa mais luminosa de uma cena noturna.
 *
 * Intensidade moderada de propósito: o ambiente aqui existe para o metal ter o que
 * espelhar, não para virar fonte de luz. Quem ilumina continuam sendo as três luzes.
 */
const AMBIENTE: Record<Theme, { teto: string; fundo: string; forca: number }> = {
  light: { teto: '#FFFFFF', fundo: '#C9D2DE', forca: 1 },
  dark: { teto: '#8FA3BC', fundo: '#20283A', forca: 0.75 },
};


/**
 * O mapa de ambiente, gerado aqui e sem rede.
 *
 * ── Por que é `memo`, e por que isso não é otimização ──────────────────────────
 * Medido no navegador, com as chamadas de desenho instrumentadas no contexto WebGL
 * vivo: sem o `memo`, CADA quadro desenhado pagava uma pirâmide PMREM completa — 8, 16,
 * 32, 64, 128, 256 e 512 px, ~146 desenhos em render target — contra 29 da cena inteira.
 *
 * A causa está no drei: o `<Environment>` refaz o cozimento num `useMemo` que tem
 * `children` entre as dependências. Como o JSX dos emissores nasce novo a cada render do
 * componente de cima, a dependência mudava sempre e `frames={1}` nunca significava uma
 * vez. Com o `memo`, o componente não re-renderiza enquanto o tema não muda, os filhos
 * mantêm a identidade e o cozimento volta a acontecer uma vez só.
 *
 * A `key` pelo tema é o outro lado disso: o cozimento sendo único, trocar de tema
 * precisa REFAZÊ-LO, senão o aço do tema novo refletiria a iluminação do anterior.
 *
 * `resolution={128}` é o que basta — o reflexo do metal já é embaçado pela própria
 * aspereza do material, e resolução maior só gastaria memória num borrão.
 */
const AmbienteDoGalpao = memo(function AmbienteDoGalpao({ theme }: { theme: Theme }) {
  const ambiente = AMBIENTE[theme];
  return (
    <Environment key={theme} frames={1} resolution={128}>
      {/* Duas faixas no teto, na direção das luminárias em linha de um galpão, e uma
          lateral que impede o lado oposto do montante de fechar em reflexo preto. */}
      <Lightformer
        form="rect"
        intensity={ambiente.forca}
        color={ambiente.teto}
        position={[0, 6, 2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[10, 2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={ambiente.forca}
        color={ambiente.teto}
        position={[0, 6, -2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[10, 2, 1]}
      />
      <Lightformer
        form="rect"
        intensity={ambiente.forca * 0.5}
        color={ambiente.fundo}
        position={[-6, 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[10, 6, 1]}
      />
    </Environment>
  );
});

/**
 * Teto do galpão, em metros.
 *
 * ── Por que ganhou TETO ────────────────────────────────────────────────────────
 * A altura era `max(7, extensao * 0.55)`, sem limite. Para o galpão de 45,2 m isso dava
 * uma parede de 24,9 m — medido. Nenhum galpão de armazenagem tem 25 metros de pé-direito;
 * um rack de 4,2 m dentro dele parecia móvel de boneca, e era a própria escala do desenho
 * que mentia. Doze metros é pé-direito de galpão logístico de verdade, e é o que faz a
 * estante voltar a ter o tamanho que tem.
 */
const ALTURA_MAXIMA_DA_PAREDE = 12;

/**
 * Janela alta (clerestório), em metros.
 *
 * Fica a 72% do pé-direito porque é onde ela fica num galpão: acima do topo das estantes,
 * na faixa que não serve para armazenar. Mais baixa, ela competiria com o rack; mais alta,
 * encostaria na cobertura.
 *
 * `recuo` embute a janela na parede. Coplanar com ela, as duas brigariam por profundidade
 * e a abertura piscaria conforme a câmera gira.
 */
const JANELA = { largura: 2.4, altura: 1.6, passo: 6, recuo: 0.06, espessura: 0.04 } as const;

/**
 * As janelas das quatro paredes.
 *
 * Passo INTEIRO, como em toda geometria deste módulo: o número de janelas é o que cabe no
 * lado, e o passo é o lado dividido por ele. Com passo fixo, a última janela de cada
 * parede sairia pela quina.
 *
 * As paredes têm a normal para DENTRO (ver o cabeçalho do arquivo), então as janelas
 * também só existem vistas de dentro — que é o único lugar de onde esta cena é olhada.
 */
function janelasDoGalpao(lado: number, alturaParede: number): PecaDeQuadro[] {
  const y = alturaParede * 0.72;
  const meio = lado / 2;
  const quantas = Math.max(1, Math.floor(lado / JANELA.passo));
  const passo = lado / quantas;
  const dentro = meio - JANELA.recuo;
  const pecas: PecaDeQuadro[] = [];

  for (let i = 0; i < quantas; i += 1) {
    const d = -meio + (i + 0.5) * passo;
    // Paredes de fundo e de frente: a janela se estende em X.
    for (const z of [-dentro, dentro]) {
      pecas.push({ centro: [d, y, z], tamanho: [JANELA.largura, JANELA.altura, JANELA.espessura] });
    }
    // Paredes laterais: a mesma janela, estendida em Z.
    for (const x of [-dentro, dentro]) {
      pecas.push({ centro: [x, y, d], tamanho: [JANELA.espessura, JANELA.altura, JANELA.largura] });
    }
  }

  return pecas;
}

/**
 * Cobertura: vigas mestras transversais e terças longitudinais.
 *
 * Não é um telhado fechado, e isso é deliberado — o que se vê olhando para cima num galpão
 * é a GRELHA, não uma laje. A grelha é também o que dá profundidade: ela cria uma série de
 * linhas convergindo para o fundo, e é essa convergência que o olho usa para medir o
 * comprimento do prédio.
 *
 * As terças ficam ACIMA das vigas, como no galpão: elas se apoiam sobre as mestras. Na
 * ordem inversa o cruzamento seria coplanar e cintilaria.
 */
const COBERTURA = { secao: 0.2, vigas: 5, tercas: 9, folgaDoTeto: 0.45 } as const;

function coberturaDoGalpao(lado: number, alturaParede: number): PecaDeQuadro[] {
  const meio = lado / 2;
  const yViga = alturaParede - COBERTURA.folgaDoTeto;
  const yTerca = yViga + COBERTURA.secao * 0.8;
  const pecas: PecaDeQuadro[] = [];

  const passoViga = lado / COBERTURA.vigas;
  for (let i = 0; i < COBERTURA.vigas; i += 1) {
    const z = -meio + (i + 0.5) * passoViga;
    pecas.push({ centro: [0, yViga, z], tamanho: [lado, COBERTURA.secao, COBERTURA.secao] });
  }

  const passoTerca = lado / COBERTURA.tercas;
  const secaoDaTerca = COBERTURA.secao * 0.6;
  for (let i = 0; i < COBERTURA.tercas; i += 1) {
    const x = -meio + (i + 0.5) * passoTerca;
    pecas.push({ centro: [x, yTerca, 0], tamanho: [secaoDaTerca, secaoDaTerca, lado] });
  }

  return pecas;
}

/** As janelas altas, num objeto de GPU só. */
const JanelasDoGalpao = memo(function JanelasDoGalpao({
  pecas,
  theme,
}: {
  pecas: PecaDeQuadro[];
  theme: Theme;
}) {
  const malha = useRef<InstancedMesh>(null);
  useEffect(() => { aplicarPecas(malha.current, pecas); }, [pecas]);

  return (
    <instancedMesh
      ref={malha}
      args={[GEOMETRIA_UNITARIA, MATERIAIS_DO_GALPAO[theme].janela, capacidadeDoLote(pecas.length)]}
    />
  );
});

/**
 * A cobertura, desenhada SÓ quando a câmera está abaixo dela.
 *
 * ── Por que a condição existe ──────────────────────────────────────────────────
 * Olhando o galpão de cima — que é o enquadramento padrão desta tela — quem estivesse
 * acima do telhado veria a face de FORA dele, e esta cena não desenha telhado por fora.
 * Desenhar a grelha mesmo assim poria catorze linhas atravessando o armazém inteiro em
 * exatamente a vista em que ele precisa estar limpo. Abaixo do teto, que é onde se caminha
 * e onde se orbita rasante, ela aparece e é justamente o que dá o pé-direito.
 *
 * `visible` em vez de desmontar: alternar a montagem recriaria o buffer de GPU a cada vez
 * que a câmera cruzasse os doze metros, e objeto invisível não é desenhado pelo three —
 * então o custo em vista aérea é zero do mesmo jeito.
 *
 * O `setState` só dispara na TROCA de regime. Sem essa comparação, orbitar
 * re-renderizaria a cobertura a cada quadro para desenhar a mesma coisa.
 */
const CoberturaDoGalpao = memo(function CoberturaDoGalpao({
  pecas,
  alturaParede,
  theme,
}: {
  pecas: PecaDeQuadro[];
  alturaParede: number;
  theme: Theme;
}) {
  const malha = useRef<InstancedMesh>(null);
  const camera = useThree(estado => estado.camera);
  const [soTeto, setSoTeto] = useState(false);

  useEffect(() => { aplicarPecas(malha.current, pecas); }, [pecas]);

  useFrame(() => {
    const agora = camera.position.y < alturaParede;
    if (agora !== soTeto) setSoTeto(agora);
  });

  return (
    <instancedMesh
      ref={malha}
      visible={soTeto}
      args={[GEOMETRIA_UNITARIA, MATERIAIS_DO_GALPAO[theme].cobertura, capacidadeDoLote(pecas.length)]}
    />
  );
});

interface WarehouseEnvironmentProps {
  /** Maior dimensão do armazém desenhado, em metros do modelo. */
  extensao: number;
  theme: Theme;
  /**
   * Muda quando o conjunto desenhado muda. Serve de `key` para a sombra de contato:
   * ela é calculada UMA vez (`frames={1}`) em vez de a cada quadro, mas precisa ser
   * recalculada quando as vagas mudam — senão ficaria a sombra do armazém anterior, ou
   * a sombra de um armazém vazio, já que os dados chegam depois da montagem.
   */
  chaveDeSombra: string;
}

export function WarehouseEnvironment({ extensao, theme, chaveDeSombra }: WarehouseEnvironmentProps) {
  const piso = PISO[theme];
  // O cenário acompanha o armazém: um galpão de tamanho fixo deixaria um pulmão grande
  // atravessando a parede e um pequeno perdido no meio do nada.
  const lado = extensao * 1.9;
  const meioLado = lado / 2;
  // Com teto: ver `ALTURA_MAXIMA_DA_PAREDE`. Sem ele, o galpão de 45 m ganhava 24,9 m de
  // pé-direito e a estante de 4,2 m parecia móvel de boneca dentro dele.
  const alturaParede = Math.min(ALTURA_MAXIMA_DA_PAREDE, Math.max(7, extensao * 0.55));

  const janelas = useMemo(() => janelasDoGalpao(lado, alturaParede), [lado, alturaParede]);
  const cobertura = useMemo(() => coberturaDoGalpao(lado, alturaParede), [lado, alturaParede]);

  /** Faixas de circulação: o contorno do armazém e dois corredores transversais.
   *  Poucas e largas, como as pintadas no chão — uma grade inteira viraria textura e
   *  deixaria de ler como sinalização. */
  const faixas = useMemo(() => {
    const comprimento = extensao * 1.45;
    const meio = comprimento / 2;
    const espessura = 0.16;
    const listas: { pos: [number, number, number]; escala: [number, number, number] }[] = [];

    // Contorno.
    for (const z of [-meio, meio]) {
      listas.push({ pos: [0, 0, z], escala: [comprimento, espessura, 1] });
    }
    for (const x of [-meio, meio]) {
      listas.push({ pos: [x, 0, 0], escala: [espessura, comprimento, 1] });
    }
    // Dois corredores transversais, a um terço e a dois terços.
    for (const z of [-meio / 3, meio / 3]) {
      listas.push({ pos: [0, 0, z], escala: [comprimento, espessura, 1] });
    }
    return listas;
  }, [extensao]);

  return (
    <group>
      <AmbienteDoGalpao theme={theme} />

      {/* Luz. Três fontes: a ambiente dá o piso de claridade, a direcional cria a
          aresta entre topo e lateral (sem ela o cubo vira hexágono chapado) e a de
          preenchimento, oposta e fraca, impede que o lado escuro feche em preto —
          é o que um galpão com luminárias em linha de fato faz. */}
      <ambientLight intensity={theme === 'dark' ? 0.95 : 1.15} />
      <directionalLight position={[extensao * 0.5, extensao, extensao * 0.65]} intensity={theme === 'dark' ? 1.35 : 1.75} />
      <directionalLight position={[-extensao * 0.6, extensao * 0.7, -extensao * 0.5]} intensity={theme === 'dark' ? 0.4 : 0.55} />

      {/* Piso. Abaixo de zero para nunca disputar profundidade com o que está apoiado
          nele — coplanar com a base das vagas produziria o tremido do z-fighting. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[lado, lado]} />
        <meshStandardMaterial color={piso.cor} roughness={piso.aspereza} metalness={piso.metalicidade} />
      </mesh>

      {faixas.map((faixa, i) => (
        <mesh key={`faixa-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[faixa.pos[0], 0.005, faixa.pos[2]]}>
          <planeGeometry args={[faixa.escala[0], faixa.escala[1]]} />
          {/* Sem brilho: tinta no chão é fosca, e um amarelo espelhado pareceria
              plástico em vez de demarcação. */}
          <meshStandardMaterial color={COR_MARCACAO[theme]} roughness={0.9} metalness={0} />
        </mesh>
      ))}

      {/* Paredes perimetrais, normais para dentro. */}
      <mesh position={[0, alturaParede / 2, -meioLado]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[0, alturaParede / 2, meioLado]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[-meioLado, alturaParede / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>
      <mesh position={[meioLado, alturaParede / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[lado, alturaParede]} />
        <meshStandardMaterial color={PAREDE[theme]} roughness={0.95} metalness={0} />
      </mesh>

      {/* Janelas altas e grelha de cobertura: duas chamadas de desenho para o galpão
          inteiro. São o que dá PROFUNDIDADE à caixa — sem elas, quatro planos cinza não
          informam se o prédio tem vinte ou cem metros. */}
      <JanelasDoGalpao pecas={janelas} theme={theme} />
      <CoberturaDoGalpao pecas={cobertura} alturaParede={alturaParede} theme={theme} />

      {/* Sombra de contato: assenta as estantes no chão. `frames={1}` calcula uma vez
          em vez de a cada quadro — o custo de um passe de render por quadro foi
          justamente o que se evitou no radar. A `key` refaz o cálculo quando o conjunto
          desenhado muda. */}
      <ContactShadows
        key={chaveDeSombra}
        frames={1}
        resolution={512}
        position={[0, 0.002, 0]}
        opacity={theme === 'dark' ? 0.5 : 0.4}
        scale={Math.max(20, extensao * 1.6)}
        blur={1.5}
        far={10}
        color="#000000"
      />
    </group>
  );
}
