import { useRef } from 'react';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useReducedMotion, MagneticButton } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';

interface HeroProps {
  onSignup: () => void;
}

const STATS: [string, string][] = [
  ['Acuracidade', '99,2%'],
  ['Divergências', '-64%'],
  ['BlindScore', '92'],
];

export function Hero({ onSignup }: HeroProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const kpiTileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sparklineRef = useRef<SVGPolylineElement>(null);
  const tier = useAnimationTier();
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      if (tier === 'minimal') return;

      const split = headlineRef.current ? new SplitText(headlineRef.current, { type: 'words,chars' }) : null;
      if (split) gsap.set(split.chars, { yPercent: 130, rotateX: -80, opacity: 0 });
      gsap.set(headlineRef.current, { rotateX: 6, transformPerspective: 600 });

      gsap.set(mockupRef.current, { rotateX: 10, rotateY: -10, clipPath: 'inset(38% 0% 0% 0%)', opacity: 0.4 });
      gsap.set(kpiTileRefs.current, { opacity: 0, y: 14 });
      if (sparklineRef.current) gsap.set(sparklineRef.current, { drawSVG: '0%' });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to(headlineRef.current, { rotateX: 0, duration: 1.1, ease: 'power2.out' }, 0);
      if (split) {
        tl.to(
          split.chars,
          { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.6, stagger: { each: 0.012, from: 'start' }, ease: 'back.out(1.6)' },
          0.1
        );
      }
      tl.fromTo(
        '.hero-subtext',
        { filter: 'blur(8px)', opacity: 0, y: 16 },
        { filter: 'blur(0px)', opacity: 1, y: 0, duration: 0.8 },
        0.55
      )
        .to('.hero-ctas', { opacity: 1, y: 0, duration: 0.6 }, 0.7)
        .to(mockupRef.current, { opacity: 1, duration: 0.8 }, 0.5)
        .to(kpiTileRefs.current, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, 0.78);

      if (sparklineRef.current) {
        tl.to(sparklineRef.current, { drawSVG: '100%', duration: 0.6, ease: 'power1.inOut' }, 0.95);
      }

      if (tier === 'full') {
        tl.to(mockupRef.current, { rotateX: 0, rotateY: 0, duration: 1.1 }, 0.6);
      }

      gsap.to(mockupRef.current, {
        clipPath: 'inset(0% 0% 0% 0%)',
        rotateX: 0,
        rotateY: 0,
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 0.6 },
      });

      if (tier === 'full') {
        gsap.to(glowRef.current, { yPercent: 18, ease: 'none', scrollTrigger: { trigger: sectionRef.current, scrub: 0.4 } });
        gsap.to(gridRef.current, {
          yPercent: 32,
          rotateZ: 1.5,
          ease: 'none',
          scrollTrigger: { trigger: sectionRef.current, scrub: 0.4 },
        });
        gsap.to(particlesRef.current, { yPercent: 55, ease: 'none', scrollTrigger: { trigger: sectionRef.current, scrub: 0.4 } });
      }

      return () => split?.revert();
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  const hidden = tier === 'minimal' ? '' : 'opacity-0 translate-y-3';

  const scrollToDashboard = () => {
    document.querySelector('#dashboard')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative h-screen flex flex-col items-center overflow-hidden bg-ink-950"
      style={{ perspective: 1200 }}
    >
      <div ref={glowRef} className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[28%] -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-enterprise-700/25 blur-[160px]" />
      </div>
      <div
        ref={gridRef}
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      {tier === 'full' && (
        <div ref={particlesRef} className="pointer-events-none absolute inset-0">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="absolute w-1 h-1 rounded-full bg-enterprise-300/50"
              style={{ left: `${(i * 41) % 100}%`, top: `${(i * 67) % 100}%` }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 max-w-4xl mx-auto px-6 pt-28 text-center">
        <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-ink-600 bg-ink-900/60 text-xs font-medium text-enterprise-300 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-enterprise-400" /> Plataforma de Inventário Inteligente
        </span>

        <h1
          ref={headlineRef}
          className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-mist-100 tracking-tight leading-[1.08] mb-6"
        >
          O futuro do inventário é preciso, inteligente e sem pontos cegos.
        </h1>

        <p className={`hero-subtext ${hidden} text-lg text-mist-400 max-w-2xl mx-auto mb-10`}>
          InventoryBlind une conferência por NF-e, contagem cega, HeatMap de risco e um assistente de IA em uma única
          operação — do recebimento ao relatório final.
        </p>

        <div className={`hero-ctas ${hidden} flex flex-col sm:flex-row items-center justify-center gap-4`}>
          <MagneticButton onClick={onSignup} className="px-7 py-3.5 rounded-full text-sm font-semibold inline-flex items-center gap-2">
            Começar Gratuitamente <ArrowRight size={16} />
          </MagneticButton>
          <MagneticButton
            variant="ghost"
            onClick={scrollToDashboard}
            className="px-7 py-3.5 rounded-full text-sm font-semibold inline-flex items-center gap-2"
          >
            <PlayCircle size={16} /> Ver Demonstração
          </MagneticButton>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-3xl px-6 mt-auto translate-y-[15%]" style={{ perspective: 1200 }}>
        <div
          ref={mockupRef}
          className="rounded-2xl border border-ink-700 bg-ink-900/80 backdrop-blur shadow-2xl shadow-black/50 overflow-hidden"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-ink-700">
            <span className="w-2.5 h-2.5 rounded-full bg-mist-400/30" />
            <span className="w-2.5 h-2.5 rounded-full bg-mist-400/30" />
            <span className="w-2.5 h-2.5 rounded-full bg-mist-400/30" />
          </div>
          <div className="grid grid-cols-3 gap-px bg-ink-700">
            {STATS.map(([label, value], i) => (
              <div
                key={label}
                ref={el => {
                  kpiTileRefs.current[i] = el;
                }}
                className="bg-ink-900 px-5 py-4"
              >
                <p className="text-xs text-mist-400 mb-1">{label}</p>
                <p className="text-xl font-semibold text-mist-100">{value}</p>
              </div>
            ))}
          </div>
          <div className="p-5">
            <svg viewBox="0 0 400 80" className="w-full h-20">
              <polyline
                ref={sparklineRef}
                points="0,60 50,45 100,50 150,30 200,38 250,18 300,26 350,10 400,16"
                fill="none"
                stroke="#3E7BE0"
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
