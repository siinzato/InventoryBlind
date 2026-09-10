import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Flame,
  ScanLine,
  Tablet,
  LayoutDashboard,
  BarChart3,
  Building2,
  Gauge,
  ShieldCheck,
  Users,
  Target,
  AlertTriangle,
  GitBranch,
  Warehouse,
  Workflow,
  LayoutGrid,
  SearchCheck,
  TrendingUp,
  GraduationCap,
  BookOpen,
  Monitor,
} from 'lucide-react';
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

/** A ordem e os `span` somam linhas cheias de 4 colunas, na sequência em que os
 *  cards são declarados — o `grid-flow-row-dense` continua ali como rede de
 *  segurança, mas não precisa reordenar nada para fechar o bento.
 *
 *  O comprimento de `desc` é parte do contrato do layout: a linha tem altura fixa
 *  (180px) e o card é `overflow-hidden`, então sobram ~2 linhas de texto. Em
 *  `col-span-1` isso é ~50 caracteres (a coluna encolhe a 1024px); em
 *  `col-span-2`, ~120. Passar disso não empurra o card — corta a frase. */
const MODULES: ModuleDef[] = [
  {
    icon: Bot,
    title: 'BlindAI',
    desc: 'O agente que acompanha a operação — analisa o que está acontecendo, identifica riscos e indica onde agir antes que a divergência vire prejuízo.',
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
    icon: Target,
    title: 'Confidence Score',
    desc: 'Recontagem por confiança, não por ciclo fixo.',
    span: 'lg:col-span-1',
  },
  {
    icon: AlertTriangle,
    title: 'Inventário por Risco',
    desc: 'Um Risk Score define o que contar primeiro.',
    span: 'lg:col-span-1',
  },
  {
    icon: GitBranch,
    title: 'Root Cause Analysis',
    desc: 'Toda divergência fechada vira causa classificada — Pareto, recorrência e 5 Porquês para prevenir, não só registrar.',
    span: 'lg:col-span-2',
  },
  {
    icon: Warehouse,
    title: 'Warehouse Digital Twin',
    desc: 'Mapa vivo do armazém: replay de picking, distâncias reais e insights automáticos sobre o layout que você desenhou.',
    span: 'lg:col-span-2',
  },
  {
    icon: Workflow,
    title: 'Agentes e Automações',
    desc: 'Quando algo acontecer, avalie condições e execute ações — você monta o fluxo, o servidor executa sozinho.',
    span: 'lg:col-span-2',
  },
  {
    icon: LayoutGrid,
    title: 'Classificação ABC/XYZ',
    desc: 'Valor movimentado e previsibilidade de demanda.',
    span: 'lg:col-span-1',
  },
  {
    icon: ScanLine,
    title: 'Conferência por NF-e',
    desc: 'Cruza o recebido com o faturado, item a item.',
    span: 'lg:col-span-1',
  },
  {
    icon: Tablet,
    title: 'Paperless Inventory',
    desc: 'Contagens, reconferências e auditorias direto no tablet, com rastreabilidade completa e integração ao ERP.',
    span: 'lg:col-span-2',
  },
  {
    icon: TrendingUp,
    title: 'Produtividade por Operador',
    desc: 'Desempenho, evolução e conquistas de cada operador, com visão de gestor para comparar a equipe.',
    span: 'lg:col-span-2',
  },
  {
    icon: SearchCheck,
    title: 'Auditoria de Estoque',
    desc: 'Auditoria cruzada, estatística e por tendência, mais simulação de inventário — evidência antes da decisão.',
    span: 'lg:col-span-2',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    desc: 'Rankings, tendências e comparativos entre períodos, filiais e operadores.',
    span: 'lg:col-span-2',
  },
  { icon: LayoutDashboard, title: 'Dashboard', desc: 'Visão geral da operação em tempo real.', span: 'lg:col-span-1' },
  {
    icon: GraduationCap,
    title: 'I.B Academy',
    desc: 'Capacitação oficial em gestão de estoques e inventário inteligente, com trilhas e certificado.',
    span: 'lg:col-span-2',
  },
  {
    icon: BookOpen,
    title: 'Recursos e Conhecimento',
    desc: 'Documentação, FAQ e glossário do produto.',
    span: 'lg:col-span-1',
  },
  {
    icon: Monitor,
    title: 'App InventoryFull',
    desc: 'Aplicativo Windows que cruza localmente as planilhas do depósito Full do Tiny e do Mercado Livre.',
    span: 'lg:col-span-2',
  },
  { icon: Building2, title: 'Multiempresa', desc: 'Cada empresa isolada, sem dado misturado.', span: 'lg:col-span-1' },
  { icon: Gauge, title: 'Indicadores', desc: 'KPIs operacionais sempre visíveis.', span: 'lg:col-span-1' },
  { icon: ShieldCheck, title: 'Trilha de Auditoria', desc: 'Toda ação registrada e rastreável — quem fez, quando e o quê.', span: 'lg:col-span-2' },
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
      gsap.set(split.words, { yPercent: 100, opacity: 0, rotateX: -60, backfaceVisibility: 'hidden' });
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
