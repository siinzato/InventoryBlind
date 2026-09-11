import { useRef, type CSSProperties, type ReactNode } from 'react';
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
  ChevronRight,
  Activity,
  Lightbulb,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAnimationTier } from '../../lib/useAnimationTier';
import { motion, staggerContainer, EASE, type Variants } from './landingMotion';
import { useGSAP, gsap, SplitText } from './landingScroll';

interface ModuleDef {
  icon: LucideIcon;
  title: string;
  desc: string;
}

/** Os seis módulos que recebem tratamento premium, na ordem de leitura do bento. */
const FEATURED: ModuleDef[] = [
  {
    icon: Bot,
    title: 'BlindAI',
    desc: 'O agente que acompanha a operação — analisa o que está acontecendo, identifica riscos e indica onde agir antes que a divergência vire prejuízo.',
  },
  {
    icon: Flame,
    title: 'HeatMap Inteligente',
    desc: 'Visualize onde o risco se concentra no estoque, por posição, categoria ou operador.',
  },
  { icon: Target, title: 'Confidence Score', desc: 'Recontagem por confiança, não por ciclo fixo.' },
  { icon: AlertTriangle, title: 'Inventário por Risco', desc: 'Um Risk Score define o que contar primeiro.' },
  {
    icon: GitBranch,
    title: 'Root Cause Analysis',
    desc: 'Toda divergência fechada vira causa classificada — Pareto, recorrência e 5 Porquês para prevenir, não só registrar.',
  },
  {
    icon: Warehouse,
    title: 'Warehouse Digital Twin',
    desc: 'Mapa vivo do armazém: replay de picking, distâncias reais e insights automáticos sobre o layout que você desenhou.',
  },
];

/** Todos os demais módulos da plataforma — nenhum foi removido, só passaram a
 *  ocupar uma grade compacta abaixo do bento. */
const MORE: ModuleDef[] = [
  {
    icon: Workflow,
    title: 'Agentes e Automações',
    desc: 'Quando algo acontecer, avalie condições e execute ações — você monta o fluxo, o servidor executa sozinho.',
  },
  { icon: LayoutGrid, title: 'Classificação ABC/XYZ', desc: 'Valor movimentado e previsibilidade de demanda.' },
  { icon: ScanLine, title: 'Conferência por NF-e', desc: 'Cruza o recebido com o faturado, item a item.' },
  {
    icon: Tablet,
    title: 'Paperless Inventory',
    desc: 'Contagens, reconferências e auditorias direto no tablet, com rastreabilidade completa e integração ao ERP.',
  },
  {
    icon: TrendingUp,
    title: 'Produtividade por Operador',
    desc: 'Desempenho, evolução e conquistas de cada operador, com visão de gestor para comparar a equipe.',
  },
  {
    icon: SearchCheck,
    title: 'Auditoria de Estoque',
    desc: 'Auditoria cruzada, estatística e por tendência, mais simulação de inventário — evidência antes da decisão.',
  },
  { icon: BarChart3, title: 'Analytics', desc: 'Rankings, tendências e comparativos entre períodos, filiais e operadores.' },
  { icon: LayoutDashboard, title: 'Dashboard', desc: 'Visão geral da operação em tempo real.' },
  {
    icon: GraduationCap,
    title: 'I.B Academy',
    desc: 'Capacitação oficial em gestão de estoques e inventário inteligente, com trilhas e certificado.',
  },
  { icon: BookOpen, title: 'Recursos e Conhecimento', desc: 'Documentação, FAQ e glossário do produto.' },
  {
    icon: Monitor,
    title: 'App InventoryFull',
    desc: 'Aplicativo Windows que cruza localmente as planilhas do depósito Full do Tiny e do Mercado Livre.',
  },
  { icon: Building2, title: 'Multiempresa', desc: 'Cada empresa isolada, sem dado misturado.' },
  { icon: Gauge, title: 'Indicadores', desc: 'KPIs operacionais sempre visíveis.' },
  { icon: ShieldCheck, title: 'Trilha de Auditoria', desc: 'Toda ação registrada e rastreável — quem fez, quando e o quê.' },
  { icon: Users, title: 'Gestão de Usuários', desc: 'Papéis e permissões claras para cada pessoa da operação.' },
];

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: 'Mais controle', text: 'Em todas as etapas' },
  { icon: Target, title: 'Menos perdas', text: 'Com decisões mais precisas' },
  { icon: BarChart3, title: 'Mais eficiência', text: 'No time e na operação' },
  { icon: ShieldCheck, title: 'Resultados reais', text: 'Do recebimento ao relatório' },
];

/** Vidro escuro discreto — mesma família de material do restante da landing. */
const SURFACE: CSSProperties = {
  backgroundColor: 'rgba(11,13,18,0.72)',
  backgroundImage: [
    'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.009) 14%, rgba(255,255,255,0) 34%)',
    'radial-gradient(120% 80% at 50% -10%, rgba(127,179,245,0.055), rgba(127,179,245,0) 60%)',
  ].join(', '),
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 3px rgba(0,0,0,0.35), 0 18px 38px -20px rgba(0,0,0,0.7)',
};

const CARD_BASE =
  'group relative overflow-hidden rounded-2xl border border-[rgba(140,170,215,0.145)] transition-[border-color,transform] duration-300 hover:border-[rgba(140,170,215,0.3)] hover:-translate-y-[2px]';

const cardIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

function IconBox({ icon: Icon, size = 'md' }: { icon: LucideIcon; size?: 'md' | 'sm' }) {
  return (
    <div
      className={`${
        size === 'md' ? 'w-11 h-11 rounded-xl' : 'w-9 h-9 rounded-[10px]'
      } grid place-items-center border border-enterprise-500/20 bg-enterprise-500/[0.12] text-enterprise-300 flex-shrink-0`}
    >
      <Icon size={size === 'md' ? 20 : 17} />
    </div>
  );
}

/** Detalhe visual do preview. Não há destino real, então não é botão nem link. */
function Chevron({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid place-items-center w-8 h-8 rounded-full border border-ink-600 bg-ink-900/70 text-mist-400 flex-shrink-0 ${className}`}
    >
      <ChevronRight size={15} />
    </span>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={cardIn} style={SURFACE} className={`${CARD_BASE} ${className}`}>
      {children}
    </motion.div>
  );
}

/* ── Microvisualizações ilustrativas ─────────────────────────────────────────
   Nenhuma consulta ao banco, nenhum dado remoto, nenhuma imagem: só SVG e CSS. */

function BlindAiPanel() {
  return (
    <div aria-hidden="true" className="absolute right-[-22px] bottom-[-18px] w-[300px] rotate-[-3deg]">
      <div
        className="rounded-xl border border-[rgba(140,170,215,0.16)] p-4"
        style={{ backgroundColor: 'rgba(8,11,17,0.9)', boxShadow: '0 18px 40px -18px rgba(0,0,0,0.8)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold italic text-mist-100">BlindAI</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-mist-100">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Ativo
          </span>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-950/60 px-2.5 py-2">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-[11.5px] leading-snug text-red-200">Variação atípica detectada no setor A3.</span>
        </div>
        <div className="mt-3 space-y-2">
          {[100, 74, 88, 60].map((w, i) => (
            <div key={i} className="h-2 rounded-full bg-enterprise-500/[0.14]" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HeatMini() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3">
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: 15 }).map((_, i) => {
          const risk = i === 11;
          const intensity = ((i * 43) % 100) / 100;
          return (
            <span
              key={i}
              className={`w-8 h-6 rounded-[4px] ${risk ? 'shadow-[0_0_14px_rgba(239,68,68,0.55)]' : ''}`}
              style={{ backgroundColor: risk ? '#EF4444' : `rgba(62,123,224,${0.12 + intensity * 0.5})` }}
            />
          );
        })}
      </div>
      <span className="hidden xl:block rounded-lg border border-[rgba(140,170,215,0.16)] bg-ink-950/80 px-2.5 py-2 text-[11px] leading-tight text-mist-100">
        Maior risco
        <br />
        nesta posição
      </span>
    </div>
  );
}

function ConfidenceRing() {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div aria-hidden="true" className="relative -mt-5 w-[76px] h-[76px] flex-shrink-0">
      <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(62,123,224,0.16)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke="#3E7BE0"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * 0.98} ${c}`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center leading-none">
        <span className="block">
          <span className="block text-[17px] font-semibold text-mist-100 tabular-nums">98%</span>
          <span className="mt-0.5 block text-[9.5px] text-mist-400">Confiança</span>
        </span>
      </span>
    </div>
  );
}

function RiskBars() {
  const rows: { label: string; w: string; color: string }[] = [
    { label: 'Alto', w: '100%', color: '#EF4444' },
    { label: 'Médio', w: '62%', color: 'rgba(62,123,224,0.85)' },
    { label: 'Baixo', w: '34%', color: 'rgba(62,123,224,0.45)' },
  ];
  return (
    <div aria-hidden="true" className="w-[104px] flex-shrink-0 space-y-2">
      {rows.map(row => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="w-9 text-right text-[10px] text-mist-400">{row.label}</span>
          <span className="flex-1 h-1.5 rounded-full bg-ink-700/70">
            <span className="block h-full rounded-full" style={{ width: row.w, backgroundColor: row.color }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function CausesPanel() {
  const causes = ['Erro de recebimento', 'Picking incorreto', 'Endereçamento', 'Contagem incorreta', 'Outros'];
  const shares = ['32%', '24%', '18%', '12%', '14%'];
  return (
    <div
      aria-hidden="true"
      className="h-full rounded-xl border border-[rgba(140,170,215,0.14)] bg-ink-950/70 px-4 py-3.5"
    >
      <p className="text-[11.5px] font-medium text-mist-100">Principais causas</p>
      <ul className="mt-2.5 space-y-[7px]">
        {causes.map((cause, i) => (
          <li key={cause} className="flex items-center gap-2.5 text-[11px]">
            <span className="w-4 text-center text-mist-400/70 tabular-nums">{i + 1}</span>
            <span className="flex-1 truncate text-mist-400">{cause}</span>
            <span className="text-mist-100 tabular-nums">{shares[i]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TwinMap() {
  return (
    <svg aria-hidden="true" viewBox="0 0 300 200" className="absolute right-0 bottom-0 h-full w-[310px]">
      <defs>
        <linearGradient id="twinRoute" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1E5FBF" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7FB3F5" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      {/* Blocos em perspectiva isométrica — corredores do armazém. */}
      {[0, 1, 2, 3].map(row =>
        [0, 1, 2, 3, 4].map(col => {
          const x = 40 + col * 46 + row * 22;
          const y = 60 + row * 30;
          const h = 12 + ((col + row) % 3) * 5;
          return (
            <g key={`${row}-${col}`}>
              <path
                d={`M${x} ${y} l20 -11 l20 11 l-20 11 Z`}
                fill="rgba(30,95,191,0.26)"
                stroke="rgba(127,179,245,0.32)"
                strokeWidth="0.8"
              />
              <path d={`M${x} ${y} l20 11 l0 ${h} l-20 -11 Z`} fill="rgba(12,22,40,0.9)" />
              <path d={`M${x + 40} ${y} l-20 11 l0 ${h} l20 -11 Z`} fill="rgba(18,32,56,0.9)" />
            </g>
          );
        })
      )}
      <path
        d="M34 150 L96 118 L150 146 L206 112 L262 82"
        fill="none"
        stroke="rgba(127,179,245,0.16)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M34 150 L96 118 L150 146 L206 112 L262 82"
        fill="none"
        stroke="url(#twinRoute)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="262" cy="82" r="4" fill="#7FB3F5" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

export function Modules() {
  const tier = useAnimationTier();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      if (tier === 'minimal' || !headingRef.current) return;
      const split = new SplitText(headingRef.current, { type: 'words' });
      gsap.set(split.words, { yPercent: 100, opacity: 0, backfaceVisibility: 'hidden' });
      gsap.set(subRef.current, { opacity: 0, y: 10, filter: 'blur(6px)' });

      gsap
        .timeline({ scrollTrigger: { trigger: headingRef.current, start: 'top 85%', once: true } })
        .to(split.words, { yPercent: 0, opacity: 1, duration: 0.7, stagger: 0.05, ease: 'power3.out' })
        .to(subRef.current, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6 }, '-=0.35');

      return () => split.revert();
    },
    { scope: headingRef, dependencies: [tier] }
  );

  const [blindAi, heat, confidence, risk, rootCause, twin] = FEATURED;

  return (
    <section id="modules" className="relative overflow-hidden bg-ink-950 py-24 px-6">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[1250px] h-[850px] rounded-full bg-enterprise-900/28 blur-[200px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #7FB3F5 1px, transparent 1px), linear-gradient(to bottom, #7FB3F5 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[76rem]">
        <div className="max-w-3xl mx-auto text-center mb-12 lg:mb-14">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-enterprise-400/85">Módulos</p>
          <h2 ref={headingRef} className="mt-3 text-3xl sm:text-4xl lg:text-[2.5rem] font-semibold text-mist-100 tracking-tight leading-[1.12]">
            Cada módulo, pensado para não deixar nada passar.
          </h2>
          <p ref={subRef} className="mt-3 text-sm sm:text-base text-mist-400">
            Um sistema, todas as camadas de controle que sua operação precisa.
          </p>
        </div>

        <motion.div
          variants={staggerContainer(0.09)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.12 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-rows-[182px_182px_229px] gap-4"
        >
          {/* BlindAI — protagonista do bloco */}
          <Card className="sm:col-span-2 lg:row-span-2 flex flex-col p-5 sm:p-6">
            <div className="relative z-10 flex items-start justify-between gap-4">
              <IconBox icon={blindAi.icon} />
              <Chevron />
            </div>
            <div className="relative z-10 mt-5 lg:max-w-[275px]">
              <h3 className="text-xl font-semibold text-mist-100">{blindAi.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{blindAi.desc}</p>
              <ul className="mt-5 space-y-2.5">
                {[
                  { icon: Activity, label: 'Detecção de anomalias' },
                  { icon: Lightbulb, label: 'Recomendações em tempo real' },
                  { icon: Sparkles, label: 'Aprendizado contínuo' },
                ].map(item => (
                  <li
                    key={item.label}
                    className="flex items-center gap-2.5 rounded-[10px] border border-[rgba(140,170,215,0.13)] bg-white/[0.025] px-3 py-2 text-[12.5px] text-mist-100"
                  >
                    <item.icon size={14} className="text-enterprise-400 flex-shrink-0" />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden lg:block">
              <BlindAiPanel />
            </div>
          </Card>

          {/* HeatMap Inteligente */}
          <Card className="sm:col-span-2 flex items-center gap-5 p-5 sm:p-6">
            <div className="relative z-10 min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <IconBox icon={heat.icon} />
                <Chevron className="lg:hidden xl:grid" />
              </div>
              <h3 className="mt-3.5 text-base font-semibold text-mist-100">{heat.title}</h3>
              <p className="mt-1.5 text-[13px] leading-snug text-mist-400">{heat.desc}</p>
            </div>
            <div className="hidden sm:block relative z-10">
              <HeatMini />
            </div>
          </Card>

          {/* Confidence Score */}
          <Card className="flex flex-col p-5">
            <div className="relative z-10 flex items-start justify-between gap-3">
              <IconBox icon={confidence.icon} />
              <Chevron />
            </div>
            <h3 className="relative z-10 mt-3.5 text-base font-semibold text-mist-100">{confidence.title}</h3>
            <div className="relative z-10 mt-1.5 flex items-center justify-between gap-3">
              <p className="text-[12.5px] leading-snug text-mist-400">{confidence.desc}</p>
              <ConfidenceRing />
            </div>
          </Card>

          {/* Inventário por Risco */}
          <Card className="flex flex-col p-5">
            <div className="relative z-10 flex items-start justify-between gap-3">
              <IconBox icon={risk.icon} />
              <Chevron />
            </div>
            <h3 className="relative z-10 mt-3.5 text-base font-semibold text-mist-100">{risk.title}</h3>
            <div className="relative z-10 mt-1.5 flex items-end justify-between gap-3">
              <p className="text-[13px] leading-snug text-mist-400">{risk.desc}</p>
              <RiskBars />
            </div>
          </Card>

          {/* Root Cause Analysis */}
          <Card className="sm:col-span-2 flex gap-5 p-5 sm:p-6">
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
              <IconBox icon={rootCause.icon} />
              <h3 className="mt-3.5 text-base font-semibold text-mist-100">{rootCause.title}</h3>
              <p className="mt-1.5 text-[13px] leading-snug text-mist-400">{rootCause.desc}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {['Pareto', '5 Porquês', 'Recorrência'].map(chip => (
                  <span
                    key={chip}
                    className="rounded-[9px] border border-[rgba(140,170,215,0.13)] bg-white/[0.025] px-2.5 py-1 text-[11.5px] text-mist-400"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="hidden lg:flex relative z-10 w-[250px] flex-shrink-0 items-stretch gap-3">
              <div className="min-w-0 flex-1">
                <CausesPanel />
              </div>
              <Chevron className="self-start" />
            </div>
          </Card>

          {/* Warehouse Digital Twin */}
          <Card className="sm:col-span-2 flex flex-col p-5 sm:p-6">
            <div className="hidden sm:block">
              <TwinMap />
            </div>
            <div className="relative z-10 flex items-start justify-between gap-4">
              <IconBox icon={twin.icon} />
              <Chevron />
            </div>
            <h3 className="relative z-10 mt-3.5 text-base font-semibold text-mist-100">{twin.title}</h3>
            <p className="relative z-10 mt-1.5 max-w-[230px] text-[13px] leading-snug text-mist-400">{twin.desc}</p>
            <span
              aria-hidden="true"
              className="absolute right-5 bottom-5 z-10 hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[rgba(140,170,215,0.16)] bg-ink-950/85 px-2.5 py-1.5 text-[11px] text-mist-100"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-enterprise-300" /> Rota otimizada
            </span>
          </Card>
        </motion.div>

        <p className="mt-14 mb-5 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-mist-400/75">
          Mais recursos da plataforma
        </p>

        <motion.div
          variants={staggerContainer(0.04)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.05 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          {MORE.map(mod => (
            <motion.div
              key={mod.title}
              variants={cardIn}
              style={SURFACE}
              className="group relative overflow-hidden rounded-xl border border-[rgba(140,170,215,0.11)] p-4 transition-colors duration-300 hover:border-[rgba(140,170,215,0.24)]"
            >
              <div className="flex items-center gap-3">
                <IconBox icon={mod.icon} size="sm" />
                <h3 className="min-w-0 text-[13.5px] font-semibold text-mist-100">{mod.title}</h3>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-snug text-mist-400">{mod.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        <div className="mt-14 flex flex-col sm:flex-row flex-wrap items-stretch justify-center gap-5 sm:gap-0">
          {BENEFITS.map(({ icon: Icon, title, text }, i) => (
            <div
              key={title}
              className={`flex items-center gap-3 sm:px-6 lg:px-8 ${i > 0 ? 'sm:border-l sm:border-ink-700/70' : ''}`}
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
