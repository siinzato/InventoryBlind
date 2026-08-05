import { useRef, type MouseEvent } from 'react';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useReducedMotion, MagneticButton } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';
import { GlitterWrap } from '../effects/GlitterWrap';
import { useHeroAnimation } from '../animations/HeroAnimation';

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
  const headlineWrapperRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const glowFollowRef = useRef<HTMLDivElement>(null);
  const headlineParticleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const mockupRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const kpiTileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sparklineRef = useRef<SVGPolylineElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const tier = useAnimationTier();
  const reduce = useReducedMotion();

  const { speedRef } = useHeroAnimation({ sectionRef, highlightRef, headlineWrapperRef });

  const glowSetX = useRef<((v: number) => void) | null>(null);
  const glowSetY = useRef<((v: number) => void) | null>(null);
  const particleSetX = useRef<((v: number) => void) | null>(null);
  const particleSetY = useRef<((v: number) => void) | null>(null);

  useGSAP(
    () => {
      // Cursor-follow spotlight is user-driven (only moves if you move the mouse), so it
      // stays on even under prefers-reduced-motion — it's the autoplaying stuff below that
      // that preference should kill, not something the user's own cursor controls.
      if (glowFollowRef.current) {
        glowSetX.current = gsap.quickTo(glowFollowRef.current, 'x', { duration: 0.6, ease: 'power3' });
        glowSetY.current = gsap.quickTo(glowFollowRef.current, 'y', { duration: 0.6, ease: 'power3' });
      }

      if (tier === 'minimal') return;

      const split = headlineRef.current ? new SplitText(headlineRef.current, { type: 'words,chars' }) : null;
      if (split) gsap.set(split.chars, { yPercent: 130, rotateX: -80, opacity: 0 });
      gsap.set(headlineRef.current, { rotateX: 6, transformPerspective: 600 });

      gsap.set(mockupRef.current, { rotateX: 10, rotateY: -10, clipPath: 'inset(38% 0% 0% 0%)', opacity: 0.4 });
      gsap.set(kpiTileRefs.current, { opacity: 0, y: 14 });
      if (sparklineRef.current) gsap.set(sparklineRef.current, { drawSVG: '0%' });

      // Ambient drifting particles around the headline — independent slow loops, always alive.
      gsap.set(headlineParticleRefs.current, { opacity: 0 });
      headlineParticleRefs.current.forEach(p => {
        if (!p) return;
        gsap.to(p, { opacity: gsap.utils.random(0.25, 0.6), duration: 1, delay: gsap.utils.random(0.4, 1.4) });
        gsap.to(p, {
          y: gsap.utils.random(-16, 16),
          x: gsap.utils.random(-12, 12),
          duration: gsap.utils.random(3, 5.5),
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          delay: gsap.utils.random(0, 2),
        });
      });

      // Subtle particle parallax — desktop only, purely additive.
      if (tier === 'full' && particlesRef.current) {
        particleSetX.current = gsap.quickTo(particlesRef.current, 'x', { duration: 0.8, ease: 'power2' });
        particleSetY.current = gsap.quickTo(particlesRef.current, 'y', { duration: 0.8, ease: 'power2' });
      }

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

      // Idle "breathing" letters — tiny, independent, never enough to block reading.
      if (split) {
        tl.call(() => {
          split.chars.forEach(char => {
            gsap.to(char, {
              y: gsap.utils.random(-3, 3),
              rotate: gsap.utils.random(-1.2, 1.2),
              duration: gsap.utils.random(2.2, 3.8),
              repeat: -1,
              yoyo: true,
              ease: 'sine.inOut',
              delay: gsap.utils.random(0, 1.2),
            });
          });
        });
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

  const handleHeroMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (headlineWrapperRef.current && glowSetX.current && glowSetY.current) {
      const rect = headlineWrapperRef.current.getBoundingClientRect();
      glowSetX.current(e.clientX - rect.left - 210);
      glowSetY.current(e.clientY - rect.top - 210);
      gsap.to(glowFollowRef.current, { opacity: 1, duration: 0.3, overwrite: 'auto' });
    }
    if (particleSetX.current && particleSetY.current) {
      const rect = sectionRef.current?.getBoundingClientRect();
      if (rect) {
        const relX = (e.clientX - rect.left) / rect.width - 0.5;
        const relY = (e.clientY - rect.top) / rect.height - 0.5;
        particleSetX.current(relX * -24);
        particleSetY.current(relY * -24);
      }
    }
  };

  const handleHeroMouseLeave = () => {
    if (glowFollowRef.current) gsap.to(glowFollowRef.current, { opacity: 0, duration: 0.5 });
    if (particlesRef.current) gsap.to(particlesRef.current, { x: 0, y: 0, duration: 0.8, ease: 'power2.out' });
  };

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
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={handleHeroMouseLeave}
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
      <GlitterWrap speedRef={speedRef} className="pointer-events-none opacity-60" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 pt-28 text-center">
        <div ref={headlineWrapperRef} className="relative">
          <div
            ref={glowFollowRef}
            className="pointer-events-none absolute left-0 top-0 w-[420px] h-[420px] rounded-full opacity-0"
            style={{
              background: 'radial-gradient(circle, rgba(90,150,240,0.55), transparent 70%)',
              mixBlendMode: 'screen',
            }}
          />
          {tier !== 'minimal' &&
            Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                ref={el => {
                  headlineParticleRefs.current[i] = el;
                }}
                className="pointer-events-none absolute w-1 h-1 rounded-full bg-enterprise-300"
                style={{ left: `${8 + ((i * 53) % 84)}%`, top: `${((i * 31) % 100)}%` }}
              />
            ))}

          <span className="relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-ink-600 bg-ink-900/60 text-xs font-medium text-enterprise-300 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-enterprise-400" /> Plataforma de Inventário Inteligente
          </span>

          <h1
            ref={headlineRef}
            className="relative text-4xl sm:text-5xl lg:text-6xl font-semibold text-mist-100 tracking-tight leading-[1.08] mb-6"
          >
            O futuro do inventário é preciso, inteligente e{' '}
            <span
              ref={highlightRef}
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: 'linear-gradient(120deg, #E7EAF0 42%, #7FB3F5 50%, #E7EAF0 58%)',
                backgroundSize: '300% 100%',
              }}
            >
              sem pontos cegos.
            </span>
          </h1>
        </div>

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
