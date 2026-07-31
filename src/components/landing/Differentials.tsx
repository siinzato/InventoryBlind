import { useRef } from 'react';
import { X, Check } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { motion, staggerContainer, fadeInUp } from './landingMotion';
import { useGSAP, gsap } from './landingScroll';

const MANUAL_POINTS = [
  'Planilhas soltas, cada um com uma versão',
  'Contagem sem cruzamento com a nota fiscal',
  'Divergência descoberta semanas depois',
  'Zero rastreabilidade de quem alterou o quê',
];

const PLATFORM_POINTS = [
  'Tudo centralizado, uma fonte única de verdade',
  'Cruzamento automático por NF-e, na hora',
  'Risco identificado em tempo real pelo BlindAI',
  'Auditoria completa de cada ação, sempre',
];

export function Differentials() {
  const tier = useAnimationTier();
  const sectionRef = useRef<HTMLElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);
  const platformRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (tier !== 'full' || !sectionRef.current) return;
      gsap.set(platformRef.current, { opacity: 0, clipPath: 'inset(0% 0% 0% 100%)', rotateY: -10 });
      gsap
        .timeline({
          scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: '+=1600', scrub: 1, pin: true },
        })
        .to(manualRef.current, { opacity: 0, scale: 0.9, rotateY: 10, filter: 'blur(8px)', ease: 'none' }, 0.15)
        .to(platformRef.current, { opacity: 1, clipPath: 'inset(0% 0% 0% 0%)', rotateY: 0, ease: 'none' }, 0.15)
        .to(platformRef.current, { scale: 1.02, ease: 'none' }, 0.8);
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  if (tier !== 'full') {
    return (
      <section className="relative bg-ink-900 py-24 px-6">
        <div className="max-w-3xl mx-auto text-center mb-14">
          <h2 className="text-3xl font-semibold text-mist-100 tracking-tight mb-3">Do jeito manual ao controle total.</h2>
        </div>
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-6">
          <motion.div
            variants={staggerContainer(0.06)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="rounded-2xl border border-ink-700 bg-ink-950/60 p-6"
          >
            <p className="text-xs font-medium text-mist-400 uppercase tracking-wide mb-4">Do jeito manual</p>
            {MANUAL_POINTS.map(p => (
              <motion.div key={p} variants={fadeInUp} className="flex items-start gap-2.5 mb-3 last:mb-0">
                <X size={15} className="text-mist-400 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-mist-400">{p}</span>
              </motion.div>
            ))}
          </motion.div>
          <motion.div
            variants={staggerContainer(0.06)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="rounded-2xl border border-enterprise-500/30 bg-enterprise-900/20 p-6"
          >
            <p className="text-xs font-medium text-enterprise-300 uppercase tracking-wide mb-4">Com InventoryBlind</p>
            {PLATFORM_POINTS.map(p => (
              <motion.div key={p} variants={fadeInUp} className="flex items-start gap-2.5 mb-3 last:mb-0">
                <Check size={15} className="text-enterprise-400 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-mist-100">{p}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative h-screen flex items-center justify-center overflow-hidden bg-ink-900 px-6">
      <div className="relative w-full max-w-2xl">
        <h2 className="text-center text-3xl font-semibold text-mist-100 tracking-tight mb-12">
          Do jeito manual ao controle total.
        </h2>
        <div className="relative" style={{ perspective: 1000 }}>
          <div ref={manualRef} className="rounded-2xl border border-ink-700 bg-ink-950/60 p-8">
            <p className="text-xs font-medium text-mist-400 uppercase tracking-wide mb-5">Do jeito manual</p>
            {MANUAL_POINTS.map(p => (
              <div key={p} className="flex items-start gap-2.5 mb-3.5 last:mb-0">
                <X size={16} className="text-mist-400 flex-shrink-0 mt-0.5" />
                <span className="text-mist-400">{p}</span>
              </div>
            ))}
          </div>
          <div ref={platformRef} className="absolute inset-0 rounded-2xl border border-enterprise-500/30 bg-enterprise-900/25 p-8">
            <p className="text-xs font-medium text-enterprise-300 uppercase tracking-wide mb-5">Com InventoryBlind</p>
            {PLATFORM_POINTS.map(p => (
              <div key={p} className="flex items-start gap-2.5 mb-3.5 last:mb-0">
                <Check size={16} className="text-enterprise-400 flex-shrink-0 mt-0.5" />
                <span className="text-mist-100">{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
