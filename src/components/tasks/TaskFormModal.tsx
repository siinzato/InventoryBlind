import React, { useEffect, useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Modal, Button } from '../ui';
import { Role } from '../../lib/permissionService';
import { Task, TaskType, TaskPriority, TeamMember, TASK_PRIORITIES, TASK_CATEGORY_SUGGESTIONS } from '../../lib/tasks/types';
import { canCreateCorporateTask } from '../../lib/tasks/taskDomain';
import { createTask, updateTask, TaskServiceError } from '../../lib/tasks/taskService';
import { AssigneePicker } from './AssigneePicker';

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  role: Role | string | undefined;
  teamMembers: TeamMember[];
  editingTask?: Task | null;
  editingAssigneeIds?: string[];
  forcedType?: TaskType;
}

const inputClass = 'w-full px-3 py-2.5 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40';
const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase mb-1.5';

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  open, onClose, onSaved, role, teamMembers, editingTask, editingAssigneeIds, forcedType,
}) => {
  const isEditing = !!editingTask;
  const canCorporate = canCreateCorporateTask(role);

  const [type, setType] = useState<TaskType>(forcedType ?? (canCorporate ? 'corporate' : 'personal'));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingTask) {
      setType(editingTask.type);
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? '');
      setCategory(editingTask.category ?? '');
      setPriority(editingTask.priority);
      setDueDate(editingTask.due_date ?? '');
      setDueTime(editingTask.due_time?.slice(0, 5) ?? '');
      setAssigneeIds(editingAssigneeIds ?? []);
      setChecklist([]);
    } else {
      setType(forcedType ?? (canCorporate ? 'corporate' : 'personal'));
      setTitle(''); setDescription(''); setCategory(''); setPriority('medium');
      setDueDate(''); setDueTime(''); setAssigneeIds([]); setChecklist([]);
    }
    setError(null);
  }, [open, editingTask, editingAssigneeIds, forcedType, canCorporate]);

  const addChecklistItem = () => {
    if (!newChecklistItem.trim()) return;
    setChecklist(c => [...c, newChecklistItem.trim()]);
    setNewChecklistItem('');
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Informe um título.'); return; }
    if (type === 'corporate' && assigneeIds.length === 0) { setError('Selecione ao menos um responsável.'); return; }

    setSaving(true);
    setError(null);
    try {
      if (isEditing && editingTask) {
        await updateTask(editingTask.id, {
          title: title.trim(), description: description.trim() || null, category: category.trim() || null,
          priority, due_date: dueDate || null, due_time: dueTime || null,
          assigneeIds: editingTask.type === 'corporate' ? assigneeIds : undefined,
        });
      } else {
        await createTask({
          type, title: title.trim(), description: description.trim() || null, category: category.trim() || null,
          priority, due_date: dueDate || null, due_time: dueTime || null,
          assigneeIds, checklist,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof TaskServiceError ? err.message : 'Não foi possível salvar a tarefa.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? 'Editar tarefa' : 'Nova tarefa'} maxWidth="max-w-xl">
      <div className="space-y-4">
        {!isEditing && canCorporate && !forcedType && (
          <div className="flex gap-2">
            {(['personal', 'corporate'] as TaskType[]).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${type === t ? 'bg-accent text-white border-accent' : 'bg-surface text-fg-muted border-edge hover:bg-surface-3'}`}>
                {t === 'personal' ? 'Pessoal' : 'Corporativa'}
              </button>
            ))}
          </div>
        )}

        <div>
          <label className={labelClass}>Título</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="O que precisa ser feito?" autoFocus />
        </div>

        <div>
          <label className={labelClass}>Descrição</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${inputClass} resize-none`} placeholder="Detalhes (opcional)" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Categoria</label>
            <input value={category} onChange={e => setCategory(e.target.value)} list="task-category-suggestions" className={inputClass} placeholder="Escolha ou digite..." />
            <datalist id="task-category-suggestions">
              {TASK_CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className={labelClass}>Prioridade</label>
            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className={inputClass}>
              {TASK_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Data</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Horário</label>
            <input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} className={inputClass} />
          </div>
        </div>

        {type === 'corporate' && (
          <div>
            <label className={labelClass}>Responsáveis</label>
            <AssigneePicker members={teamMembers} selected={assigneeIds} onChange={setAssigneeIds} />
            {isEditing && <p className="text-xs text-fg-subtle mt-1">Alterar aqui reatribui a tarefa — os responsáveis removidos perdem acesso.</p>}
          </div>
        )}

        {!isEditing && (
          <div>
            <label className={labelClass}>Checklist</label>
            <div className="space-y-1.5 mb-2">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface-3 rounded-lg text-sm">
                  <span className="text-fg truncate">{item}</span>
                  <button onClick={() => setChecklist(c => c.filter((_, idx) => idx !== i))} className="text-fg-subtle hover:text-red-600 dark:hover:text-red-400 flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newChecklistItem} onChange={e => setNewChecklistItem(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())}
                className={inputClass} placeholder="Adicionar item..." />
              <Button variant="secondary" size="sm" onClick={addChecklistItem}><Plus size={14} /></Button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
            <AlertTriangle size={16} className="flex-shrink-0" />{error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </div>
    </Modal>
  );
};

export default TaskFormModal;
