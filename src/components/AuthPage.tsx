/**
 * AuthPage — Login, Signup, Forgot Password, Email Confirmation
 *
 * Single component with view switching.
 * Uses Supabase email/password auth with email confirmation.
 * On signup: creates the auth user first (handle_new_user trigger creates a
 * company-less profile, role='viewer'), then — now authenticated — calls the
 * create_company_onboarding() RPC to create the company, promote this user
 * to owner, and create the matching company_members row, all atomically.
 * See supabase/migrations/20260811120000_038_company_onboarding_rpc.sql.
 */

import React, { useState, useRef } from 'react';
import { Eye, EyeOff, ArrowLeft, ArrowRight, Check, Mail, Lock, User, Building2, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth, setPendingCompanyOnboarding, clearPendingCompanyOnboarding } from '../lib/auth';
import { LogoMark } from './landing/landingUi';
import { motion, MagneticButton, useReducedMotion } from './landing/landingMotion';
import { useGSAP, gsap } from './landing/landingScroll';

// ── Shared input component ────────────────────────────────────────────────────

const Input: React.FC<{
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  suffix?: React.ReactNode;
  /** Leading icon — used by the login screen's inputs only; omitted everywhere
   *  else so signup/forgot keep their exact current appearance. */
  icon?: React.ReactNode;
}> = ({ label, type = 'text', value, onChange, placeholder, error, autoComplete, suffix, icon }) => (
  <div>
    <label className="block text-xs font-semibold text-mist-400 uppercase tracking-wide mb-1.5">{label}</label>
    <div className="relative">
      {icon && (
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-400/70 pointer-events-none">
          {icon}
        </div>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full py-3 ${icon ? 'pl-10' : 'px-4'} bg-ink-800 border rounded-xl text-mist-100 placeholder-mist-400/40 text-sm focus:outline-none focus:ring-2 transition ${
          error ? 'border-red-500/50 focus:ring-red-500/20' : 'border-ink-600 focus:ring-enterprise-400/30 focus:border-enterprise-400/50'
        } ${suffix ? 'pr-12' : icon ? 'pr-4' : ''}`}
      />
      {suffix && <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>}
    </div>
    {error && <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
  </div>
);

// ── Barra superior compartilhada ──────────────────────────────────────────────

/** Cabeçalho de página do login, agora também usado pelo cadastro.
 *
 *  Extraído porque login e cadastro passaram a ser a mesma composição de página e
 *  duas cópias divergiriam. Recebe a ref por prop em vez de forwardRef só para não
 *  tocar na timeline do login: o GSAP continua animando exatamente o mesmo nó. */
const AuthTopBar: React.FC<{
  onBack: () => void;
  innerRef?: React.Ref<HTMLDivElement>;
}> = ({ onBack, innerRef }) => (
  <div ref={innerRef} className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-ink-800">
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-enterprise-500 to-enterprise-700 flex items-center justify-center flex-shrink-0">
        <LogoMark size={17} className="text-white" />
      </div>
      <span className="font-bold text-mist-100 text-base tracking-tight">InventoryBlind</span>
    </div>
    <button onClick={onBack} className="flex items-center gap-1.5 text-mist-400 hover:text-mist-100 text-sm transition">
      <ArrowLeft size={14} /> Voltar
    </button>
  </div>
);

// ── Login ─────────────────────────────────────────────────────────────────────
//
// Redesigned as a full-page split composition instead of the centered-card
// pattern used by Signup/Forgot/ConfirmEmail below (those stay untouched).
// Auth logic (state, validation, error handling, submit) is identical to the
// previous LoginView — only the markup changed.

/** Fictional, static — purely decorative. Never fetched, never real stock. */
const BLIND_ROWS: { sku: string; local: string; value: string }[] = [
  { sku: '018291', local: 'A-01-03', value: '1.246' },
  { sku: '074582', local: 'B-02-07', value: '892' },
  { sku: '193847', local: 'C-03-12', value: '434' },
  { sku: '276501', local: 'D-04-01', value: '67' },
  { sku: '319204', local: 'E-05-09', value: '310' },
];

const LoginScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { setView } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Preencha e-mail e senha.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        if (err.message.includes('Invalid login') || err.message.includes('invalid_credentials')) {
          setError('E-mail ou senha incorretos.');
        } else if (err.message.includes('Email not confirmed')) {
          setError('Confirme seu e-mail antes de entrar.');
        } else {
          setError(err.message);
        }
        setLoading(false);
      }
      // On success the onAuthStateChange handler navigates — component unmounts
    } catch {
      setError('Falha na conexão. Tente novamente.');
      setLoading(false);
    }
  };

  // ── Entrance timeline (GSAP) ──────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const formColRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const maskRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  rowRefs.current = [];
  valueRefs.current = [];
  maskRefs.current = [];
  barRefs.current = [];

  const reduce = useReducedMotion();

  useGSAP(
    () => {
      const fadeTargets = [headerRef.current, headlineRef.current, tableWrapRef.current, formColRef.current];

      if (reduce) {
        // Skip the story entirely: land straight on the "blind" end-state.
        gsap.set(fadeTargets, { opacity: 1, x: 0, y: 0 });
        gsap.set(rowRefs.current, { opacity: 1, y: 0 });
        gsap.set(valueRefs.current, { opacity: 0 });
        gsap.set(maskRefs.current, { opacity: 1 });
        gsap.set(barRefs.current, { opacity: 0 });
        return;
      }

      gsap.set(maskRefs.current, { opacity: 0 });
      gsap.set(barRefs.current, { scaleX: 0, transformOrigin: 'left center', opacity: 1 });

      const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

      tl.from(headerRef.current, { opacity: 0, y: -8, duration: 0.35 }, 0)
        .from(headlineRef.current, { opacity: 0, y: 14, duration: 0.4 }, 0.1)
        .from(tableWrapRef.current, { opacity: 0, y: 14, duration: 0.4 }, 0.22)
        .from(rowRefs.current, { opacity: 0, y: 10, duration: 0.32, stagger: 0.07 }, 0.32)
        // The "blind" reveal: a thin bar sweeps over each quantity, then the
        // real value fades out as the masked "•••" fades in underneath it.
        .to(barRefs.current, { scaleX: 1, duration: 0.22, stagger: 0.09, ease: 'power2.inOut' }, 0.75)
        .to(valueRefs.current, { opacity: 0, duration: 0.1, stagger: 0.09 }, 0.85)
        .to(maskRefs.current, { opacity: 1, duration: 0.1, stagger: 0.09 }, 0.85)
        .to(barRefs.current, { opacity: 0, duration: 0.15, stagger: 0.09 }, 0.95)
        .from(formColRef.current, { opacity: 0, x: 14, duration: 0.4 }, 1.15);

      return () => { tl.kill(); };
    },
    { scope: containerRef, dependencies: [reduce] }
  );

  return (
    <div ref={containerRef} className="min-h-screen bg-ink-950 flex flex-col">
      {/* Page-level header — logo + Voltar span the full width, no floating card */}
      <AuthTopBar innerRef={headerRef} onBack={onBack} />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[55fr_45fr]">
        {/* ── IDENTITY: Blind Count concept ──────────────────────────────── */}
        <div className="flex flex-col justify-center px-6 md:px-12 lg:px-16 py-12">
          <div ref={headlineRef}>
            <h1 className="text-4xl md:text-5xl font-extrabold text-mist-100 leading-[1.05] tracking-tight">
              Contagem cega.<br />
              <span className="text-enterprise-400">Resultado claro.</span>
            </h1>
            <p className="text-mist-400 text-base mt-4 max-w-sm">
              Conte sem influência. Decida com confiança.
            </p>
          </div>

          <div ref={tableWrapRef} className="mt-8 max-w-md">
            <div className="rounded-2xl border border-ink-700 bg-ink-900/40 overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-4 px-5 py-3 border-b border-ink-800">
                <span className="text-[11px] font-semibold text-mist-400/70 uppercase tracking-wide">SKU</span>
                <span className="text-[11px] font-semibold text-mist-400/70 uppercase tracking-wide">Local</span>
                <span className="text-[11px] font-semibold text-mist-400/70 uppercase tracking-wide text-right">Contagem</span>
              </div>
              <div>
                {BLIND_ROWS.map((row, i) => (
                  <div
                    key={row.sku}
                    ref={el => { rowRefs.current[i] = el; }}
                    className={`grid grid-cols-[1fr_1fr_auto] gap-4 px-5 py-3 border-b border-ink-800/60 last:border-0 ${
                      i >= 3 ? 'hidden md:grid' : ''
                    }`}
                  >
                    <span className="text-sm text-mist-100 font-mono">{row.sku}</span>
                    <span className="text-sm text-mist-400">{row.local}</span>
                    <span className="relative inline-flex items-center justify-end w-16 h-5 ml-auto">
                      <span
                        ref={el => { valueRefs.current[i] = el; }}
                        className="absolute inset-0 flex items-center justify-end font-mono text-sm text-mist-100"
                      >
                        {row.value}
                      </span>
                      <span
                        ref={el => { maskRefs.current[i] = el; }}
                        className="absolute inset-0 flex items-center justify-end font-mono text-sm text-mist-400 tracking-widest opacity-0"
                      >
                        •••
                      </span>
                      <span
                        ref={el => { barRefs.current[i] = el; }}
                        className="absolute inset-y-0.5 left-0 w-full rounded-sm bg-enterprise-400"
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-mist-400/80">
              <ShieldCheck size={14} className="text-enterprise-400 flex-shrink-0" />
              Valores esperados permanecem ocultos durante a contagem.
            </div>
          </div>
        </div>

        {/* ── AUTHENTICATION ──────────────────────────────────────────────── */}
        <div ref={formColRef} className="flex items-center justify-center px-6 md:px-12 py-10 md:border-l md:border-ink-800">
          <div className="w-full max-w-sm">
            <p className="text-xs font-semibold text-enterprise-400 uppercase tracking-wide mb-6">
              Acessar InventoryBlind
            </p>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="E-mail" type="email" value={email} onChange={setEmail}
                placeholder="seu@email.com" autoComplete="email" icon={<Mail size={15} />}
              />
              <Input
                label="Senha" type={showPw ? 'text' : 'password'} value={password} onChange={setPassword}
                placeholder="Sua senha" autoComplete="current-password" icon={<Lock size={15} />}
                suffix={
                  <button type="button" onClick={() => setShowPw(v => !v)} className="text-mist-400 hover:text-mist-100 transition">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
              <div className="text-right">
                <button type="button" onClick={() => setView('forgot')} className="text-xs text-mist-400 hover:text-enterprise-400 transition">
                  Esqueci a senha
                </button>
              </div>
              <MagneticButton
                type="submit"
                disabled={loading}
                className="group w-full flex items-center justify-between gap-2 px-5 py-3.5 disabled:opacity-60 rounded-xl font-semibold text-sm"
              >
                <span>{loading ? 'Entrando...' : 'Acessar ambiente'}</span>
                {loading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                )}
              </MagneticButton>
            </form>

            <p className="text-center text-sm text-mist-400 mt-6">
              Ainda não possui acesso?{' '}
              <button onClick={() => setView('signup')} className="text-enterprise-400 hover:text-enterprise-300 font-semibold transition">
                Criar conta →
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Signup ────────────────────────────────────────────────────────────────────

/** O que de fato acontece depois de criar a conta. Nada aqui é promessa comercial:
 *  são as três etapas que o próprio fluxo executa. */
const SIGNUP_STEPS: { title: string; detail: string }[] = [
  { title: 'Ambiente da empresa', detail: 'Criado junto com a conta, com você como responsável.' },
  { title: 'Confirmação de e-mail', detail: 'Enviamos um link para ativar o acesso.' },
  { title: 'Diagnóstico da operação', detail: 'Opcional, indica o plano adequado ao seu volume.' },
];

const SignupView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { setView } = useAuth();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState('');

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Informe seu nome.';
    if (!company.trim()) e.company = 'Informe o nome da empresa.';
    if (!email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) e.email = 'E-mail inválido.';
    if (password.length < 6) e.password = 'Senha deve ter ao menos 6 caracteres.';
    if (password !== confirm) e.confirm = 'As senhas não coincidem.';
    return e;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError('');
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setLoading(true);
    try {
      // Hand the company name off to auth.tsx's runAuthSequence — it runs
      // create_company_onboarding() itself, right after loading this user's
      // (company-less) profile, then resolves `view` from the result. That
      // keeps company-creation and view-resolution in the same sequence: a
      // second, independent call from here raced the background sequence
      // triggered by the same signUp() and lost (confirmed live — the
      // background pass finished last and overwrote the correct view with
      // a stale, pre-onboarding snapshot).
      setPendingCompanyOnboarding(company.trim(), name.trim());

      // handle_new_user creates a company-less profile (role='viewer') —
      // company_id/role in metadata are ignored by design, so we don't send
      // them here.
      const { error: signupErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
        },
      });

      if (signupErr) {
        clearPendingCompanyOnboarding();
        if (signupErr.message.includes('already registered')) {
          setGlobalError('Este e-mail já está cadastrado. Faça login ou recupere sua senha.');
        } else {
          setGlobalError(signupErr.message);
        }
        return;
      }

      // No setView here — onAuthStateChange's runAuthSequence (triggered by
      // this same signUp() call) creates the company and resolves the view.
    } catch (err: unknown) {
      clearPendingCompanyOnboarding();
      setGlobalError(err instanceof Error ? err.message : 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col">
      <AuthTopBar onBack={onBack} />

      {/* Mesma grade do login: identidade à esquerda, autenticação à direita. */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[55fr_45fr]">
        {/* ── IDENTIDADE ────────────────────────────────────────────────────── */}
        <div className="flex flex-col justify-center px-6 md:px-12 lg:px-16 py-12">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-mist-100 leading-[1.05] tracking-tight">
              Contagem cega.<br />
              <span className="text-enterprise-400">Resultado claro.</span>
            </h1>
            <p className="text-mist-400 text-base mt-4 max-w-sm">
              Cada empresa tem seu próprio ambiente, com dados isolados.
            </p>
          </div>

          {/* Mesma moldura do painel do login (rounded-2xl / ink-700 / ink-900/40),
              com o que realmente acontece depois de criar a conta — nenhuma promessa
              que o produto não cumpra. */}
          <div className="mt-8 max-w-md">
            <div className="rounded-2xl border border-ink-700 bg-ink-900/40 overflow-hidden">
              {SIGNUP_STEPS.map((item, i) => (
                <div
                  key={item.title}
                  className="flex items-start gap-4 px-5 py-4 border-b border-ink-800/60 last:border-0"
                >
                  <span className="flex-shrink-0 w-6 h-6 rounded-md bg-ink-800 text-enterprise-400 font-mono text-xs flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-mist-100 font-medium">{item.title}</p>
                    <p className="text-xs text-mist-400 mt-0.5 leading-relaxed">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-mist-400/80">
              <ShieldCheck size={14} className="text-enterprise-400 flex-shrink-0" />
              O plano Free é permanente e não exige cartão.
            </div>
          </div>
        </div>

        {/* ── CADASTRO ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center px-6 md:px-12 py-10 md:border-l md:border-ink-800">
          <div className="w-full max-w-sm">
            <p className="text-xs font-semibold text-enterprise-400 uppercase tracking-wide mb-6">
              Criar conta
            </p>

            {globalError && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{globalError}
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-4">
              <Input label="Nome" value={name} onChange={setName} placeholder="João Silva"
                autoComplete="name" error={errors.name} icon={<User size={15} />} />
              <Input label="Empresa" value={company} onChange={setCompany} placeholder="Minha Empresa Ltda"
                error={errors.company} icon={<Building2 size={15} />} />
              <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com"
                autoComplete="email" error={errors.email} icon={<Mail size={15} />} />
              <Input label="Senha" type={showPw ? 'text' : 'password'} value={password} onChange={setPassword}
                placeholder="Mínimo 6 caracteres" autoComplete="new-password" error={errors.password}
                icon={<Lock size={15} />}
                suffix={
                  <button type="button" onClick={() => setShowPw(v => !v)} className="text-mist-400 hover:text-mist-100 transition">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
              <Input label="Confirmar senha" type={showPw ? 'text' : 'password'} value={confirm} onChange={setConfirm}
                placeholder="Repita a senha" autoComplete="new-password" error={errors.confirm}
                icon={<Lock size={15} />} />

              <MagneticButton
                type="submit"
                disabled={loading}
                className="group w-full flex items-center justify-between gap-2 px-5 py-3.5 disabled:opacity-60 rounded-xl font-semibold text-sm"
              >
                <span>{loading ? 'Criando conta...' : 'Criar conta'}</span>
                {loading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
                )}
              </MagneticButton>
            </form>

            <p className="text-xs text-mist-400/70 text-center mt-5 leading-relaxed">
              Ao criar uma conta você concorda com os <a href="#" className="underline hover:text-mist-100">Termos de Uso</a> e a{' '}
              <a href="#" className="underline hover:text-mist-100">Política de Privacidade</a>.
            </p>

            <p className="text-center text-sm text-mist-400 mt-5">
              Já possui uma conta?{' '}
              <button onClick={() => setView('login')} className="text-enterprise-400 hover:text-enterprise-300 font-semibold transition">
                Entrar
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Forgot Password ───────────────────────────────────────────────────────────

const ForgotView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Informe seu e-mail.'); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}`,
    });
    setLoading(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  if (sent) return (
    <div className="text-center">
      <div className="w-16 h-16 bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Mail size={28} className="text-emerald-400" />
      </div>
      <h2 className="text-xl font-bold text-mist-100 mb-2">E-mail enviado!</h2>
      <p className="text-mist-400 text-sm mb-6">Verifique sua caixa de entrada para redefinir sua senha.</p>
      <button onClick={onBack} className="text-enterprise-400 hover:text-enterprise-300 text-sm font-semibold transition">
        Voltar ao login
      </button>
    </div>
  );

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-mist-400 hover:text-mist-100 text-sm mb-6 transition">
        <ArrowLeft size={14} /> Voltar
      </button>
      <h2 className="text-2xl font-bold text-mist-100 mb-1">Recuperar Senha</h2>
      <p className="text-mist-400 text-sm mb-7">Enviaremos um link para redefinir sua senha.</p>
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}
      <form onSubmit={handleReset} className="space-y-4">
        <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com" />
        <MagneticButton
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 disabled:opacity-60 rounded-xl font-bold text-sm"
        >
          {loading ? <RefreshCw size={16} className="animate-spin" /> : 'Enviar Link'}
        </MagneticButton>
      </form>
    </div>
  );
};

// ── Email Confirmation ────────────────────────────────────────────────────────

const ConfirmEmailView: React.FC = () => {
  const { user, signOut } = useAuth();
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);

  const resend = async () => {
    if (!user?.email) return;
    setLoading(true);
    await supabase.auth.resend({ type: 'signup', email: user.email });
    setLoading(false);
    setResent(true);
  };

  return (
    <div className="text-center">
      <div className="w-16 h-16 bg-enterprise-500/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Mail size={28} className="text-enterprise-400" />
      </div>
      <h2 className="text-xl font-bold text-mist-100 mb-2">Confirme seu e-mail</h2>
      <p className="text-mist-400 text-sm mb-2">
        Enviamos um link de confirmação para
      </p>
      <p className="text-mist-100 font-semibold text-sm mb-6">{user?.email}</p>
      <p className="text-mist-400/80 text-xs mb-8">
        Clique no link no e-mail para ativar sua conta.<br />
        Verifique também a pasta de spam.
      </p>
      {resent ? (
        <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-4">
          <Check size={14} /> E-mail reenviado!
        </div>
      ) : (
        <button onClick={resend} disabled={loading}
          className="flex items-center justify-center gap-2 text-mist-400 hover:text-mist-100 text-sm transition mb-4 mx-auto">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
          Reenviar e-mail de confirmação
        </button>
      )}
      <button onClick={signOut} className="text-xs text-mist-400/60 hover:text-mist-400 transition">
        Sair e usar outra conta
      </button>
    </div>
  );
};

// ── Main AuthPage ─────────────────────────────────────────────────────────────

const AuthPage: React.FC = () => {
  const { view, setView } = useAuth();

  // Login gets its own full-page composition (see LoginScreen above).
  // Signup/Forgot/ConfirmEmail keep the original centered-card layout,
  // untouched, below.
  if (view === 'login') {
    return <LoginScreen onBack={() => setView('landing')} />;
  }
  // Cadastro passou a ser a mesma composição de página do login (mesma barra
  // superior, mesma grade 55/45, mesma coluna de formulário), então também sai do
  // card centralizado abaixo.
  if (view === 'signup') {
    return <SignupView onBack={() => setView('landing')} />;
  }

  const isConfirm = view === 'confirm-email';

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-4">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-enterprise-700/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-enterprise-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-enterprise-500 to-enterprise-700 flex items-center justify-center">
            <LogoMark size={20} className="text-white" />
          </div>
          <span className="font-bold text-mist-100 text-xl tracking-tight">InventoryBlind</span>
        </div>

        {/* Card */}
        <div className="bg-ink-800/80 backdrop-blur border border-ink-700 rounded-2xl p-8 shadow-2xl">
          {isConfirm && <ConfirmEmailView />}
          {!isConfirm && view === 'forgot' && <ForgotView onBack={() => setView('login')} />}
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
