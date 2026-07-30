/**
 * AuthPage — Login, Signup, Forgot Password, Email Confirmation
 *
 * Single component with view switching.
 * Uses Supabase email/password auth with email confirmation.
 * On signup: creates the company first, then creates the auth user
 * passing company_id in raw_user_meta_data → handle_new_user trigger
 * creates the profile automatically.
 */

import React, { useState } from 'react';
import { BarChart3, Eye, EyeOff, ArrowLeft, Check, Mail, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

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
}> = ({ label, type = 'text', value, onChange, placeholder, error, autoComplete, suffix }) => (
  <div>
    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">{label}</label>
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full px-4 py-3 bg-zinc-800 border rounded-xl text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 transition ${
          error ? 'border-red-500/50 focus:ring-red-500/20' : 'border-zinc-700 focus:ring-emerald-500/30 focus:border-emerald-500/50'
        } ${suffix ? 'pr-12' : ''}`}
      />
      {suffix && <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>}
    </div>
    {error && <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
  </div>
);

// ── Login ─────────────────────────────────────────────────────────────────────

const LoginView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
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

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-6 transition">
        <ArrowLeft size={14} /> Voltar
      </button>
      <h2 className="text-2xl font-black text-white mb-1">Entrar</h2>
      <p className="text-zinc-500 text-sm mb-7">Bem-vindo de volta ao InventoryBlind.</p>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com" autoComplete="email" />
        <Input label="Senha" type={showPw ? 'text' : 'password'} value={password} onChange={setPassword}
          placeholder="••••••••" autoComplete="current-password"
          suffix={
            <button type="button" onClick={() => setShowPw(v => !v)} className="text-zinc-500 hover:text-zinc-300 transition">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
        <div className="text-right">
          <button type="button" onClick={() => setView('forgot')} className="text-xs text-zinc-500 hover:text-emerald-400 transition">
            Esqueceu a senha?
          </button>
        </div>
        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition">
          {loading ? <RefreshCw size={16} className="animate-spin" /> : 'Entrar'}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-500 mt-6">
        Não tem conta?{' '}
        <button onClick={() => setView('signup')} className="text-emerald-400 hover:text-emerald-300 font-semibold transition">
          Criar conta
        </button>
      </p>
    </div>
  );
};

// ── Signup ────────────────────────────────────────────────────────────────────

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
      // 1. Create company first
      const slug = company.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data: companyData, error: compErr } = await supabase
        .from('companies')
        .insert({ name: company.trim(), slug: `${slug}-${Date.now()}`, plan: 'starter' })
        .select('id')
        .single();

      if (compErr) throw new Error('Erro ao criar empresa: ' + compErr.message);

      // 2. Create auth user — trigger will create profile with company_id
      const { error: signupErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
            company_id: companyData.id,
            role: 'owner',
          },
        },
      });

      if (signupErr) {
        // Clean up company if signup failed
        await supabase.from('companies').delete().eq('id', companyData.id);
        if (signupErr.message.includes('already registered')) {
          setGlobalError('Este e-mail já está cadastrado. Faça login ou recupere sua senha.');
        } else {
          setGlobalError(signupErr.message);
        }
        return;
      }

      // 3. Update company owner_id (we need the new user's ID)
      // The trigger creates the profile; we can update owner after login
      setView('confirm-email');
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'Erro ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-6 transition">
        <ArrowLeft size={14} /> Voltar
      </button>
      <h2 className="text-2xl font-black text-white mb-1">Criar Conta</h2>
      <p className="text-zinc-500 text-sm mb-7">Crie o ambiente da sua empresa no InventoryBlind.</p>

      {globalError && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{globalError}
        </div>
      )}

      <form onSubmit={handleSignup} className="space-y-4">
        <Input label="Seu Nome" value={name} onChange={setName} placeholder="João Silva" autoComplete="name" error={errors.name} />
        <Input label="Nome da Empresa" value={company} onChange={setCompany} placeholder="Minha Empresa Ltda" error={errors.company} />
        <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com" autoComplete="email" error={errors.email} />
        <Input label="Senha" type={showPw ? 'text' : 'password'} value={password} onChange={setPassword}
          placeholder="Mínimo 6 caracteres" autoComplete="new-password" error={errors.password}
          suffix={
            <button type="button" onClick={() => setShowPw(v => !v)} className="text-zinc-500 hover:text-zinc-300 transition">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
        <Input label="Confirmar Senha" type={showPw ? 'text' : 'password'} value={confirm} onChange={setConfirm}
          placeholder="Repita a senha" error={errors.confirm} />

        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition mt-2">
          {loading ? <RefreshCw size={16} className="animate-spin" /> : 'Criar Conta'}
        </button>
      </form>

      <p className="text-xs text-zinc-600 text-center mt-4 leading-relaxed">
        Ao criar uma conta você concorda com os <a href="#" className="underline hover:text-zinc-400">Termos de Uso</a> e a{' '}
        <a href="#" className="underline hover:text-zinc-400">Política de Privacidade</a>.
      </p>

      <p className="text-center text-sm text-zinc-500 mt-4">
        Já tem conta?{' '}
        <button onClick={() => setView('login')} className="text-emerald-400 hover:text-emerald-300 font-semibold transition">
          Entrar
        </button>
      </p>
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
      <h2 className="text-xl font-black text-white mb-2">E-mail enviado!</h2>
      <p className="text-zinc-400 text-sm mb-6">Verifique sua caixa de entrada para redefinir sua senha.</p>
      <button onClick={onBack} className="text-emerald-400 hover:text-emerald-300 text-sm font-semibold transition">
        Voltar ao login
      </button>
    </div>
  );

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-6 transition">
        <ArrowLeft size={14} /> Voltar
      </button>
      <h2 className="text-2xl font-black text-white mb-1">Recuperar Senha</h2>
      <p className="text-zinc-500 text-sm mb-7">Enviaremos um link para redefinir sua senha.</p>
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 mb-5">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{error}
        </div>
      )}
      <form onSubmit={handleReset} className="space-y-4">
        <Input label="E-mail" type="email" value={email} onChange={setEmail} placeholder="seu@email.com" />
        <button type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition">
          {loading ? <RefreshCw size={16} className="animate-spin" /> : 'Enviar Link'}
        </button>
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
      <div className="w-16 h-16 bg-blue-500/15 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Mail size={28} className="text-blue-400" />
      </div>
      <h2 className="text-xl font-black text-white mb-2">Confirme seu e-mail</h2>
      <p className="text-zinc-400 text-sm mb-2">
        Enviamos um link de confirmação para
      </p>
      <p className="text-white font-semibold text-sm mb-6">{user?.email}</p>
      <p className="text-zinc-500 text-xs mb-8">
        Clique no link no e-mail para ativar sua conta.<br />
        Verifique também a pasta de spam.
      </p>
      {resent ? (
        <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm mb-4">
          <Check size={14} /> E-mail reenviado!
        </div>
      ) : (
        <button onClick={resend} disabled={loading}
          className="flex items-center justify-center gap-2 text-zinc-400 hover:text-white text-sm transition mb-4 mx-auto">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : null}
          Reenviar e-mail de confirmação
        </button>
      )}
      <button onClick={signOut} className="text-xs text-zinc-600 hover:text-zinc-400 transition">
        Sair e usar outra conta
      </button>
    </div>
  );
};

// ── Main AuthPage ─────────────────────────────────────────────────────────────

const AuthPage: React.FC = () => {
  const { view, setView } = useAuth();

  const isConfirm = view === 'confirm-email';

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-emerald-500/4 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-blue-500/4 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-emerald-500 rounded-xl flex items-center justify-center">
            <BarChart3 size={20} className="text-white" />
          </div>
          <span className="font-black text-white text-xl tracking-tight">InventoryBlind</span>
        </div>

        {/* Card */}
        <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-2xl p-8 shadow-2xl">
          {isConfirm && <ConfirmEmailView />}
          {!isConfirm && view === 'login' && <LoginView onBack={() => setView('landing')} />}
          {!isConfirm && view === 'signup' && <SignupView onBack={() => setView('landing')} />}
          {!isConfirm && view === 'forgot' && <ForgotView onBack={() => setView('login')} />}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
