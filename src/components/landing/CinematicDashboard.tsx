import { useRef } from 'react';
import { Sparkles, TrendingUp } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { useGSAP, gsap, addCounterTween, formatCount } from './landingScroll';

interface KpiDef {
  label: string;
  end: number;
  decimals?: number;
  suffix?: string;
}

const KPIS: KpiDef[] = [
  { label: 'Itens Conferidos', end: 128400 },
  { label: 'Divergências Corrigidas', end: 3120 },
  { label: 'Acuracidade Média', end: 99.2, decimals: 1, suffix: '%' },
  { label: 'BlindScore', end: 92 },
];

const HEAT_COLS = 9;
const HEAT_ROWS = 3;
const RISK_INDEX = 20;

export function CinematicDashboard() {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const headerIconRef = useRef<SVGSVGElement>(null);
  const kpiCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const kpiValueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const chartLabelRef = useRef<HTMLParagraphElement>(null);
  const chartPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const heatGridRef = useRef<HTMLDivElement>(null);
  const heatCellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const riskCellRef = useRef<HTMLDivElement | null>(null);
  const annotationRef = useRef<HTMLDivElement>(null);
  const annotationIconRef = useRef<SVGSVGElement>(null);
  const tier = useAnimationTier();

  useGSAP(
    () => {
      if (tier === 'minimal') {
        KPIS.forEach((k, i) => {
          const el = kpiValueRefs.current[i];
          if (el) el.textContent = formatCount(k.end, k.decimals, undefined, k.suffix);
        });
        gsap.set(chartPathRefs.current, { drawSVG: '100%' });
        gsap.set(heatCellRefs.current, { opacity: 1 });
        gsap.set(annotationRef.current, { opacity: 1, x: 0, scale: 1 });
        return;
      }

      const full = tier === 'full';
      const d = (scrubDuration: number, realDuration: number) => (full ? scrubDuration : realDuration);

      const tl = gsap.timeline({
        scrollTrigger: full
          ? { trigger: sectionRef.current, start: 'top top', end: '+=3400', scrub: 1, pin: true, anticipatePin: 1 }
          : { trigger: sectionRef.current, start: 'top 72%', once: true },
      });

      // ── 1. Estrutura surge ──────────────────────────────────────────────
      tl.addLabel('structure', 0)
        .fromTo(
          frameRef.current,
          { scale: 0.94, opacity: 0.3, filter: 'blur(10px)' },
          { scale: 1, opacity: 1, filter: 'blur(0px)', duration: d(0.1, 0.6), ease: 'power2.out' },
          'structure'
        )
        .fromTo(
          dotRefs.current,
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: d(0.04, 0.25), stagger: d(0.02, 0.08), ease: 'back.out(2)' },
          'structure+=0.04'
        )
        .fromTo(headerIconRef.current, { rotate: -90, scale: 0 }, { rotate: 0, scale: 1, duration: d(0.06, 0.3), ease: 'back.out(2)' }, 'structure+=0.06');

      // ── 2. Gráficos aparecem ─────────────────────────────────────────────
      tl.addLabel('charts', d(0.16, 0.9)).fromTo(
        chartLabelRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: d(0.08, 0.4) },
        'charts'
      );

      // ── 3. Linhas são desenhadas ─────────────────────────────────────────
      tl.addLabel('lines', d(0.26, 1.3)).fromTo(
        chartPathRefs.current,
        { drawSVG: '0%' },
        { drawSVG: '100%', duration: d(0.22, 0.9), stagger: d(0.06, 0.15), ease: 'power1.inOut' },
        'lines'
      );

      // ── 4. KPIs ligam ────────────────────────────────────────────────────
      tl.addLabel('kpisOn', d(0.42, 2.1))
        .fromTo(
          kpiCardRefs.current,
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: d(0.1, 0.45), stagger: d(0.04, 0.1), ease: 'power2.out' },
          'kpisOn'
        )
        .fromTo(
          kpiCardRefs.current,
          { boxShadow: '0 0 0 rgba(62,123,224,0)' },
          {
            boxShadow: '0 0 24px rgba(62,123,224,0.35)',
            duration: d(0.06, 0.3),
            stagger: d(0.04, 0.1),
            yoyo: true,
            repeat: 1,
            ease: 'power1.inOut',
          },
          'kpisOn'
        );

      // ── 5. Contadores iniciam ────────────────────────────────────────────
      tl.addLabel('counters', d(0.52, 2.5));
      KPIS.forEach((k, i) => {
        addCounterTween(tl, kpiValueRefs.current[i], k, `counters+=${d(0.02, 0.1) * i}`);
      });

      // ── 6. HeatMap aparece ───────────────────────────────────────────────
      tl.addLabel('heatmap', d(0.64, 3.1))
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

      // ── 7. Ícones entram ─────────────────────────────────────────────────
      tl.addLabel('icons', d(0.84, 3.9)).fromTo(
        annotationIconRef.current,
        { rotate: -90, scale: 0 },
        { rotate: 0, scale: 1, duration: d(0.06, 0.3), ease: 'back.out(2.2)' },
        'icons'
      );

      // ── 8. Detalhes finalizam ────────────────────────────────────────────
      tl.addLabel('details', d(0.9, 4.1))
        .to(riskCellRef.current, { scale: 1.2, duration: d(0.05, 0.2), yoyo: true, repeat: 1, ease: 'power1.inOut' }, 'details')
        .fromTo(
          annotationRef.current,
          { opacity: 0, x: 16, scale: 0.95 },
          { opacity: 1, x: 0, scale: 1, duration: d(0.12, 0.4), ease: 'back.out(1.6)' },
          'details+=0.02'
        );
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  return (
    <section
      id="dashboard"
      ref={sectionRef}
      className="relative h-screen flex items-center justify-center overflow-hidden bg-ink-900 px-6"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1100px] h-[700px] rounded-full bg-enterprise-900/30 blur-[180px]" />
      </div>

      <div className="relative z-10 w-full max-w-5xl">
        <div className="flex items-center justify-between mb-5 px-1">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-mist-100 tracking-tight">
              Sua operação, sob controle total.
            </h2>
            <p className="text-mist-400 text-sm mt-1">Interface ilustrativa — indicadores, HeatMap e BlindAI em ação.</p>
          </div>
        </div>

        <div ref={frameRef} className="rounded-2xl border border-ink-700 bg-ink-950/80 backdrop-blur shadow-2xl shadow-black/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-ink-700">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  ref={el => {
                    dotRefs.current[i] = el;
                  }}
                  className="w-2.5 h-2.5 rounded-full bg-mist-400/30"
                />
              ))}
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-enterprise-300">
              <Sparkles ref={headerIconRef} size={13} /> BlindAI ativo
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-ink-700">
            {KPIS.map((kpi, i) => (
              <div
                key={kpi.label}
                ref={el => {
                  kpiCardRefs.current[i] = el;
                }}
                className="bg-ink-950 px-5 py-4"
              >
                <p className="text-xs text-mist-400 mb-1">{kpi.label}</p>
                <span
                  ref={el => {
                    kpiValueRefs.current[i] = el;
                  }}
                  className="text-2xl font-semibold text-mist-100"
                >
                  0
                </span>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6 p-6">
            <div>
              <p ref={chartLabelRef} className="text-xs text-mist-400 mb-3 inline-flex items-center gap-1.5">
                <TrendingUp size={13} /> Divergências ao longo do tempo
              </p>
              <svg viewBox="0 0 400 120" className="w-full h-28">
                <path
                  ref={el => {
                    chartPathRefs.current[0] = el;
                  }}
                  d="M0,90 C60,85 90,95 130,70 C170,45 200,60 240,40 C280,20 320,35 400,15"
                  fill="none"
                  stroke="#7FB3F5"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  ref={el => {
                    chartPathRefs.current[1] = el;
                  }}
                  d="M0,105 C60,100 90,102 130,98 C170,94 200,96 240,90 C280,86 320,84 400,80"
                  fill="none"
                  stroke="#2A2F3B"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="relative">
              <p className="text-xs text-mist-400 mb-3">HeatMap de risco por posição</p>
              <div
                ref={heatGridRef}
                className="grid gap-1"
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
                      className={`aspect-square rounded-sm ${isRisk ? 'ring-2 ring-red-500' : ''}`}
                      style={{
                        backgroundColor: isRisk ? '#EF4444' : `rgba(62,123,224,${0.12 + intensity * 0.55})`,
                      }}
                    />
                  );
                })}
              </div>

              <div
                ref={annotationRef}
                className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5"
              >
                <Sparkles ref={annotationIconRef} size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 leading-relaxed">
                  <span className="font-semibold">BlindAI:</span> variação atípica detectada nesta posição — recomenda-se
                  contagem cega de conferência.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
