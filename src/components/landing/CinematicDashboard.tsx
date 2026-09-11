import { useRef, type CSSProperties } from 'react';
import { AlertTriangle, BarChart3, Bot, Package, Shield, Target, TrendingUp, Zap, type LucideIcon } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useGSAP, gsap } from './landingScroll';

interface KpiDef {
  icon: LucideIcon;
  label: string;
  end: number;
  decimals?: number;
  suffix?: string;
  delta: string;
}

/** Números de demonstração — a seção é uma interface ilustrativa, não consulta o banco. */
const KPIS: KpiDef[] = [
  { icon: Package, label: 'Itens Conferidos', end: 128400, delta: '+12%' },
  { icon: BarChart3, label: 'Divergências Corrigidas', end: 3120, delta: '+28%' },
  { icon: Target, label: 'Acuracidade Média', end: 99.2, decimals: 1, suffix: '%', delta: '+2,1 p.p.' },
  { icon: Shield, label: 'BlindScore', end: 92, delta: '+6 pontos' },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: 'Decisões mais rápidas', text: 'Dados em tempo real.' },
  { icon: Target, title: 'Menos perdas', text: 'Aja antes que vire um problema.' },
  { icon: BarChart3, title: 'Operação mais inteligente', text: 'Com o suporte da BlindAI.' },
];

const CHART_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'];
const CHART_Y_LABELS = ['4.000', '3.000', '2.000', '1.000', '0'];
const CHART_LINE = 'M0,108 C26,104 54,96 80,91 C106,86 134,76 160,67 C186,62 214,58 240,55 C266,50 294,40 320,33 C346,27 366,21 396,16';
const CHART_BASE = 'M0,116 C80,114 160,112 240,109 C320,107 360,106 396,104';

const HEAT_COLS = 9;
const HEAT_ROWS = 3;
const RISK_INDEX = 20;
const RISK_ROW = Math.floor(RISK_INDEX / HEAT_COLS);
const RISK_COL = RISK_INDEX % HEAT_COLS;

/** pt-BR com separador de milhar — o preview mostra 128.400, não 128400. */
function formatKpi(n: number, decimals = 0, suffix = '') {
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
}

function addKpiCounter(timeline: gsap.core.Timeline, el: Element | null | undefined, kpi: KpiDef, position: gsap.Position) {
  if (!el) return;
  const target = el as HTMLElement;
  const counter = { val: 0 };
  target.textContent = formatKpi(0, kpi.decimals, kpi.suffix);
  timeline.to(
    counter,
    {
      val: kpi.end,
      ease: 'none',
      onUpdate: () => {
        target.textContent = formatKpi(counter.val, kpi.decimals, kpi.suffix);
      },
    },
    position
  );
}

const KPI_SHADOW_REST = 'inset 0 1px 0 rgba(255,255,255,0.045), 0 0 0 0 rgba(62,123,224,0)';
const KPI_SHADOW_ON = 'inset 0 1px 0 rgba(255,255,255,0.045), 0 0 0 1px rgba(62,123,224,0.38)';

export function CinematicDashboard() {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const headerIconRef = useRef<SVGSVGElement>(null);
  const kpiCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const kpiValueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const chartLabelRef = useRef<HTMLParagraphElement>(null);
  const chartAreaRef = useRef<SVGPathElement>(null);
  const chartPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const chartDotRef = useRef<SVGCircleElement>(null);
  const heatGridRef = useRef<HTMLDivElement>(null);
  const heatCellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const riskCellRef = useRef<HTMLDivElement | null>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const annotationIconRef = useRef<SVGSVGElement>(null);
  const tier = useAnimationTier();

  useGSAP(
    () => {
      if (tier === 'minimal') {
        KPIS.forEach((k, i) => {
          const el = kpiValueRefs.current[i];
          if (el) el.textContent = formatKpi(k.end, k.decimals, k.suffix);
        });
        gsap.set(chartPathRefs.current, { drawSVG: '100%' });
        gsap.set([chartAreaRef.current, chartDotRef.current], { opacity: 1 });
        gsap.set(heatCellRefs.current, { opacity: 1 });
        gsap.set(connectorRef.current, { scaleX: 1 });
        gsap.set(annotationRef.current, { opacity: 1, x: 0, scale: 1 });
        return;
      }

      const full = tier === 'full';
      const d = (scrubDuration: number, realDuration: number) => (full ? scrubDuration : realDuration);

      const tl = gsap.timeline({
        scrollTrigger: full
          ? { trigger: sectionRef.current, start: 'top top', end: '+=3400', scrub: 1, pin: true, pinType: 'transform', anticipatePin: 1 }
          : { trigger: sectionRef.current, start: 'top 72%', once: true },
      });

      // ── 1. Painel surge ──────────────────────────────────────────────────
      tl.addLabel('structure', 0)
        .fromTo(
          frameRef.current,
          { scale: 0.94, opacity: 0.3, filter: 'blur(10px)', willChange: 'filter, transform' },
          { scale: 1, opacity: 1, filter: 'blur(0px)', duration: d(0.1, 0.6), ease: 'power2.out' },
          'structure'
        )
        .fromTo(headerIconRef.current, { rotate: -90, scale: 0 }, { rotate: 0, scale: 1, duration: d(0.06, 0.3), ease: 'back.out(2)' }, 'structure+=0.06');

      // ── 2. KPIs acendem ──────────────────────────────────────────────────
      tl.addLabel('kpisOn', d(0.14, 0.7))
        .fromTo(
          kpiCardRefs.current,
          { y: 22, opacity: 0 },
          { y: 0, opacity: 1, duration: d(0.1, 0.45), stagger: d(0.035, 0.09), ease: 'power2.out' },
          'kpisOn'
        )
        .fromTo(
          kpiCardRefs.current,
          { boxShadow: KPI_SHADOW_REST },
          { boxShadow: KPI_SHADOW_ON, duration: d(0.06, 0.28), stagger: d(0.035, 0.09), yoyo: true, repeat: 1, ease: 'power1.inOut' },
          'kpisOn'
        );

      // ── 3. Contadores ────────────────────────────────────────────────────
      tl.addLabel('counters', d(0.26, 1.2));
      KPIS.forEach((k, i) => {
        addKpiCounter(tl, kpiValueRefs.current[i], k, `counters+=${d(0.02, 0.1) * i}`);
      });

      // ── 4. Gráfico é desenhado ───────────────────────────────────────────
      tl.addLabel('lines', d(0.42, 1.9))
        .fromTo(chartLabelRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: d(0.07, 0.35) }, 'lines')
        .fromTo(
          chartPathRefs.current,
          { drawSVG: '0%' },
          { drawSVG: '100%', duration: d(0.2, 0.9), stagger: d(0.05, 0.15), ease: 'power1.inOut' },
          'lines+=0.02'
        )
        .fromTo(chartAreaRef.current, { opacity: 0 }, { opacity: 1, duration: d(0.14, 0.7), ease: 'power1.out' }, 'lines+=0.08')
        .fromTo(chartDotRef.current, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: d(0.05, 0.25), ease: 'back.out(2)' }, 'lines+=0.2');

      // ── 5. HeatMap aparece ───────────────────────────────────────────────
      tl.addLabel('heatmap', d(0.64, 3.0))
        .fromTo(
          heatGridRef.current,
          { clipPath: 'inset(0% 100% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: d(0.1, 0.5), ease: 'power2.inOut' },
          'heatmap'
        )
        .fromTo(
          heatCellRefs.current,
          { opacity: 0, scale: 0.7 },
          { opacity: 1, scale: 1, duration: d(0.01, 0.2), stagger: d(0.012, 0.01), ease: 'power1.out' },
          'heatmap+=0.04'
        );

      // ── 6. Célula de risco pulsa uma única vez ───────────────────────────
      tl.addLabel('risk', d(0.84, 3.8))
        .to(riskCellRef.current, { scale: 1.2, duration: d(0.05, 0.2), yoyo: true, repeat: 1, ease: 'power1.inOut' }, 'risk')
        .fromTo(connectorRef.current, { scaleX: 0 }, { scaleX: 1, duration: d(0.05, 0.25), ease: 'power2.out' }, 'risk+=0.04');

      // ── 7. Callout do BlindAI ────────────────────────────────────────────
      tl.addLabel('callout', d(0.9, 4.1))
        .fromTo(annotationIconRef.current, { rotate: -90, scale: 0 }, { rotate: 0, scale: 1, duration: d(0.06, 0.3), ease: 'back.out(2.2)' }, 'callout')
        .fromTo(
          annotationRef.current,
          { opacity: 0, x: 16, scale: 0.95 },
          { opacity: 1, x: 0, scale: 1, duration: d(0.12, 0.4), ease: 'back.out(1.6)' },
          'callout'
        );
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  return (
    <section
      id="dashboard"
      ref={sectionRef}
      className="relative min-h-screen lg:h-screen flex items-center justify-center overflow-hidden bg-ink-900 px-6 py-20 lg:py-0"
    >
      {/* Fundo intencionalmente mais calmo que o do Hero: um glow largo e um grid quase invisível. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1300px] h-[820px] rounded-full bg-enterprise-900/35 blur-[200px]" />
        <div
          className="absolute inset-0 opacity-[0.028]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[78rem]">
        <div className="text-center mb-7 sm:mb-9">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-enterprise-400/85">Visão Operacional</p>
          <h2 className="mt-3 text-2xl sm:text-3xl lg:text-[2.125rem] font-semibold text-mist-100 tracking-tight">
            Sua operação, sob controle total.
          </h2>
          <p className="mt-2 text-sm sm:text-[0.9375rem] text-mist-400">
            Interface ilustrativa — indicadores, HeatMap e BlindAI em ação.
          </p>
        </div>

        <div
          ref={frameRef}
          className="rounded-[20px] overflow-hidden"
          style={{
            // Superfície única do painel: ink profundo com alpha, um reflexo que morre no
            // primeiro terço e um halo azul fraco vindo de fora do topo. Sem chrome de janela.
            backgroundColor: 'rgba(8,10,15,0.74)',
            backgroundImage: [
              'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.012) 14%, rgba(255,255,255,0) 32%)',
              'radial-gradient(120% 70% at 50% -10%, rgba(127,179,245,0.08), rgba(127,179,245,0) 60%)',
              'linear-gradient(180deg, rgba(18,22,31,0.45), rgba(6,8,12,0.7))',
            ].join(', '),
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(140,170,215,0.17)',
            boxShadow: [
              'inset 0 1px 0 rgba(255,255,255,0.075)',
              'inset 0 0 0 1px rgba(255,255,255,0.022)',
              '0 2px 6px rgba(0,0,0,0.4)',
              '0 22px 48px -14px rgba(0,0,0,0.6)',
              '0 56px 110px -30px rgba(0,0,0,0.75)',
            ].join(', '),
          }}
        >
          <div className="flex items-center justify-end px-5 sm:px-6 py-3 border-b border-white/[0.06]">
            <span className="inline-flex items-center gap-2 text-[11.5px] font-medium text-enterprise-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
              <Bot ref={headerIconRef} size={13} /> BlindAI ativo
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-5 sm:px-6 pt-5">
            {KPIS.map((kpi, i) => (
              <div
                key={kpi.label}
                ref={el => {
                  kpiCardRefs.current[i] = el;
                }}
                className="rounded-xl border border-white/[0.075] bg-white/[0.035] px-4 sm:px-5 py-3.5"
                style={{ boxShadow: KPI_SHADOW_REST }}
              >
                <p className="flex items-center gap-2 text-[11.5px] text-mist-400">
                  <kpi.icon size={13} className="text-enterprise-400 flex-shrink-0" />
                  <span className="leading-snug">{kpi.label}</span>
                </p>
                <span
                  ref={el => {
                    kpiValueRefs.current[i] = el;
                  }}
                  className="mt-1.5 block text-2xl sm:text-[1.75rem] font-semibold text-mist-100 tabular-nums leading-none"
                >
                  0
                </span>
                <p className="mt-2 flex items-center gap-1 text-[10.5px] text-mist-400">
                  <TrendingUp size={11} className="text-emerald-400 flex-shrink-0" />
                  <span className="text-emerald-400 font-medium">{kpi.delta}</span>
                  <span className="hidden sm:inline">vs. período anterior</span>
                </p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-3.5 p-5 sm:p-6">
            <div className="rounded-xl border border-white/[0.075] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p ref={chartLabelRef} className="text-[11.5px] text-mist-400 mb-3 inline-flex items-center gap-1.5">
                <TrendingUp size={13} className="text-enterprise-400" /> Divergências ao longo do tempo
              </p>
              <div className="flex gap-2">
                <div className="flex flex-col justify-between h-[128px] text-[9.5px] text-mist-400/70 tabular-nums text-right w-8 flex-shrink-0 py-px">
                  {CHART_Y_LABELS.map(l => (
                    <span key={l}>{l}</span>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="w-full h-[128px] overflow-visible">
                    <defs>
                      <linearGradient id="cdAreaFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3E7BE0" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="#3E7BE0" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[0, 30, 60, 90, 120].map(y => (
                      <line
                        key={y}
                        x1="0"
                        y1={y}
                        x2="400"
                        y2={y}
                        stroke="rgba(255,255,255,0.055)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <path ref={chartAreaRef} d={`${CHART_LINE} L396,120 L0,120 Z`} fill="url(#cdAreaFill)" />
                    <path
                      ref={el => {
                        chartPathRefs.current[1] = el;
                      }}
                      d={CHART_BASE}
                      fill="none"
                      stroke="#2A2F3B"
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      ref={el => {
                        chartPathRefs.current[0] = el;
                      }}
                      d={CHART_LINE}
                      fill="none"
                      stroke="#7FB3F5"
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle ref={chartDotRef} cx="396" cy="16" r="3.5" fill="#7FB3F5" stroke="#0B0D12" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="mt-2 flex justify-between text-[9.5px] text-mist-400/70">
                    {CHART_MONTHS.map(m => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative rounded-xl border border-white/[0.075] bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[11.5px] text-mist-400 mb-3 inline-flex items-center gap-1.5">
                <Target size={13} className="text-enterprise-400" /> HeatMap de risco por posição
              </p>

              <div className="relative">
                <div
                  ref={heatGridRef}
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: `repeat(${HEAT_COLS}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: HEAT_COLS * HEAT_ROWS }).map((_, i) => {
                    const isRisk = i === RISK_INDEX;
                    const intensity = ((i * 37) % 100) / 100;
                    return (
                      <div
                        key={i}
                        ref={el => {
                          heatCellRefs.current[i] = el;
                          if (isRisk) riskCellRef.current = el;
                        }}
                        className={`h-8 lg:h-9 rounded-[5px] ${isRisk ? 'ring-1 ring-red-400/70 shadow-[0_0_14px_rgba(239,68,68,0.45)]' : ''}`}
                        style={{
                          backgroundColor: isRisk ? '#EF4444' : `rgba(62,123,224,${0.12 + intensity * 0.55})`,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Fio que liga a célula de risco ao callout — só no layout largo, onde o
                    callout flutua sobre a direita do grid, como no preview aprovado. */}
                <div
                  ref={connectorRef}
                  aria-hidden
                  className="hidden lg:block absolute h-px origin-left bg-gradient-to-r from-red-500/70 to-red-500/20"
                  style={{
                    left: `${((RISK_COL + 1) / HEAT_COLS) * 100}%`,
                    top: `${((RISK_ROW + 0.5) / HEAT_ROWS) * 100}%`,
                    width: `${(1 / HEAT_COLS) * 100}%`,
                  }}
                />

                <div
                  ref={annotationRef}
                  className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-950/70 px-3 py-2.5 backdrop-blur-sm shadow-[0_10px_28px_-10px_rgba(0,0,0,0.8)] lg:absolute lg:mt-0 lg:w-[54%] lg:-translate-y-1/2 lg:left-[var(--cd-callout-left)] lg:top-[var(--cd-callout-top)]"
                  style={
                    {
                      '--cd-callout-left': `${((RISK_COL + 2) / HEAT_COLS) * 100}%`,
                      '--cd-callout-top': `${((RISK_ROW + 0.5) / HEAT_ROWS) * 100}%`,
                    } as CSSProperties
                  }
                >
                  <AlertTriangle ref={annotationIconRef} size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11.5px] text-red-200 leading-snug">
                    <span className="font-semibold text-red-300">BlindAI</span> detectou variação atípica nesta posição.
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[10.5px] text-mist-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(62,123,224,0.28)' }} /> Baixo risco
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(62,123,224,0.65)' }} /> Médio risco
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" /> Alto risco
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row items-stretch justify-center gap-5 sm:gap-0">
          {BENEFITS.map(({ icon: Icon, title, text }, i) => (
            <div
              key={title}
              className={`flex items-center gap-3 sm:px-7 lg:px-10 ${i > 0 ? 'sm:border-l sm:border-ink-700/70' : ''}`}
            >
              <span className="w-9 h-9 rounded-lg border border-enterprise-500/25 bg-enterprise-500/10 grid place-items-center flex-shrink-0">
                <Icon size={16} className="text-enterprise-300" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-mist-100">{title}</span>
                <span className="block text-[11.5px] text-mist-400">{text}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
