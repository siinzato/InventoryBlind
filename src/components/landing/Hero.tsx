import { useRef, type MouseEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  ChevronDown,
  Database,
  Home,
  ListChecks,
  Map as MapIcon,
  Package,
  PlayCircle,
  Search,
  Settings,
  Shield,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useReducedMotion, MagneticButton } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';
import { GlitterWrap } from '../effects/GlitterWrap';
import { useHeroAnimation } from '../animations/HeroAnimation';
import { Logo } from './landingUi';

interface HeroProps {
  onSignup: () => void;
}

/** Faixa discreta logo abaixo dos CTAs — número de demonstração, não vem do banco. */
const METRICS: { icon: LucideIcon; label: string; value: string }[] = [
  { icon: Target, label: 'Acuracidade', value: '99,2%' },
  { icon: BarChart3, label: 'Divergências', value: '-64%' },
  { icon: Shield, label: 'BlindScore', value: '92' },
];

// ── Interface ilustrativa do mockup ────────────────────────────────────────
// Mesma linguagem visual da seção "Sua operação, sob controle total." — aqui em
// versão estática, para o Hero mostrar o produto sem repetir a animação
// cinematográfica (nem o custo de scroll) da seção seguinte.

const MOCK_NAV: { icon: LucideIcon; label: string }[] = [
  { icon: Home, label: 'Visão Geral' },
  { icon: Database, label: 'Inventários' },
  { icon: ListChecks, label: 'Contagens' },
  { icon: AlertTriangle, label: 'Divergências' },
  { icon: BarChart3, label: 'Relatórios' },
  { icon: MapIcon, label: 'Mapeamento' },
  { icon: Settings, label: 'Configurações' },
];

const MOCK_KPIS: { icon: LucideIcon; label: string; value: string; delta: string }[] = [
  { icon: Package, label: 'Itens Conferidos', value: '128.400', delta: '+12%' },
  { icon: BarChart3, label: 'Divergências Corrigidas', value: '3.120', delta: '+28%' },
  { icon: Target, label: 'Acuracidade Média', value: '99,2%', delta: '+2,1%' },
  { icon: Shield, label: 'BlindScore', value: '92', delta: '+6 pontos' },
];

const CHART_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago'];
const HEAT_COLS = 9;
const HEAT_ROWS = 3;
const RISK_INDEX = 20;

export function Hero({ onSignup }: HeroProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineWrapperRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const splitTargetRef = useRef<HTMLSpanElement>(null);
  const glowFollowRef = useRef<HTMLDivElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const kpiTileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sparklineRef = useRef<SVGPathElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const tier = useAnimationTier();
  const reduce = useReducedMotion();

  const { speedRef } = useHeroAnimation({ sectionRef, highlightRef, headlineWrapperRef });

  const glowSetX = useRef<((v: number) => void) | null>(null);
  const glowSetY = useRef<((v: number) => void) | null>(null);

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

      // Only the plain-text lead-in is char-split — "sem pontos cegos." keeps its gradient
      // background-clip text intact as a single element. SplitText wraps each character in
      // a new span that inherits color:transparent but NOT the parent's background-image/
      // background-clip, so splitting a gradient-clipped span makes that text permanently
      // invisible once the reveal finishes. It gets its own simple fade below instead.
      const split = splitTargetRef.current ? new SplitText(splitTargetRef.current, { type: 'words,chars' }) : null;
      if (split) gsap.set(split.chars, { yPercent: 120, opacity: 0, backfaceVisibility: 'hidden' });
      gsap.set(highlightRef.current, { opacity: 0, y: 12 });

      // Entrada do produto: quase frontal desde o início — resta só um grau de
      // perspectiva e o corte superior, para o mockup transmitir estabilidade em
      // vez de parecer uma peça 3D girando.
      gsap.set(mockupRef.current, {
        rotateX: 5,
        clipPath: 'inset(20% 0% 0% 0%)',
        opacity: 0.35,
        willChange: 'transform, clip-path',
      });
      gsap.set(kpiTileRefs.current, { opacity: 0, y: 12 });
      if (sparklineRef.current) gsap.set(sparklineRef.current, { drawSVG: '0%' });

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      if (split) {
        tl.to(
          split.chars,
          { yPercent: 0, opacity: 1, duration: 0.6, stagger: { each: 0.012, from: 'start' }, ease: 'power3.out' },
          0.05
        );
      }
      tl.to(highlightRef.current, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.45);

      tl.fromTo('.hero-subtext', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7 }, 0.5)
        .to('.hero-ctas', { opacity: 1, y: 0, duration: 0.6 }, 0.64)
        .to('.hero-metrics', { opacity: 1, y: 0, duration: 0.6 }, 0.74)
        .to(mockupRef.current, { opacity: 1, duration: 0.9 }, 0.5)
        .to(mockupRef.current, { rotateX: 0, duration: 1.1 }, 0.6)
        .to(kpiTileRefs.current, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07 }, 0.9);

      if (sparklineRef.current) {
        tl.to(sparklineRef.current, { drawSVG: '100%', duration: 0.7, ease: 'power1.inOut' }, 1);
      }

      // O corte superior termina de abrir com o scroll — mesma mecânica de antes,
      // sem a rotação que empurrava o produto para fora do eixo.
      gsap.to(mockupRef.current, {
        clipPath: 'inset(0% 0% 0% 0%)',
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: 0.6 },
      });

      if (tier === 'full') {
        gsap.to(glowRef.current, { yPercent: 14, ease: 'none', scrollTrigger: { trigger: sectionRef.current, scrub: 0.4 } });
        gsap.to(gridRef.current, { yPercent: 22, ease: 'none', scrollTrigger: { trigger: sectionRef.current, scrub: 0.4 } });
      }

      return () => split?.revert();
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  const handleHeroMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (headlineWrapperRef.current && glowSetX.current && glowSetY.current) {
      const rect = headlineWrapperRef.current.getBoundingClientRect();
      glowSetX.current(e.clientX - rect.left - 170);
      glowSetY.current(e.clientY - rect.top - 170);
      gsap.to(glowFollowRef.current, { opacity: 1, duration: 0.3, overwrite: 'auto' });
    }
  };

  const handleHeroMouseLeave = () => {
    if (glowFollowRef.current) gsap.to(glowFollowRef.current, { opacity: 0, duration: 0.5 });
  };

  const hidden = tier === 'minimal' ? '' : 'opacity-0 translate-y-3';

  const scrollToDashboard = () => {
    document.querySelector('#dashboard')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section
      id="top"
      ref={sectionRef}
      className="relative flex flex-col items-center overflow-hidden bg-ink-950 pt-28 sm:pt-32 xl:pt-36 pb-16 sm:pb-20"
      style={{ perspective: 1400 }}
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={handleHeroMouseLeave}
    >
      <div ref={glowRef} className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[26%] -translate-x-1/2 -translate-y-1/2 w-[1100px] h-[780px] rounded-full bg-enterprise-700/20 blur-[180px]" />
      </div>
      <div
        ref={gridRef}
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <GlitterWrap speedRef={speedRef} className="pointer-events-none opacity-25" />

      <div className="relative z-10 w-full max-w-4xl px-6 text-center">
        <div ref={headlineWrapperRef} className="relative">
          <div
            ref={glowFollowRef}
            className="pointer-events-none absolute left-0 top-0 w-[340px] h-[340px] rounded-full opacity-0"
            style={{
              background: 'radial-gradient(circle, rgba(90,150,240,0.30), transparent 70%)',
              mixBlendMode: 'screen',
            }}
          />

          <h1
            ref={headlineRef}
            className="relative text-[2.1rem] sm:text-5xl lg:text-[3.25rem] xl:text-[3.5rem] font-semibold text-mist-100 tracking-[-0.025em] leading-[1.07]"
          >
            <span ref={splitTargetRef}>Inventário auditado é preciso, rastreável e{' '}</span>
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

        <p
          className={`hero-subtext ${hidden} mt-6 text-base sm:text-[1.0625rem] text-mist-400 leading-relaxed max-w-[40rem] mx-auto`}
        >
          Do recebimento ao fechamento do inventário, o InventoryBlind conecta dados, contagens e inteligência para
          transformar cada divergência em uma decisão confiável.
        </p>

        <div className={`hero-ctas ${hidden} mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5`}>
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

        <div className={`hero-metrics ${hidden} mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 sm:gap-x-7`}>
          {METRICS.map(({ icon: Icon, label, value }, i) => (
            <div key={label} className="flex items-center gap-5 sm:gap-7">
              {i > 0 && <span aria-hidden className="hidden sm:block w-px h-4 bg-ink-600" />}
              <span className="inline-flex items-center gap-2 text-[13px]">
                <Icon size={14} className="text-enterprise-400 flex-shrink-0" />
                <span className="text-mist-400">{label}</span>
                <span className="font-semibold text-mist-100 tabular-nums">{value}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-9 sm:mt-10 w-[92%] sm:w-[88%] lg:w-[74%] max-w-[88rem]">
        <div
          ref={mockupRef}
          className="relative rounded-[20px] overflow-hidden text-left"
          style={{
            transformStyle: 'preserve-3d',
            // Superfície do card: vidro fumê escuro. O fundo não é opaco (0.86),
            // então o grid e o glow do Hero atravessam de leve; o backdrop-blur é
            // mínimo, só o suficiente para o material parecer laminado e não
            // recortado. As camadas, de cima para baixo: reflexo superior que
            // morre em ~30% da altura, um halo azul muito fraco vindo de fora do
            // topo e um degradê escuro que fecha a base.
            backgroundColor: 'rgba(9,11,16,0.86)',
            backgroundImage: [
              'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.014) 12%, rgba(255,255,255,0) 30%)',
              'radial-gradient(130% 70% at 50% -8%, rgba(127,179,245,0.09), rgba(127,179,245,0) 58%)',
              'linear-gradient(180deg, rgba(18,22,31,0.5), rgba(6,8,12,0.72))',
            ].join(', '),
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            border: '1px solid rgba(150,178,224,0.20)',
            // Duas insets desenham a "pele" (fio de luz no topo + anel interno de
            // 1px); as três externas fazem a elevação, escura e sem glow.
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,0.085)',
              'inset 0 0 0 1px rgba(255,255,255,0.025)',
              '0 2px 6px rgba(0,0,0,0.45)',
              '0 18px 40px -12px rgba(0,0,0,0.65)',
              '0 48px 100px -28px rgba(0,0,0,0.8)',
            ].join(', '),
          }}
        >
          {/* Barra do app */}
          <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-4 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <Logo size={25} />
              <span className="text-[15px] font-semibold text-mist-100 tracking-tight">InventoryBlind</span>
            </div>
            <div className="hidden md:flex items-center gap-2 flex-1 max-w-[248px] ml-auto rounded-[10px] border border-white/[0.08] bg-white/[0.045] px-3 py-2">
              <Search size={14} className="text-mist-400 flex-shrink-0" />
              <span className="text-xs text-mist-400">Buscar no sistema...</span>
            </div>
            <div className="flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.045] pl-1.5 pr-2.5 py-1.5">
              <span className="w-7 h-7 rounded-full bg-enterprise-500 text-white text-[11px] font-semibold grid place-items-center">
                JS
              </span>
              <span className="hidden sm:block leading-tight">
                <span className="block text-xs font-medium text-mist-100">João Silva</span>
                <span className="block text-[11px] text-mist-400">Operações</span>
              </span>
              <ChevronDown size={12} className="text-mist-400" />
            </div>
          </div>

          <div className="flex">
            {/* Menu lateral */}
            <div className="hidden sm:block w-[170px] lg:w-[184px] flex-shrink-0 border-r border-white/[0.07] p-3 space-y-0.5">
              {MOCK_NAV.map(({ icon: Icon, label }, i) => (
                <div
                  key={label}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs ${
                    i === 0 ? 'bg-enterprise-500/15 text-enterprise-300' : 'text-mist-400'
                  }`}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  {label}
                </div>
              ))}
            </div>

            {/* Conteúdo */}
            <div className="flex-1 min-w-0 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base sm:text-[19px] font-semibold text-mist-100 tracking-tight">
                    Sua operação, sob controle total.
                  </p>
                  <p className="text-xs text-mist-400 mt-1">
                    Interface ilustrativa — indicadores, HeatMap e BlindAI em ação.
                  </p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1.5 flex-shrink-0 rounded-[10px] border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-xs text-mist-400">
                  <Bot size={12} className="text-enterprise-300" /> BlindAI ativo
                  <ChevronDown size={11} className="-rotate-90" />
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {MOCK_KPIS.map(({ icon: Icon, label, value, delta }, i) => (
                  <div
                    key={label}
                    ref={el => {
                      kpiTileRefs.current[i] = el;
                    }}
                    className="rounded-xl border border-white/[0.085] bg-white/[0.042] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11.5px] text-mist-400 leading-tight">{label}</p>
                      <Icon size={15} className="text-enterprise-300 flex-shrink-0" />
                    </div>
                    <p className="mt-1.5 text-xl sm:text-[22px] font-semibold text-mist-100 tabular-nums">{value}</p>
                    <p className="mt-1 flex items-center gap-1 text-[10.5px] text-mist-400">
                      <TrendingUp size={11} className="text-emerald-400 flex-shrink-0" />
                      <span className="text-emerald-400 font-medium">{delta}</span> vs. período anterior
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3.5 grid lg:grid-cols-2 gap-3.5">
                <div className="rounded-xl border border-white/[0.085] bg-white/[0.042] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
                  <p className="text-xs text-mist-400">Divergências ao longo do tempo</p>
                  <div className="mt-2 flex gap-2">
                    <div className="flex flex-col justify-between text-[10px] text-mist-400/70 tabular-nums py-0.5">
                      {['400', '300', '200', '100'].map(t => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <svg viewBox="0 0 400 110" preserveAspectRatio="none" className="w-full h-[96px]">
                      {[10, 35, 60, 85].map(y => (
                        <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="rgba(255,255,255,0.055)" strokeWidth="1" />
                      ))}
                      <path
                        d="M0,92 C60,88 90,90 130,84 C170,78 200,80 240,74 C280,68 320,66 400,60"
                        fill="none"
                        stroke="#2A2F3B"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        ref={sparklineRef}
                        d="M0,88 C60,84 90,86 130,62 C170,40 200,48 240,36 C280,26 320,22 400,14"
                        fill="none"
                        stroke="#7FB3F5"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <div className="mt-1.5 flex justify-between pl-7 text-[10px] text-mist-400/70">
                    {CHART_MONTHS.map(m => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.085] bg-white/[0.042] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
                  <p className="text-xs text-mist-400">HeatMap de risco por posição</p>
                  <div
                    className="mt-2 grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${HEAT_COLS}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: HEAT_COLS * HEAT_ROWS }).map((_, i) => {
                      const isRisk = i === RISK_INDEX;
                      const intensity = ((i * 37) % 100) / 100;
                      return (
                        <div
                          key={i}
                          className="h-6 rounded"
                          style={{
                            backgroundColor: isRisk ? '#EF4444' : `rgba(62,123,224,${0.14 + intensity * 0.5})`,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-3.5 text-[10.5px] text-mist-400">
                    {[
                      ['Baixo risco', 'rgba(62,123,224,0.35)'],
                      ['Médio risco', '#3E7BE0'],
                      ['Alto risco', '#EF4444'],
                    ].map(([label, color]) => (
                      <span key={label} className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
