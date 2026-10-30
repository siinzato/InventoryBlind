// Espera com a marca do InventoryBlind, no lugar do spinner genérico.
//
// A marca é o Blind Grid: quatro ripas verticais atravessadas por uma barra. A animação
// é a própria persiana respirando — as ripas encolhem e voltam em onda, e a barra fica
// PARADA. É ela que mantém o símbolo reconhecível em todo quadro; se tudo se mexesse,
// deixaria de ser a marca e viraria um gráfico animado qualquer.
//
// Por que isso e não um spinner: girar não significa nada aqui. Persiana sendo lida
// significa — é o que o produto faz. Motion deve comunicar, não decorar (§19 da
// constituição de design).
//
// `useAnimationTier()` é o único mecanismo de redução, como manda a constituição:
// no tier mínimo a onda some e sobra uma pulsação lenta de opacidade — reduzido, não
// removido, porque um indicador de carregamento parado parece app travado.

import { useState } from 'react';
import { motion } from 'motion/react';
import { useAnimationTier } from '../../lib/useAnimationTier';

/** Geometria do `public/icon-mark.svg`, nas mesmas coordenadas. */
const SLATS = [10, 34, 58, 82];
/** A terceira ripa é a de destaque na marca original. */
const ACCENT_SLAT = 58;

/**
 * Vocabulário de armazém que também é vocabulário de sistema — o trocadilho está no
 * termo, não numa piada em cima dele. "Separação" é picking, "dar entrada" é
 * recebimento, "endereçar" é o que o Pulmão faz, "conferir" é contagem.
 *
 * Sorteadas por montagem, não em rodízio durante a espera: trocar o texto no meio do
 * carregamento chama atenção para a demora, que é o oposto do que se quer aqui.
 */
const LOADING_LINES = [
  'Separando os dados...',
  'Dando entrada no sistema...',
  'Endereçando a informação...',
  'Conferindo cada corredor...',
  'Montando o pallet de dados...',
];

const pickLine = (): string => LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)];

export function BrandLoader({
  label,
  size = 64,
}: {
  /** Omitido, sorteia uma frase. `null` esconde o texto (ícone sozinho). */
  label?: string | null;
  size?: number;
}) {
  // Sorteio no inicializador: uma vez por montagem, não a cada render.
  const [sorteada] = useState(pickLine);
  const texto = label === undefined ? sorteada : label;
  const tier = useAnimationTier();
  const minimal = tier === 'minimal';
  // No tablet/celular a onda fica mais contida: tela menor, movimento menos tolerável.
  const squeeze = tier === 'simplified' ? 0.86 : 0.72;

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center">
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-hidden="true"
        animate={minimal ? { opacity: [1, 0.5, 1] } : undefined}
        transition={minimal ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      >
        {SLATS.map((x, i) => (
          <motion.rect
            key={x}
            x={x}
            y={20}
            width={14}
            height={60}
            rx={3}
            className={x === ACCENT_SLAT ? 'fill-accent' : 'fill-fg'}
            // `fill-box` + centro: sem isso o scaleY cresce a partir do canto do SVG
            // e as ripas saem do lugar em vez de encolher no próprio eixo.
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={minimal ? undefined : { scaleY: [1, squeeze, 1] }}
            transition={
              minimal
                ? undefined
                : {
                    duration: 1.1,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    // Onda da esquerda para a direita: a leitura acompanha o corredor.
                    delay: i * 0.12,
                  }
            }
          />
        ))}

        {/* Fixa de propósito: é a âncora que mantém a marca legível durante a onda. */}
        <rect x={4} y={46} width={92} height={6} rx={3} className="fill-accent" />
      </motion.svg>

      {texto && <p className="mt-4 text-fg-muted font-medium">{texto}</p>}
    </div>
  );
}
