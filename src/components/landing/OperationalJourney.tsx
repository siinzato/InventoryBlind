import { useRef, type CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PackageCheck, ScanLine, ListChecks, Wrench, Gauge, FileBarChart, ChevronRight } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useGSAP, gsap } from './landingScroll';

interface Stage {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const STAGES: Stage[] = [
  { icon: PackageCheck, title: 'Recebimento', desc: 'Entrada de mercadoria registrada e vinculada à NF-e.' },
  { icon: ScanLine, title: 'Conferência', desc: 'Conferência por NF-e cruza o que chegou com o que foi faturado.' },
  { icon: ListChecks, title: 'Contagem', desc: 'Contagem cega elimina o viés de quem já sabe o esperado.' },
  { icon: Wrench, title: 'Correções', desc: 'Divergências apontadas e corrigidas com rastreabilidade total.' },
  { icon: Gauge, title: 'BlindScore', desc: 'Cada operação recebe um score de acuracidade e risco.' },
  { icon: FileBarChart, title: 'Relatórios', desc: 'Tudo consolidado em relatórios prontos para decisão.' },
];

/** Vidro escuro discreto — mesma família de material do restante da landing, aplicado leve. */
const CARD_SURFACE: CSSProperties = {
  backgroundColor: 'rgba(11,13,18,0.72)',
  backgroundImage: [
    'linear-gradient(180deg, rgba(255,255,255,0.042) 0%, rgba(255,255,255,0.01) 16%, rgba(255,255,255,0) 38%)',
    'linear-gradient(90deg, rgba(30,95,191,0.055), rgba(30,95,191,0) 46%)',
  ].join(', '),
  border: '1px solid rgba(140,170,215,0.145)',
  boxShadow: [
    'inset 0 1px 0 rgba(255,255,255,0.055)',
    '0 1px 3px rgba(0,0,0,0.35)',
    '0 16px 34px -18px rgba(0,0,0,0.7)',
  ].join(', '),
};

const ART_LINE = 'rgba(127,179,245,0.26)';
const ART_LINE_SOFT = 'rgba(127,179,245,0.16)';
const ART_FILL = 'rgba(12,19,33,0.92)';
const ART_TEXT = 'rgba(127,179,245,0.55)';

/**
 * Micro-ilustração de cada etapa. Só formas geométricas em SVG inline — sem imagem,
 * sem dependência. Fica escura e de baixo contraste de propósito: é profundidade,
 * não concorrência com o título. O card corta a arte na borda.
 */
function StageArt({ index }: { index: number }) {
  const common = { stroke: ART_LINE, strokeWidth: 1.2 } as const;
  return (
    <svg viewBox="0 0 168 128" className="absolute right-0 -top-3 h-[128px] w-[168px]" aria-hidden="true">
      {index === 0 && (
        <g>
          <path d="M14 56 L52 40 L90 56 L90 94 L52 110 L14 94 Z" fill={ART_FILL} {...common} />
          <path d="M14 56 L52 72 L90 56" fill="none" {...common} />
          <path d="M52 72 L52 110" fill="none" {...common} stroke={ART_LINE_SOFT} />
          <rect x="88" y="44" width="66" height="50" rx="6" fill={ART_FILL} {...common} />
          <text x="97" y="62" fontSize="10" fontWeight="600" fill={ART_TEXT}>NF-e</text>
          <rect x="97" y="70" width="48" height="3" rx="1.5" fill={ART_LINE_SOFT} />
          <rect x="97" y="78" width="38" height="3" rx="1.5" fill={ART_LINE_SOFT} />
        </g>
      )}
      {index === 1 && (
        <g>
          <rect x="78" y="44" width="80" height="46" rx="6" fill={ART_FILL} {...common} transform="rotate(-8 118 67)" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <rect
              key={i}
              x={90 + i * 8}
              y={54 - i * 1.1}
              width={i % 3 === 0 ? 3.5 : 2}
              height="28"
              rx="1"
              fill={i % 2 === 0 ? ART_LINE : ART_LINE_SOFT}
              transform="rotate(-8 118 67)"
            />
          ))}
          <path d="M8 52 Q8 44 18 44 L52 44 Q62 44 62 54 L62 66 Q62 76 52 76 L30 76 L22 92 L20 76 L18 76 Q8 76 8 66 Z" fill={ART_FILL} {...common} />
          <rect x="20" y="56" width="30" height="8" rx="3" fill="rgba(62,123,224,0.28)" />
        </g>
      )}
      {index === 2 && (
        <g>
          <rect x="40" y="18" width="112" height="96" rx="10" fill={ART_FILL} {...common} />
          {[0, 1, 2].map(i => (
            <g key={i}>
              <path d={`M56 ${44 + i * 24} l5 5 l9 -11`} fill="none" stroke="rgba(127,179,245,0.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="78" y={40 + i * 24} width={58 - i * 12} height="4" rx="2" fill={ART_LINE_SOFT} />
            </g>
          ))}
        </g>
      )}
      {index === 3 && (
        <g>
          <rect x="36" y="24" width="116" height="84" rx="10" fill={ART_FILL} {...common} />
          <rect x="52" y="42" width="18" height="18" rx="5" fill="rgba(239,68,68,0.2)" stroke="rgba(239,68,68,0.45)" strokeWidth="1.1" />
          <path d="M57 47 l8 8 M65 47 l-8 8" stroke="rgba(248,113,113,0.8)" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="78" y="49" width="56" height="4" rx="2" fill="rgba(239,68,68,0.25)" />
          <rect x="52" y="72" width="18" height="18" rx="5" fill="rgba(16,185,129,0.18)" stroke="rgba(16,185,129,0.45)" strokeWidth="1.1" />
          <path d="M56.5 81 l4 4 l7 -8" fill="none" stroke="rgba(52,211,153,0.85)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="78" y="79" width="44" height="4" rx="2" fill="rgba(16,185,129,0.25)" />
        </g>
      )}
      {index === 4 && (
        <g>
          <rect x="30" y="26" width="126" height="80" rx="10" fill={ART_FILL} {...common} />
          <text x="46" y="50" fontSize="9.5" fontWeight="600" fill={ART_TEXT}>BlindScore</text>
          <text x="46" y="82" fontSize="30" fontWeight="700" fill="rgba(231,234,240,0.72)">92</text>
          <path d="M92 76 l6 -9 l6 9" fill="none" stroke="rgba(52,211,153,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          {[0, 1, 2].map(i => (
            <rect key={i} x={116 + i * 12} y={78 - i * 12} width="7" height={16 + i * 12} rx="2" fill="rgba(62,123,224,0.42)" />
          ))}
        </g>
      )}
      {index === 5 && (
        <g>
          <rect x="44" y="16" width="104" height="100" rx="8" fill={ART_FILL} {...common} />
          <rect x="58" y="32" width="44" height="5" rx="2.5" fill={ART_TEXT} />
          <rect x="58" y="46" width="72" height="3.5" rx="1.75" fill={ART_LINE_SOFT} />
          <rect x="58" y="55" width="56" height="3.5" rx="1.75" fill={ART_LINE_SOFT} />
          {[0, 1, 2, 3].map(i => (
            <rect key={i} x={58 + i * 15} y={96 - (10 + i * 8)} width="9" height={10 + i * 8} rx="2" fill="rgba(62,123,224,0.4)" />
          ))}
          <path d="M120 72 l10 -12 l10 -6" fill="none" stroke="rgba(127,179,245,0.5)" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

export function OperationalJourney() {
  const tier = useAnimationTier();
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const artRefs = useRef<(HTMLDivElement | null)[]>([]);

  useGSAP(
    () => {
      // `minimal` (reduced motion) não esconde nada: o estado inicial do DOM já é o final.
      if (tier === 'minimal') return;

      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: { trigger: headerRef.current, start: 'top 88%', once: true },
        }
      );

      // Linha de progresso acompanha o scroll da lista — sem pin, scroll vertical natural.
      if (progressRef.current && listRef.current) {
        gsap.fromTo(
          progressRef.current,
          { scaleY: 0 },
          {
            scaleY: 1,
            ease: 'none',
            scrollTrigger: { trigger: listRef.current, start: 'top 72%', end: 'bottom 78%', scrub: 0.5 },
          }
        );
      }

      STAGES.forEach((_, i) => {
        const card = cardRefs.current[i];
        if (!card) return;
        const trigger = { trigger: card, start: 'top 88%', once: true } as const;

        gsap.fromTo(
          card,
          { opacity: 0, y: 20, filter: 'blur(4px)' },
          { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5, ease: 'power2.out', scrollTrigger: trigger }
        );
        gsap.fromTo(
          iconRefs.current[i],
          { opacity: 0, scale: 0.8 },
          { opacity: 1, scale: 1, duration: 0.35, delay: 0.12, ease: 'back.out(1.8)', scrollTrigger: trigger }
        );
        gsap.fromTo(
          artRefs.current[i],
          { opacity: 0, x: 14 },
          { opacity: 1, x: 0, duration: 0.55, delay: 0.16, ease: 'power2.out', scrollTrigger: trigger }
        );
        // Nó acende uma única vez — nada fica pulsando depois.
        gsap.fromTo(
          nodeRefs.current[i],
          { scale: 0.7, opacity: 0.45 },
          { scale: 1, opacity: 1, duration: 0.4, delay: 0.06, ease: 'back.out(2.4)', scrollTrigger: trigger }
        );
      });
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  return (
    <section id="journey" ref={sectionRef} className="relative overflow-hidden bg-ink-950 py-20 sm:py-24 px-6">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[900px] rounded-full bg-enterprise-900/25 blur-[200px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[66rem]">
        <div ref={headerRef} className="text-center mb-12 lg:mb-14">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-enterprise-400/85">Como Funciona</p>
          <h2 className="mt-3 text-3xl sm:text-4xl lg:text-[2.5rem] font-semibold text-mist-100 tracking-tight leading-[1.12]">
            A jornada de uma operação sem pontos cegos.
          </h2>
          <p className="mt-3 text-sm sm:text-base text-mist-400">
            Do recebimento ao relatório final, cada etapa fica registrada.
          </p>
        </div>

        <p className="hidden md:block w-[70px] lg:w-[118px] pr-4 lg:pr-7 text-right text-[10px] leading-[1.45] text-mist-400/70 mb-4">
          <span className="block uppercase tracking-[0.18em] text-mist-400">Início</span>
          da operação
        </p>

        <div className="relative">
          {/* Trilho: começa e termina no centro do primeiro/último nó (cards têm 104px no desktop). */}
          <span
            aria-hidden="true"
            className="hidden md:block absolute top-[52px] bottom-[52px] w-px bg-ink-700 md:left-[35px] lg:left-[59px]"
          />
          <span
            ref={progressRef}
            aria-hidden="true"
            className="hidden md:block absolute top-[52px] bottom-[52px] w-px origin-top bg-enterprise-500/80 md:left-[35px] lg:left-[59px]"
          />

          <ol ref={listRef} className="space-y-3 lg:space-y-3.5">
            {STAGES.map((stage, i) => (
              <li key={stage.title} className="relative flex items-stretch">
                <span aria-hidden="true" className="hidden md:block md:w-[70px] lg:w-[118px] flex-shrink-0" />
                <span
                  ref={el => {
                    nodeRefs.current[i] = el;
                  }}
                  aria-hidden="true"
                  className="hidden md:grid place-items-center absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-enterprise-400/70 bg-ink-950 md:left-[35px] lg:left-[59px]"
                >
                  <span className="w-[5px] h-[5px] rounded-full bg-enterprise-300 shadow-[0_0_6px_rgba(127,179,245,0.65)]" />
                </span>
                <span
                  aria-hidden="true"
                  className="hidden md:block absolute top-1/2 h-px bg-enterprise-500/25 md:left-[35px] md:w-[35px] lg:left-[59px] lg:w-[59px]"
                />

                <div
                  ref={el => {
                    cardRefs.current[i] = el;
                  }}
                  className="relative flex-1 min-w-0 flex items-center gap-4 lg:gap-5 rounded-2xl overflow-hidden px-4 sm:px-5 lg:px-6 py-4 md:py-0 md:h-[104px]"
                  style={CARD_SURFACE}
                >
                  <div
                    ref={el => {
                      iconRefs.current[i] = el;
                    }}
                    className="w-12 h-12 lg:w-[52px] lg:h-[52px] rounded-[13px] border border-enterprise-500/20 bg-enterprise-500/[0.12] grid place-items-center text-enterprise-300 flex-shrink-0"
                  >
                    <stage.icon size={21} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold tracking-wide text-enterprise-400">
                      {String(i + 1).padStart(2, '0')}
                    </p>
                    <h3 className="mt-0.5 text-[17px] lg:text-[19px] font-semibold text-mist-100 leading-tight">
                      {stage.title}
                    </h3>
                    <p className="mt-1 text-[13px] text-mist-400 leading-snug">{stage.desc}</p>
                  </div>

                  <div
                    ref={el => {
                      artRefs.current[i] = el;
                    }}
                    aria-hidden="true"
                    className="hidden lg:block relative w-[168px] h-full flex-shrink-0 self-stretch"
                  >
                    <StageArt index={i} />
                  </div>

                  <span
                    aria-hidden="true"
                    className="hidden sm:grid place-items-center w-10 h-10 rounded-full border border-ink-600 bg-ink-900/70 text-mist-400 flex-shrink-0"
                  >
                    <ChevronRight size={17} />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="hidden md:block w-[70px] lg:w-[118px] pr-4 lg:pr-7 text-right text-[10px] leading-[1.45] text-mist-400/70 mt-4">
          <span className="block uppercase tracking-[0.18em] text-mist-400">Resultados</span>
          confiáveis
        </p>
      </div>
    </section>
  );
}
