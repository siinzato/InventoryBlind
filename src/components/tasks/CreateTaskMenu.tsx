import React, { useState } from 'react';
import { Plus, User, Users } from 'lucide-react';
import { Role } from '../../lib/permissionService';
import { canCreateCorporateTask } from '../../lib/tasks/taskDomain';

interface CreateTaskMenuProps {
  role: Role | string | undefined;
  onCreatePersonal: () => void;
  onCreateCorporate: () => void;
}

/**
 * Um único botão "+ Nova tarefa" (era "Nova tarefa" + "Nova tarefa pessoal"
 * competindo visualmente). As opções mudam por permissão — quem não tem
 * tasks.manage nunca vê "Tarefa corporativa" aqui, e a RPC de criação
 * recusa a chamada mesmo que alguém tente direto pela API (task_create em
 * 070_task_management.sql). "Criar usando modelo" e "Tarefa recorrente"
 * chegam nas etapas 3 e 6 — não estão aqui ainda por não existir a tela/
 * infraestrutura por trás (nada de opção decorativa que não faz nada).
 */
export const CreateTaskMenu: React.FC<CreateTaskMenuProps> = ({ role, onCreatePersonal, onCreateCorporate }) => {
  const [open, setOpen] = useState(false);
  const canCorporate = canCreateCorporateTask(role);

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-strong text-white rounded-lg text-sm font-semibold transition">
        <Plus size={16} />Nova tarefa
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-surface border border-edge rounded-lg shadow-panel py-1">
            <button onClick={() => { onCreatePersonal(); setOpen(false); }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-3 flex items-center gap-2 text-fg">
              <User size={14} className="text-fg-subtle" />Tarefa pessoal
            </button>
            {canCorporate && (
              <button onClick={() => { onCreateCorporate(); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-3 flex items-center gap-2 text-fg">
                <Users size={14} className="text-fg-subtle" />Tarefa corporativa
                <span className="text-xs text-fg-subtle">(um ou mais colaboradores)</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CreateTaskMenu;
