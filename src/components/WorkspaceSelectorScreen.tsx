import { useState } from 'react';
import { motion } from 'motion/react';
import { Building2, LogOut, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { setRememberedWorkspaceDevice } from '../lib/workspacePrefs';
import { Panel, Button } from './ui';
import { LogoMark } from './landing/landingUi';

const formatLastAccess = (iso: string | null): string => {
  if (!iso) return 'Nunca acessado';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'Acessado hoje';
  if (diffDays === 1) return 'Acessado ontem';
  if (diffDays < 30) return `Acessado há ${diffDays} dias`;
  return `Acessado em ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

export default function WorkspaceSelectorScreen() {
  const { companies, switchCompany, switchingCompany, signOut, setView } = useAuth();
  const [remember, setRemember] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const handleEnter = async (companyId: string) => {
    setEnteringId(companyId);
    await switchCompany(companyId);
    setRememberedWorkspaceDevice(remember);
    setView('app');
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-12 h-12 bg-accent/10 rounded-container flex items-center justify-center mb-4">
            <LogoMark size={24} className="text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-fg mb-1.5">Selecione seu Workspace</h1>
          <p className="text-fg-muted text-sm">Escolha o ambiente que deseja acessar.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {companies.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            >
              <Panel className="p-5 h-full flex flex-col">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-surface-3 flex items-center justify-center text-xl flex-shrink-0">
                    {c.icon ? c.icon : <Building2 size={20} className="text-fg-subtle" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-fg truncate">{c.name}</p>
                    {c.description && <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">{c.description}</p>}
                  </div>
                </div>
                <p className="text-xs text-fg-subtle mb-4">{formatLastAccess(c.lastAccessedAt)}</p>
                <Button
                  className="mt-auto w-full"
                  disabled={switchingCompany}
                  onClick={() => handleEnter(c.id)}
                >
                  {switchingCompany && enteringId === c.id ? 'Entrando...' : 'Entrar'} <ArrowRight size={15} />
                </Button>
              </Panel>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-4 mt-8">
          <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="accent-accent"
            />
            Lembrar neste dispositivo
          </label>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-fg-subtle hover:text-fg text-xs transition"
          >
            <LogOut size={13} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}
