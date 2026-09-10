import React from 'react';
import { Lock, ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Panel, PanelSection, Button } from './ui';

interface AccessDeniedPageProps {
  onBack: () => void;
}

export default function AccessDeniedPage({ onBack }: AccessDeniedPageProps) {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <Panel className="w-full max-w-md">
        <PanelSection padding="lg" className="text-center">
          <Lock size={32} className="mx-auto mb-3 text-fg-subtle" />
          <h1 className="text-title">Acesso Negado</h1>
          <p className="text-fg-muted text-sm leading-relaxed mt-2">
            Você não possui permissão para visualizar estes dados.<br />
            Caso acredite que isso seja um erro, entre em contato com o administrador da empresa.
          </p>
          <div className="flex flex-col gap-3 mt-6">
            <Button onClick={onBack} className="w-full">
              <ArrowLeft size={16} />
              Voltar ao Dashboard
            </Button>
            <Button variant="secondary" onClick={signOut} className="w-full">
              <LogOut size={16} />
              Sair da conta
            </Button>
          </div>
        </PanelSection>
      </Panel>
    </div>
  );
}
