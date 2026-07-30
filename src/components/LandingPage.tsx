/**
 * LandingPage — InventoryBlind SaaS
 *
 * Visual premium, animações suaves, responsivo.
 * Nunca mostra dados internos — apenas vende a plataforma.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart3, Package, TrendingUp, Map, Tag, FileSpreadsheet,
  Zap, Users, Shield, Globe, ChevronRight, ArrowRight, Check,
  Bot, Activity, Archive, ClipboardCheck, Layers, Target,
  MessageSquare, Play, Star, ArrowUpRight, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

// ── Config ────────────────────────────────────────────────────────────────────

const WHATSAPP_PLANS_URL = 'https://wa.me/5511999999999?text=Quero+conhecer+os+planos+do+InventoryBlind';

// ── Helpers ───────────────────────────────────────────────────────────────────

function useIntersect(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeIn({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useIntersect();
  return (
    <div ref={ref} className={className}
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(24px)', transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms` }}>
      {children}
    </div>
  );
}

// ── Navbar ────────────────────────────────────────────────────────────────────

const Navbar: React.FC<{ onLogin: () => void; onSignup: () => void }> = ({ onLogin, onSignup }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);
  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-zinc-950/95 backdrop-blur-lg shadow-2xl' : 'bg-transparent'}`}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <BarChart3 size={18} className="text-white" />
          </div>
          <span className="font-black text-white text-lg tracking-tight">InventoryBlind</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {['Recursos', 'Integrações', 'Como Funciona', 'Planos'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(' ', '-')}`} className="text-sm text-zinc-400 hover:text-white transition font-medium">{l}</a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onLogin} className="text-sm font-semibold text-zinc-300 hover:text-white transition px-3 py-2">
            Entrar
          </button>
          <button onClick={onSignup} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-bold transition shadow-lg shadow-emerald-900/30">
            Criar Conta <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </nav>
  );
};

// ── Hero ──────────────────────────────────────────────────────────────────────

const Hero: React.FC<{ onLogin: () => void; onSignup: () => void }> = ({ onLogin, onSignup }) => {
  return (
    <section className="relative min-h-screen bg-zinc-950 flex items-center overflow-hidden">
      {/* Background decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-6 pt-28 pb-16 w-full">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left */}
          <div>
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full mb-6">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400 tracking-wider uppercase">Plataforma SaaS de Inventário</span>
            </div>

            <h1 className="text-5xl lg:text-6xl font-black text-white leading-[1.05] mb-6 tracking-tight">
              A Plataforma de{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">
                Inteligência
              </span>{' '}
              para Inventários e Gestão
            </h1>

            <p className="text-lg text-zinc-400 mb-4 leading-relaxed">
              Transforme inventários, operações e dados em decisões inteligentes.
            </p>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 mb-8">
              <p className="text-sm text-zinc-400 mb-1">A verdade sobre seu estoque:</p>
              <p className="text-base text-white font-medium leading-snug">
                Seu ERP controla o estoque.{' '}
                <span className="text-emerald-400 font-bold">O InventoryBlind mostra o que realmente está acontecendo nele.</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button onClick={onSignup}
                className="flex items-center gap-2 px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm transition shadow-lg shadow-emerald-900/40">
                Criar Conta Grátis <ArrowRight size={16} />
              </button>
              <button onClick={onLogin}
                className="flex items-center gap-2 px-6 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm transition border border-zinc-700">
                Entrar
              </button>
              <a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-6 py-3.5 text-zinc-400 hover:text-white rounded-xl font-semibold text-sm transition border border-zinc-800 hover:border-zinc-600">
                Conferir Planos <ChevronRight size={16} />
              </a>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-4 mt-8">
              <div className="flex -space-x-2">
                {['E','A','M','J','L'].map((l,i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-zinc-950 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6'][i] }}>{l}</div>
                ))}
              </div>
              <div>
                <div className="flex gap-0.5">{[1,2,3,4,5].map(i => <Star key={i} size={13} className="text-amber-400 fill-amber-400" />)}</div>
                <p className="text-xs text-zinc-500 mt-0.5">Utilizado por equipes de alto desempenho</p>
              </div>
            </div>
          </div>

          {/* Right — floating dashboard card */}
          <div className="relative hidden lg:block">
            <div className="relative rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-900">
              <div className="bg-zinc-800/80 px-5 py-3 flex items-center gap-2 border-b border-zinc-700/50">
                {['bg-red-500','bg-amber-500','bg-emerald-500'].map(c => <span key={c} className={`w-3 h-3 rounded-full ${c}`} />)}
                <span className="text-xs text-zinc-500 ml-2 font-mono">dashboard.inventoryblind.com</span>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: 'Acuracidade', v: '94.2%', c: 'text-emerald-400' },
                    { l: 'SKUs Contados', v: '1,847', c: 'text-blue-400' },
                    { l: 'Divergências', v: '23', c: 'text-amber-400' },
                  ].map(s => (
                    <div key={s.l} className="bg-zinc-800 rounded-xl p-3">
                      <p className="text-xs text-zinc-500 mb-1">{s.l}</p>
                      <p className={`text-xl font-black ${s.c}`}>{s.v}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-zinc-400 uppercase">Progresso Geral</p>
                    <span className="text-xs font-bold text-emerald-400">87.4%</span>
                  </div>
                  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" style={{ width: '87.4%' }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { l: 'Heatmap', c: 'from-orange-500/20 to-red-500/20 border-orange-500/20', icon: Map },
                    { l: 'Full Manager', c: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/20', icon: Package },
                    { l: 'Etiquetas', c: 'from-blue-500/20 to-indigo-500/20 border-blue-500/20', icon: Tag },
                    { l: 'IA Analytics', c: 'from-purple-500/20 to-pink-500/20 border-purple-500/20', icon: Bot },
                  ].map(({ l, c, icon: Icon }) => (
                    <div key={l} className={`bg-gradient-to-br ${c} border rounded-xl p-3 flex items-center gap-2`}>
                      <Icon size={16} className="text-zinc-300 flex-shrink-0" />
                      <span className="text-xs font-semibold text-zinc-300">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Floating badge */}
            <div className="absolute -top-4 -right-4 bg-emerald-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/50 rotate-2">
              Tempo real
            </div>
            <div className="absolute -bottom-4 -left-4 bg-zinc-900 border border-zinc-700 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xl -rotate-1 flex items-center gap-2">
              <Activity size={14} className="text-emerald-400" /> Atualizado agora
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ── Problems ──────────────────────────────────────────────────────────────────

const PROBLEMS = [
  { q: 'Quanto dinheiro está em risco?', a: 'Cruzamos estoque físico com custo médio para calcular o valor exato exposto a divergências.' },
  { q: 'Qual setor erra mais?', a: 'Rankings por setor, localização e produto mostram onde as divergências se concentram.' },
  { q: 'Qual colaborador precisa de treinamento?', a: 'Indicadores de desempenho individual revelam padrões de erro por operador.' },
  { q: 'Quanto foi economizado no inventário?', a: 'Comparamos acuracidade antes e depois para calcular o retorno operacional.' },
  { q: 'Onde estão as maiores divergências?', a: 'O Heatmap Inteligente mapeia visualmente cada posição do estoque em tempo real.' },
  { q: 'Qual área atacar primeiro amanhã?', a: 'A IA prioriza automaticamente as áreas críticas com maior impacto financeiro.' },
];

const Problems: React.FC = () => (
  <section className="bg-zinc-950 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-16">
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">As Dores do Mercado</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-4">Perguntas que todo gestor precisa responder</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">O InventoryBlind responde automaticamente a cada uma delas.</p>
        </div>
      </FadeIn>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {PROBLEMS.map((p, i) => (
          <FadeIn key={i} delay={i * 80}>
            <div className="group bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/30 rounded-2xl p-6 transition-all duration-300 cursor-default h-full">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-7 h-7 bg-emerald-500/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-emerald-500/20 transition">
                  <span className="text-emerald-400 font-black text-sm">{i + 1}</span>
                </div>
                <p className="font-bold text-white text-base leading-snug">{p.q}</p>
              </div>
              <div className="flex items-start gap-2 pl-10">
                <Check size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-zinc-400 text-sm leading-relaxed">{p.a}</p>
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  </section>
);

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Package, label: 'Inventário Cego', desc: 'Contagens sem viés — o operador não vê o saldo do sistema.' },
  { icon: BarChart3, label: 'Dashboard Geral', desc: 'Visão completa de progresso, acuracidade e divergências.' },
  { icon: TrendingUp, label: 'Dashboard Financeiro', desc: 'Custo das divergências, valor em risco e ROI do inventário.' },
  { icon: Map, label: 'Heatmap Inteligente', desc: 'Mapa visual de divergências por setor, corredor e posição.' },
  { icon: Archive, label: 'Histórico de Contagens', desc: 'Linha do tempo completa com comparação entre inventários.' },
  { icon: Tag, label: 'Gerador de Etiquetas', desc: 'Etiquetas de vão e excesso em PNG, PDF ou impressão direta.' },
  { icon: ClipboardCheck, label: 'Full Manager', desc: 'Gestão completa de operações Full para marketplaces.' },
  { icon: Target, label: 'Indicadores (KPI)', desc: 'Crie e monitore KPIs personalizados para sua operação.' },
  { icon: FileSpreadsheet, label: 'Relatórios', desc: 'Relatórios executivos prontos para apresentação.' },
  { icon: Zap, label: 'Integração com ERP', desc: 'Conecte Tiny, Bling, Omie, SAP, TOTVS e outros sistemas.' },
  { icon: Bot, label: 'Inteligência Artificial', desc: 'Assistente IA com contexto completo do seu inventário.' },
  { icon: Globe, label: 'Multiempresa', desc: 'Ambiente 100% isolado por empresa com roles e permissões.' },
];

const Features: React.FC = () => (
  <section id="recursos" className="bg-zinc-900 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-16">
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Plataforma Completa</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-4">Tudo que sua operação precisa</h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">Módulos integrados que cobrem desde a contagem até a inteligência de negócio.</p>
        </div>
      </FadeIn>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {FEATURES.map((f, i) => (
          <FadeIn key={i} delay={i * 50}>
            <div className="group bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-2xl p-5 transition-all duration-200">
              <div className="w-10 h-10 bg-emerald-500/10 group-hover:bg-emerald-500/20 rounded-xl flex items-center justify-center mb-4 transition">
                <f.icon size={20} className="text-emerald-400" />
              </div>
              <h3 className="font-bold text-white text-sm mb-1.5">{f.label}</h3>
              <p className="text-zinc-500 text-xs leading-relaxed">{f.desc}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  </section>
);

// ── ERP Integration ───────────────────────────────────────────────────────────

const ERPS = ['Tiny', 'Bling', 'Omie', 'SAP', 'TOTVS', 'API REST'];

const ErpSection: React.FC = () => (
  <section id="integrações" className="bg-zinc-950 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <div className="max-w-3xl mx-auto text-center">
        <FadeIn>
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Integrações</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-5">Faça integração com seu ERP</h2>
          <p className="text-zinc-400 text-lg mb-12 leading-relaxed">
            Conecte seus produtos, saldos, preços e movimentações para transformar dados brutos em inteligência de inventário.
          </p>
        </FadeIn>
        <FadeIn delay={100}>
          <div className="flex flex-wrap gap-3 justify-center mb-10">
            {ERPS.map(erp => (
              <div key={erp} className="px-5 py-3 bg-zinc-900 border border-zinc-700 hover:border-emerald-500/50 rounded-2xl font-bold text-white text-sm transition cursor-default">
                {erp}
              </div>
            ))}
          </div>
          <a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm transition shadow-lg shadow-emerald-900/30">
            Conferir Planos <ArrowRight size={16} />
          </a>
        </FadeIn>
      </div>
    </div>
  </section>
);

// ── How It Works ──────────────────────────────────────────────────────────────

const STEPS = [
  { n: '01', title: 'Importe seus produtos', desc: 'Carregue sua base de produtos via planilha ou integração com ERP.' },
  { n: '02', title: 'Realize inventários e operações', desc: 'Contagens cegas, Full Manager e gestão de picking em um só lugar.' },
  { n: '03', title: 'Acompanhe indicadores', desc: 'Dashboard em tempo real com acuracidade, divergências e heatmap.' },
  { n: '04', title: 'Transforme dados em decisões', desc: 'IA analisa padrões e prioriza ações de alto impacto para seu negócio.' },
];

const HowItWorks: React.FC = () => (
  <section id="como-funciona" className="bg-zinc-900 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-16">
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Processo</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-4">Como funciona</h2>
          <p className="text-zinc-400 text-lg">Do primeiro acesso à inteligência operacional em 4 etapas.</p>
        </div>
      </FadeIn>
      <div className="relative">
        {/* Connector line */}
        <div className="hidden lg:block absolute top-14 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
        <div className="grid lg:grid-cols-4 gap-6">
          {STEPS.map((s, i) => (
            <FadeIn key={i} delay={i * 120}>
              <div className="text-center relative">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center mx-auto mb-5 relative z-10 backdrop-blur-sm">
                  <span className="text-emerald-400 font-black text-xl">{s.n}</span>
                </div>
                <h3 className="font-bold text-white text-base mb-2">{s.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:flex absolute top-7 -right-3 z-20">
                    <ArrowRight size={16} className="text-emerald-500/40" />
                  </div>
                )}
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </div>
  </section>
);

// ── Benefits ──────────────────────────────────────────────────────────────────

const BENEFITS = [
  { icon: TrendingUp, title: 'Redução de divergências', desc: 'Identifique e elimine as causas raiz das perdas no estoque.' },
  { icon: Zap, title: 'Economia operacional', desc: 'Menos retrabalho, menos tempo perdido, mais resultado.' },
  { icon: Users, title: 'Maior produtividade', desc: 'Equipes focadas nas áreas certas com priorização automática por IA.' },
  { icon: Archive, title: 'Histórico permanente', desc: 'Linha do tempo completa de todos os inventários da empresa.' },
  { icon: Map, title: 'Heatmap Inteligente', desc: 'Visualize divergências geograficamente em cada posição do galpão.' },
  { icon: BarChart3, title: 'Dashboard Financeiro', desc: 'Transforme dados operacionais em impacto no resultado da empresa.' },
  { icon: Tag, title: 'Gerador de Etiquetas', desc: 'PNG, PDF e impressão direta. Sem popup, sem complicação.' },
  { icon: ClipboardCheck, title: 'Full Manager', desc: 'Operações Full para marketplaces com picking e conferência integrados.' },
  { icon: Zap, title: 'Integração ERP', desc: 'Dados sempre sincronizados com seu sistema de gestão.' },
  { icon: Shield, title: 'Segurança', desc: 'RLS por empresa. Nenhum dado vaza para outra organização.' },
  { icon: Globe, title: 'Multiempresa', desc: 'Ambiente 100% isolado. Cresça sem comprometer a privacidade.' },
  { icon: Activity, title: 'Escalabilidade', desc: 'Cresce com sua operação. De 100 a 100.000 SKUs sem atrito.' },
];

const Benefits: React.FC = () => (
  <section className="bg-zinc-950 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-16">
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Benefícios</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-4">Por que escolher o InventoryBlind</h2>
        </div>
      </FadeIn>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {BENEFITS.map((b, i) => (
          <FadeIn key={i} delay={i * 40}>
            <div className="flex items-start gap-3 p-4 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl transition">
              <div className="w-9 h-9 bg-emerald-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <b.icon size={18} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">{b.title}</h3>
                <p className="text-zinc-500 text-xs leading-relaxed">{b.desc}</p>
              </div>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  </section>
);

// ── Plans ─────────────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Starter', price: 'R$ 197', period: '/mês',
    desc: 'Ideal para pequenas operações que querem começar com inteligência.',
    features: ['Até 3 usuários', '5.000 SKUs', 'Dashboard Geral', 'Gerador de Etiquetas', 'Suporte por e-mail'],
    highlight: false,
  },
  {
    name: 'Professional', price: 'R$ 497', period: '/mês',
    desc: 'Para equipes em crescimento com necessidades avançadas.',
    features: ['Até 15 usuários', '50.000 SKUs', 'Todos os módulos', 'Full Manager', 'Heatmap + IA', 'Integração ERP', 'Suporte prioritário'],
    highlight: true,
  },
  {
    name: 'Enterprise', price: 'Consulte', period: '',
    desc: 'Operações complexas com múltiplos centros de distribuição.',
    features: ['Usuários ilimitados', 'SKUs ilimitados', 'Multi-CD', 'API personalizada', 'SLA garantido', 'Gerente de sucesso dedicado'],
    highlight: false,
  },
];

const Plans: React.FC = () => (
  <section id="planos" className="bg-zinc-900 py-24">
    <div className="max-w-7xl mx-auto px-6">
      <FadeIn>
        <div className="text-center mb-16">
          <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">Planos</span>
          <h2 className="text-4xl font-black text-white mt-3 mb-4">Escolha o plano ideal</h2>
          <p className="text-zinc-400 text-lg">Todos os planos incluem 14 dias gratuitos para testar.</p>
        </div>
      </FadeIn>
      <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {PLANS.map((p, i) => (
          <FadeIn key={i} delay={i * 100}>
            <div className={`relative rounded-2xl p-8 flex flex-col h-full transition ${
              p.highlight
                ? 'bg-gradient-to-b from-emerald-500/10 to-zinc-900 border-2 border-emerald-500/50'
                : 'bg-zinc-800/50 border border-zinc-700/50 hover:border-zinc-600'
            }`}>
              {p.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full">
                  Mais Popular
                </div>
              )}
              <div className="mb-6">
                <h3 className="font-black text-white text-xl mb-2">{p.name}</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className={`text-3xl font-black ${p.highlight ? 'text-emerald-400' : 'text-white'}`}>{p.price}</span>
                  <span className="text-zinc-500 text-sm">{p.period}</span>
                </div>
                <p className="text-zinc-400 text-sm leading-relaxed">{p.desc}</p>
              </div>
              <ul className="space-y-2.5 flex-1 mb-8">
                {p.features.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                    <Check size={14} className="text-emerald-400 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer"
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition ${
                  p.highlight
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-700 hover:bg-zinc-600 text-white'
                }`}>
                Conferir Plano <ArrowRight size={15} />
              </a>
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  </section>
);

// ── CTA ───────────────────────────────────────────────────────────────────────

const CTA: React.FC<{ onSignup: () => void }> = ({ onSignup }) => (
  <section className="bg-zinc-950 py-24">
    <div className="max-w-4xl mx-auto px-6 text-center">
      <FadeIn>
        <div className="bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-zinc-900 border border-emerald-500/20 rounded-3xl p-14">
          <div className="w-16 h-16 bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <BarChart3 size={32} className="text-emerald-400" />
          </div>
          <h2 className="text-4xl font-black text-white mb-4">Pronto para transformar sua operação?</h2>
          <p className="text-zinc-400 text-lg mb-8 max-w-xl mx-auto">
            Comece hoje. 14 dias gratuitos. Sem cartão de crédito.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button onClick={onSignup}
              className="flex items-center gap-2 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-base transition shadow-2xl shadow-emerald-900/40">
              Criar Conta Grátis <ArrowRight size={18} />
            </button>
            <a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-base transition border border-zinc-700">
              <MessageSquare size={18} /> Falar com Vendas
            </a>
          </div>
        </div>
      </FadeIn>
    </div>
  </section>
);

// ── Footer ────────────────────────────────────────────────────────────────────

const Footer: React.FC<{ onLogin: () => void; onSignup: () => void }> = ({ onLogin, onSignup }) => (
  <footer className="bg-zinc-950 border-t border-zinc-900 py-12">
    <div className="max-w-7xl mx-auto px-6">
      <div className="grid md:grid-cols-4 gap-8 mb-10">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
              <BarChart3 size={15} className="text-white" />
            </div>
            <span className="font-black text-white text-base">InventoryBlind</span>
          </div>
          <p className="text-zinc-500 text-sm leading-relaxed">A plataforma de inteligência para inventários e gestão operacional.</p>
        </div>
        <div>
          <h4 className="font-bold text-white text-sm mb-3">Plataforma</h4>
          <ul className="space-y-2">
            {['Recursos', 'Integrações', 'Planos', 'Changelog'].map(l => (
              <li key={l}><a href="#" className="text-zinc-500 hover:text-zinc-300 text-sm transition">{l}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-white text-sm mb-3">Conta</h4>
          <ul className="space-y-2">
            <li><button onClick={onLogin} className="text-zinc-500 hover:text-zinc-300 text-sm transition">Entrar</button></li>
            <li><button onClick={onSignup} className="text-zinc-500 hover:text-zinc-300 text-sm transition">Criar Conta</button></li>
            <li><a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-300 text-sm transition">Sobre</a></li>
            <li><a href={WHATSAPP_PLANS_URL} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-300 text-sm transition">Contato</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-white text-sm mb-3">Legal</h4>
          <ul className="space-y-2">
            {['Termos de Uso', 'Política de Privacidade', 'LGPD'].map(l => (
              <li key={l}><a href="#" className="text-zinc-500 hover:text-zinc-300 text-sm transition">{l}</a></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-zinc-900 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-zinc-600 text-xs">© {new Date().getFullYear()} InventoryBlind. Todos os direitos reservados.</p>
        <p className="text-zinc-600 text-xs">Feito para quem leva estoque a sério.</p>
      </div>
    </div>
  </footer>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

const LandingPage: React.FC = () => {
  const { setView } = useAuth();
  return (
    <div className="bg-zinc-950 min-h-screen">
      <Navbar onLogin={() => setView('login')} onSignup={() => setView('signup')} />
      <Hero onLogin={() => setView('login')} onSignup={() => setView('signup')} />
      <Problems />
      <Features />
      <ErpSection />
      <HowItWorks />
      <Benefits />
      <Plans />
      <CTA onSignup={() => setView('signup')} />
      <Footer onLogin={() => setView('login')} onSignup={() => setView('signup')} />
    </div>
  );
};

export default LandingPage;
