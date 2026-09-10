import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { Reveal, MagneticButton } from './landingMotion';
import { useGSAP, gsap } from './landingScroll';

interface FinalCtaProps {
  onSignup: () => void;
}

export function FinalCta({ onSignup }: FinalCtaProps) {
  const tier = useAnimationTier();
  const sectionRef = useRef<HTMLElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (tier === 'minimal' || !blobRef.current) return;
      gsap.to(blobRef.current, { x: 60, y: -40, duration: 9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    },
    { scope: sectionRef, dependencies: [tier] }
  );

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden py-32 px-6 bg-gradient-to-br from-enterprise-900 via-ink-950 to-enterprise-700"
    >
      <div
        ref={blobRef}
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-enterprise-400/20 blur-[160px]"
      />
      <div className="relative max-w-2xl mx-auto text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mb-5">
            Pare de descobrir a divergência tarde demais.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-white/70 text-lg mb-10">
            Comece agora, gratuitamente, e veja sua operação sob controle total em minutos.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <MagneticButton
            onClick={onSignup}
            className="px-8 py-4 rounded-full text-sm font-semibold inline-flex items-center gap-2"
          >
            Começar Gratuitamente <ArrowRight size={16} />
          </MagneticButton>
        </Reveal>
      </div>
    </section>
  );
}
