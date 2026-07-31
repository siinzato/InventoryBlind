import { useRef } from 'react';
import { Check } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { motion, staggerContainer, fadeInUp, MagneticButton } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';

interface PlanDef {
  key: 'starter' | 'professional' | 'enterprise';
  name: string;
  price: string;
  period?: string;
  desc: string;
  features: string[];
  featured?: boolean;
  cta: string;
}

const PLANS: PlanDef[] = [
  {
    key: 'starter',
    name: 'Starter',
    price: 'R$ 297',
    period: '/mês',
    desc: 'Para operações que estão organizando a casa.',
    features: ['1 empresa', 'Dashboard geral', 'Conferência por NF-e', 'Indicadores essenciais'],
    cta: 'Começar Gratuitamente',
  },
  {
    key: 'professional',
    name: 'Professional',
    price: 'R$ 697',
    period: '/mês',
    desc: 'Para operações que querem controle total.',
    features: ['Multiempresa', 'HeatMap Inteligente', 'Analytics avançado', 'BlindAI incluso'],
    featured: true,
    cta: 'Começar Gratuitamente',
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 'Sob consulta',
    desc: 'Para operações com escala e exigências específicas.',
    features: ['Auditoria avançada', 'Gestão de usuários e papéis', 'Suporte dedicado', 'SLA personalizado'],
    cta: 'Falar com Vendas',
  },
];

interface PlansProps {
  onSignup: () => void;
}

export function Plans({ onSignup }: PlansProps) {
  const tier = useAnimationTier();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      if (tier === 'minimal' || !headingRef.current) return;
      const split = new SplitText(headingRef.current, { type: 'words' });
      gsap.set(split.words, { yPercent: 100, opacity: 0, rotateX: -60 });
      gsap.set(subRef.current, { opacity: 0, y: 10, filter: 'blur(6px)' });

      gsap
        .timeline({ scrollTrigger: { trigger: headingRef.current, start: 'top 85%', once: true } })
        .to(split.words, { yPercent: 0, opacity: 1, rotateX: 0, duration: 0.7, stagger: 0.06, ease: 'back.out(1.6)' })
        .to(subRef.current, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6 }, '-=0.3');

      return () => split.revert();
    },
    { scope: headingRef, dependencies: [tier] }
  );

  return (
    <section id="plans" className="relative bg-ink-950 py-28 px-6">
      <div className="max-w-2xl mx-auto text-center mb-16" style={{ perspective: 700 }}>
        <h2 ref={headingRef} className="text-3xl sm:text-4xl font-semibold text-mist-100 tracking-tight mb-4">
          Um plano para cada estágio da operação.
        </h2>
        <p ref={subRef} className="text-mist-400">
          Comece pequeno, cresça sem trocar de sistema.
        </p>
      </div>
      <motion.div
        variants={staggerContainer(0.1)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 items-start"
      >
        {PLANS.map(plan => (
          <motion.div
            key={plan.key}
            variants={fadeInUp}
            whileHover={{ y: -6 }}
            className={`relative rounded-2xl p-7 flex flex-col ${
              plan.featured
                ? 'border border-enterprise-400/50 bg-enterprise-900/20 shadow-xl shadow-enterprise-900/40 md:-translate-y-3'
                : 'border border-ink-700 bg-ink-900/60'
            }`}
          >
            {plan.featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-enterprise-500 text-white text-xs font-semibold">
                Mais popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-mist-100 mb-1">{plan.name}</h3>
            <p className="text-sm text-mist-400 mb-6">{plan.desc}</p>
            <div className="mb-6">
              <span className="text-3xl font-semibold text-mist-100">{plan.price}</span>
              {plan.period && <span className="text-mist-400 text-sm">{plan.period}</span>}
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {plan.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm text-mist-400">
                  <Check size={15} className="text-enterprise-400 flex-shrink-0 mt-0.5" /> {f}
                </li>
              ))}
            </ul>
            <MagneticButton
              onClick={onSignup}
              variant={plan.featured ? 'solid' : 'ghost'}
              className="w-full justify-center py-3 rounded-xl text-sm font-semibold"
            >
              {plan.cta}
            </MagneticButton>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
