import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bot, Flame, ScanLine, LayoutDashboard, BarChart3, Building2, Gauge, ShieldCheck, Users } from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { motion, staggerContainer, useTiltHover, EASE, type Variants } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';

interface ModuleDef {
  icon: LucideIcon;
  title: string;
  desc: string;
  span: string;
  featured?: boolean;
}

const MODULES: ModuleDef[] = [
  {
    icon: Bot,
    title: 'BlindAI',
    desc: 'Assistente de IA que analisa divergências, aponta riscos e sugere ações antes que virem prejuízo.',
    span: 'lg:col-span-2 lg:row-span-2',
    featured: true,
  },
  {
    icon: Flame,
    title: 'HeatMap Inteligente',
    desc: 'Visualize onde o risco se concentra no estoque, por posição, categoria ou operador.',
    span: 'lg:col-span-2',
  },
  {
    icon: ScanLine,
    title: 'Conferência por NF-e',
    desc: 'Cruza automaticamente o recebido com o faturado — a divergência aparece na hora, com o item exato e a nota de origem.',
    span: 'lg:col-span-1',
  },
  { icon: LayoutDashboard, title: 'Dashboard', desc: 'Visão geral da operação em tempo real, sem planilha nenhuma.', span: 'lg:col-span-1' },
  {
    icon: BarChart3,
    title: 'Analytics',
    desc: 'Rankings, tendências e comparativos entre períodos, filiais e operadores.',
    span: 'lg:col-span-2',
  },
  { icon: Building2, title: 'Multiempresa', desc: 'Cada empresa isolada com segurança, sem misturar dado de ninguém.', span: 'lg:col-span-1' },
  { icon: Gauge, title: 'Indicadores', desc: 'KPIs operacionais sempre visíveis, do chão de fábrica à diretoria.', span: 'lg:col-span-1' },
  { icon: ShieldCheck, title: 'Auditoria', desc: 'Toda ação registrada e rastreável — quem fez, quando e o quê.', span: 'lg:col-span-2' },
  { icon: Users, title: 'Gestão de Usuários', desc: 'Papéis e permissões claras para cada pessoa da operação.', span: 'lg:col-span-2' },
];

const bentoIn: Variants = {
  hidden: { opacity: 0, y: 30, rotateX: -12 },
  visible: { opacity: 1, y: 0, rotateX: 0, transition: { duration: 0.6, ease: EASE } },
};

function ModuleCard({ mod }: { mod: ModuleDef }) {
  const tilt = useTiltHover<HTMLDivElement>({ maxTilt: 6 });

  return (
    <motion.div
      ref={tilt.ref}
      variants={bentoIn}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      style={tilt.style}
      className={`col-span-1 ${mod.span} group relative rounded-2xl border border-ink-700 bg-ink-900/60 p-6 overflow-hidden ${
        mod.featured ? 'flex flex-col justify-between' : ''
      }`}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-enterprise-500/10 to-transparent pointer-events-none" />
      <div className="relative z-10">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center mb-5 ${
            mod.featured ? 'bg-enterprise-500/20 text-enterprise-300' : 'bg-ink-800 text-enterprise-400'
          }`}
        >
          <mod.icon size={20} />
        </div>
        <h3 className={`font-semibold text-mist-100 mb-2 ${mod.featured ? 'text-xl' : 'text-base'}`}>{mod.title}</h3>
        <p className={`text-mist-400 leading-relaxed ${mod.featured ? 'text-sm max-w-sm' : 'text-sm'}`}>{mod.desc}</p>
      </div>
    </motion.div>
  );
}

export function Modules() {
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
    <section id="modules" className="relative bg-ink-950 py-28 px-6">
      <div className="max-w-3xl mx-auto text-center mb-16" style={{ perspective: 700 }}>
        <h2 ref={headingRef} className="text-3xl sm:text-4xl font-semibold text-mist-100 tracking-tight mb-4">
          Cada módulo, pensado para não deixar nada passar.
        </h2>
        <p ref={subRef} className="text-mist-400">
          Um sistema, todas as camadas de controle que sua operação precisa.
        </p>
      </div>
      <motion.div
        variants={staggerContainer(0.08)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.1 }}
        style={{ perspective: 1200 }}
        className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 lg:grid-flow-row-dense gap-4 lg:auto-rows-[180px]"
      >
        {MODULES.map(mod => (
          <ModuleCard key={mod.title} mod={mod} />
        ))}
      </motion.div>
    </section>
  );
}
