import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, Button } from '../ui';
import { createPDIPlan } from '../../lib/pdiService';

interface PDIManagerModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  creatorUserId: string;
  creatorEmail: string;
  employeeUserId: string;
  employeeName: string;
  onCreated: () => void;
}

export function PDIManagerModal({ open, onClose, companyId, creatorUserId, creatorEmail, employeeUserId, employeeName, onCreated }: PDIManagerModalProps) {
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  const updateStep = (i: number, value: string) => setSteps(s => s.map((v, idx) => (idx === i ? value : v)));
  const addStep = () => setSteps(s => [...s, '']);
  const removeStep = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!goalTitle.trim()) return;
    setSaving(true);
    await createPDIPlan(
      companyId, creatorUserId, creatorEmail, employeeUserId, goalTitle.trim(), goalDescription.trim(),
      steps.filter(s => s.trim()).map(s => ({ title: s.trim() }))
    );
    setSaving(false);
    setGoalTitle('');
    setGoalDescription('');
    setSteps(['']);
    onCreated();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`PDI — ${employeeName}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Objetivo</label>
          <input
            value={goalTitle}
            onChange={e => setGoalTitle(e.target.value)}
            placeholder="Ex: Tornar-se Líder Operacional"
            className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Descrição (opcional)</label>
          <textarea
            value={goalDescription}
            onChange={e => setGoalDescription(e.target.value)}
            rows={2}
            className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Etapas</label>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={step}
                  onChange={e => updateStep(i, e.target.value)}
                  placeholder={`Etapa ${i + 1}`}
                  className="flex-1 p-2 border border-edge rounded-lg bg-surface text-sm text-fg"
                />
                {steps.length > 1 && (
                  <button onClick={() => removeStep(i)} className="text-fg-subtle hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={addStep} className="mt-2 flex items-center gap-1 text-xs font-medium text-accent">
            <Plus size={12} /> Adicionar etapa
          </button>
        </div>
        <Button onClick={handleSubmit} disabled={saving || !goalTitle.trim()} className="w-full">
          {saving ? 'Salvando...' : 'Criar Plano de Desenvolvimento'}
        </Button>
      </div>
    </Modal>
  );
}
