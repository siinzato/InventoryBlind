import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, Plus, GraduationCap, Boxes, Plug, Server, Database, HelpCircle, Workflow,
  Package, Tag, User, Lock, Activity,
} from 'lucide-react';
import { Sidebar, type SidebarNavGroup } from './components/ui/Sidebar';
import './index.css';

function App() {
  const [active] = useState('integracoes');

  const groups: SidebarNavGroup[] = [
    { id: 'dashboard-group', label: 'Dashboard', sectionLabel: 'Visão Geral', railSection: true, items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard />, onClick: () => {}, active: false },
    ]},
    { id: 'counting-group', label: 'Operações', sectionLabel: 'Operação Inteligente', railSection: true, items: [
      { id: 'input', label: 'Nova Contagem', icon: <Plus />, onClick: () => {}, active: false },
    ]},
    { id: 'analytics-group', label: 'Analytics', items: [
      { id: 'a1', label: 'BlindScore', icon: <Activity />, onClick: () => {}, active: false },
    ]},
    { id: 'automacoes-group', label: 'Automações', items: [
      { id: 'automacoes', label: 'Agentes e Automações', icon: <Workflow />, onClick: () => {}, active: false },
    ]},
    { id: 'products-group', label: 'Produtos', items: [
      { id: 'products', label: 'Produtos Importados', icon: <Package />, onClick: () => {}, active: false },
    ]},
    { id: 'tools-group', label: 'Ferramentas', items: [
      { id: 'tools', label: 'Gerador de Etiquetas', icon: <Tag />, onClick: () => {}, active: false },
    ]},
    { id: 'academy-group', label: 'I.B Academy', sectionLabel: 'Aprendizado e Gestão', railSection: true, items: [
      { id: 'academy', label: 'I.B Academy', icon: <GraduationCap />, onClick: () => {}, active: false },
    ]},
    { id: 'account-group', label: 'Minha Conta', items: [
      { id: 'conta', label: 'Produtividade', icon: <User />, onClick: () => {}, active: false },
    ]},
    { id: 'admin-group', label: 'Administração', items: [
      { id: 'admin', label: 'Acesso Administrativo', icon: <Lock />, onClick: () => {}, active: false },
    ]},
    { id: 'integracoes-group', label: 'Integrações', items: [
      { id: 'integracoes', label: 'Tiny ERP', icon: <Boxes />, onClick: () => {}, active: active === 'integracoes' },
      { id: 'integracoes-bling', label: 'Bling', icon: <Plug />, onClick: () => {}, active: false, locked: true },
      { id: 'integracoes-sap', label: 'SAP', icon: <Server />, onClick: () => {}, active: false, locked: true },
      { id: 'integracoes-totvs', label: 'TOTVS', icon: <Database />, onClick: () => {}, active: false, locked: true },
    ]},
  ];

  const header = (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-bold text-fg">InventoryBlind</span>
      </div>
      <button className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-accent text-white text-sm font-semibold rounded-lg">
        <Plus size={14} /> Nova Contagem
      </button>
    </div>
  );

  React.useEffect(() => {
    const check = () => {
      const els = [...document.querySelectorAll('p.text-overline')];
      const diag = els.map(el => {
        const cs = getComputedStyle(el);
        return {
          text: el.textContent,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          overflow: cs.overflow,
          textOverflow: cs.textOverflow,
          whiteSpace: cs.whiteSpace,
          isTruncating: el.scrollWidth > el.clientWidth,
        };
      });
      (window).__diag = diag;
      console.log('DIAG', JSON.stringify(diag, null, 2));
    };
    setTimeout(check, 200);
  }, []);

  return (
    <div className="flex" style={{ height: '100vh', width: '100vw' }}>
      <div data-app-shell className="h-full w-full bg-surface font-sans text-fg flex overflow-hidden">
        <Sidebar groups={groups} header={header} railHelp={{ icon: <HelpCircle size={17} />, label: 'Ajuda', onClick: () => {} }} />
        <div className="flex-1 bg-surface p-6 overflow-auto">
          <p className="text-fg text-sm">check console / window.__diag</p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
