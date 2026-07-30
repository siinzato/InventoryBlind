import React from 'react';
import { ShieldX, ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface AccessDeniedPageProps {
  onBack: () => void;
}

export default function AccessDeniedPage({ onBack }: AccessDeniedPageProps) {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-red-500/20">
          <ShieldX size={36} className="text-red-400" />
        </div>
        <h1 className="text-2xl font-black text-white mb-3">Acesso Negado</h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          Você não possui permissão para visualizar estes dados.<br />
          Caso acredite que isso seja um erro, entre em contato com o administrador da empresa.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-sm transition"
          >
            <ArrowLeft size={16} />
            Voltar ao Dashboard
          </button>
          <button
            onClick={signOut}
            className="flex items-center justify-center gap-2 w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl font-semibold text-sm transition"
          >
            <LogOut size={16} />
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}
