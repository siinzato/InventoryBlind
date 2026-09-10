import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleGroupProps {
  title: string;
  count: number;
  tone?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Agrupamento recolhível reaproveitado por Meu Dia (Em execução/Atrasadas/
 *  Hoje/Próximas/Bloqueadas/Sem prazo) — grupo vazio não renderiza nada. */
export const CollapsibleGroup: React.FC<CollapsibleGroupProps> = ({ title, count, tone, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="bg-surface-2 rounded-xl border border-edge">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-1.5 p-3.5 text-left">
        {open ? <ChevronDown size={14} className="text-fg-subtle flex-shrink-0" /> : <ChevronRight size={14} className="text-fg-subtle flex-shrink-0" />}
        <span className={`font-bold text-sm ${tone ?? 'text-fg'}`}>{title}</span>
        <span className="text-fg-subtle text-sm font-normal">({count})</span>
      </button>
      {open && <div className="px-3.5 pb-3.5 space-y-1.5">{children}</div>}
    </div>
  );
};

export default CollapsibleGroup;
