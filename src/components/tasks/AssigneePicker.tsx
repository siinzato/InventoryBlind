import React from 'react';
import { Check } from 'lucide-react';
import { TeamMember } from '../../lib/tasks/types';
import { getRoleLabel } from '../../lib/permissionService';

interface AssigneePickerProps {
  members: TeamMember[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Só usuários da própria empresa aparecem aqui — `members` já vem filtrado por company_id no serviço. */
export const AssigneePicker: React.FC<AssigneePickerProps> = ({ members, selected, onChange }) => {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  return (
    <div className="border border-edge rounded-lg max-h-48 overflow-y-auto divide-y divide-edge">
      {members.length === 0 ? (
        <p className="text-xs text-fg-subtle p-3">Nenhum usuário encontrado na empresa.</p>
      ) : members.map(m => {
        const isSelected = selected.includes(m.id);
        return (
          <button key={m.id} type="button" onClick={() => toggle(m.id)}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-3'}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg truncate">{m.name || m.email || 'Sem nome'}</p>
              <p className="text-xs text-fg-subtle">{getRoleLabel(m.role)}</p>
            </div>
            <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${isSelected ? 'bg-accent border-accent text-white' : 'border-edge'}`}>
              {isSelected && <Check size={12} />}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default AssigneePicker;
