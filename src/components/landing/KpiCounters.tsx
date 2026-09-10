import { useRef } from 'react';
import { useAnimationTier, type AnimationTier } from '../../lib/useAnimationTier';
import { useCountUp, useGSAP, gsap } from './landingScroll';

interface Kpi {
  end: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
}

const KPIS: Kpi[] = [
  { end: 9, label: 'Módulos integrados em uma única plataforma' },
  { end: 100, suffix: '%', label: 'Auditabilidade — cada ação registrada e rastreável' },
  { end: 3, label: 'Camadas de verificação por operação: NF-e, contagem cega e BlindScore' },
  { end: 24, suffix: '/7', label: 'Monitoramento contínuo da operação' },
];

function KpiCard({ kpi, tier }: { kpi: Kpi; tier: AnimationTier }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const valueRef = useCountUp<HTMLSpanElement>({
    end: kpi.end,
    decimals: kpi.decimals,
    prefix: kpi.prefix,
    suffix: kpi.suffix,
    tier,
    scrub: tier === 'full',
  });

  useGSAP(
    () => {
      if (tier !== 'full' || !cardRef.current) return;

      gsap.fromTo(
        cardRef.current,
        { scale: 0.82, opacity: 0.35, filter: 'blur(6px)' },
        {
          scale: 1,
          opacity: 1,
          filter: 'blur(0px)',
          ease: 'back.out(1.6)',
          scrollTrigger: { trigger: cardRef.current, start: 'top 88%', end: 'top 45%', scrub: 0.5 },
        }
      );

      if (valueRef.current) {
        gsap.fromTo(
          valueRef.current,
          { filter: 'drop-shadow(0 0 0px rgba(62,123,224,0))' },
          {
            filter: 'drop-shadow(0 0 14px rgba(62,123,224,0.55))',
            duration: 0.5,
            yoyo: true,
            repeat: 1,
            ease: 'power1.inOut',
            scrollTrigger: { trigger: cardRef.current, start: 'top 55%', once: true },
          }
        );
      }
    },
    { scope: cardRef, dependencies: [tier] }
  );

  return (
    <div ref={cardRef} className="text-center px-4">
      <p className="text-4xl sm:text-5xl font-semibold text-mist-100 tracking-tight mb-3">
        <span ref={valueRef}>0</span>
      </p>
      <p className="text-sm text-mist-400 max-w-[220px] mx-auto leading-relaxed">{kpi.label}</p>
    </div>
  );
}

export function KpiCounters() {
  const tier = useAnimationTier();
  return (
    <section className="relative bg-ink-900 py-24 px-6 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-10">
        {KPIS.map(kpi => (
          <KpiCard key={kpi.label} kpi={kpi} tier={tier} />
        ))}
      </div>
    </section>
  );
}
