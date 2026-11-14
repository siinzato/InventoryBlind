// Cenário do galpão: piso, paredes, marcação de solo e sombra de contato.
//
// 100% cosmético. Nenhuma vaga, nenhum dado, nenhum clique passa por aqui — este
// arquivo não importa nada do Supabase nem do domínio do WMS, e é assim que se garante
// que ele não tem como alterar comportamento.
//
// ── Por que NÃO usa o `<Environment>` do drei ───────────────────────────────────
// O `<Environment preset="...">` baixa um HDRI de um CDN externo em tempo de execução.
// Num WMS usado dentro do galpão — onde a rede é ruim e o app é PWA justamente por
// isso — isso significa um cenário que às vezes carrega e às vezes não, e uma
// dependência de terceiros no caminho de renderização. A iluminação aqui é montada à
// mão: três luzes, nenhum download.
//
// ── Por que as paredes somem quando se olha de fora ─────────────────────────────
// As quatro paredes têm a normal apontando para DENTRO. O three descarta a face de
// trás, então a parede entre a câmera e o armazém simplesmente não é desenhada. Sem
// isso, afastar a câmera (o `maxDistance` permite) mostraria a tela inteira tapada por
// um retângulo cinza — o cenário esconderia o armazém que ele existe para situar.

import { useMemo } from 'react';
import { ContactShadows } from '@react-three/drei';
import type { Theme } from '../../lib/useTheme';

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

/** Amarelo de marcação de solo — o mesmo papel do amarelo pintado no chão do galpão:
 *  sinalizar circulação. Não é cor semântica do produto e não entra em nenhuma
 *  legenda; por isso pode ser literal aqui sem disputar com o âmbar do alerta. */
const MARCACAO: Record<Theme, string> = { light: '#D9A514', dark: '#7A5E12' };

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
  const alturaParede = Math.max(7, extensao * 0.55);

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
          <meshStandardMaterial color={MARCACAO[theme]} roughness={0.9} metalness={0} />
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
