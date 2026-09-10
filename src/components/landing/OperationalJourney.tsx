import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PackageCheck, ScanLine, ListChecks, Wrench, Gauge, FileBarChart } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { motion, staggerContainer, fadeInUp } from './landingMotion';
import { useGSAP, createHorizontalPin } from './landingScroll';

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

export function OperationalJourney() {
  const tier = useAnimationTier();
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const stageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);

  useGSAP(
    () => {
      if (tier !== 'full' || !sectionRef.current || !trackRef.current) return;

      const tl = createHorizontalPin(sectionRef.current, trackRef.current);
      if (lineRef.current) tl.to(lineRef.current, { scaleX: 1, ease: 'none' }, 0);

      STAGES.forEach((_, i) => {
        const pos = Math.max(i / (STAGES.length - 1) - 0.08, 0);
        const el = stageRefs.current[i];
        const icon = iconRefs.current[i];
        if (!el) return;
        tl.fromTo(
          el,
          { scale: 0.8, rotateY: i % 2 === 0 ? -35 : 35, opacity: 0.3, filter: 'blur(6px)' },
          { scale: 1, rotateY: 0, opacity: 1, filter: 'blur(0px)', duration: 0.16, ease: 'power2.out' },
          pos
        );
        if (icon) {
          tl.fromTo(
            icon,
            { scale: 0, rotate: -45 },
            { scale: 1, rotate: 0, duration: 0.1, ease: 'back.out(2.2)' },
            pos + 0.06
          );
        }
      });
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  if (tier !== 'full') {
    return (
      <section id="journey" className="relative bg-ink-950 py-24 px-6">
        <div className="max-w-3xl mx-auto text-center mb-14">
          <h2 className="text-3xl font-semibold text-mist-100 tracking-tight mb-3">
            A jornada de uma operação sem pontos cegos.
          </h2>
          <p className="text-mist-400">Do recebimento ao relatório final, cada etapa fica registrada.</p>
        </div>
        <motion.div
          variants={staggerContainer(0.1)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          className="max-w-2xl mx-auto space-y-5"
        >
          {STAGES.map((s, i) => (
            <motion.div
              key={s.title}
              variants={fadeInUp}
              className="flex items-start gap-4 rounded-2xl border border-ink-700 bg-ink-900/60 p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-enterprise-500/15 flex items-center justify-center text-enterprise-300 flex-shrink-0">
                <s.icon size={18} />
              </div>
              <div>
                <p className="text-xs text-enterprise-300 font-medium mb-0.5">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="text-mist-100 font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-mist-400">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>
    );
  }

  return (
    <section
      id="journey"
      ref={sectionRef}
      className="relative h-screen overflow-hidden bg-ink-950"
      style={{ perspective: 1000 }}
    >
      <div className="absolute top-14 inset-x-0 text-center px-6 z-10">
        <h2 className="text-3xl font-semibold text-mist-100 tracking-tight">
          A jornada de uma operação sem pontos cegos.
        </h2>
      </div>
      <div ref={trackRef} className="absolute top-1/2 -translate-y-1/2 left-0 flex items-center gap-24 px-[10vw] will-change-transform">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-ink-700" />
        <div ref={lineRef} className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-enterprise-400 origin-left scale-x-0" />
        {STAGES.map((s, i) => (
          <div
            key={s.title}
            ref={el => {
              stageRefs.current[i] = el;
            }}
            className="relative z-10 w-72 flex-shrink-0 rounded-2xl border border-ink-700 bg-ink-900/80 backdrop-blur p-6"
          >
            <div
              ref={el => {
                iconRefs.current[i] = el;
              }}
              className="w-11 h-11 rounded-xl bg-enterprise-500/15 flex items-center justify-center text-enterprise-300 mb-4"
            >
              <s.icon size={20} />
            </div>
            <p className="text-xs text-enterprise-300 font-medium mb-1">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="text-mist-100 font-semibold text-lg mb-1.5">{s.title}</h3>
            <p className="text-sm text-mist-400 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
