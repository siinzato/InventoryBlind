import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Modal, Button } from '../ui';
import { IncentiveType, AchievementLevel } from '../../lib/supabase';
import { sendEmployeeIncentive } from '../../lib/employeeIncentiveService';
import { renderIncentiveTemplate } from '../../lib/emailService';
import { suggestReward, highestUnlockedLevel } from '../../lib/rewardSuggestionService';

interface EmployeeIncentiveModalProps {
  employeeUserId: string;
  employeeName: string;
  employeeEmail: string | null;
  companyId: string;
  currentUserId: string;
  currentUserEmail: string;
  unlockedLevels: AchievementLevel[];
  onClose: () => void;
}

const TYPE_LABEL: Record<IncentiveType, string> = {
  parabens: 'Parabéns', agradecimento: 'Agradecimento', meta_atingida: 'Meta Atingida',
  destaque: 'Destaque', evolucao: 'Evolução', precisao: 'Precisão',
  full_manager: 'Full Manager', inventario: 'Inventário', personalizado: 'Personalizado',
};

const inputClass = 'w-full p-2.5 border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/40 text-fg bg-surface text-sm';
const labelClass = 'block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1';

export function EmployeeIncentiveModal({
  employeeUserId, employeeName, employeeEmail, companyId, currentUserId, currentUserEmail, unlockedLevels, onClose,
}: EmployeeIncentiveModalProps) {
  const [type, setType] = useState<IncentiveType>('parabens');
  const [subject, setSubject] = useState(`Reconhecimento para ${employeeName}`);
  const [message, setMessage] = useState('');
  const bestLevel = useMemo(() => highestUnlockedLevel(unlockedLevels), [unlockedLevels]);
  const rewardOptions = bestLevel ? suggestReward(bestLevel) : suggestReward('bronze');
  const [rewardSuggestion, setRewardSuggestion] = useState(rewardOptions[0] ?? '');
  const [ccManager, setCcManager] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const preview = renderIncentiveTemplate({
    employeeName, employeeEmail, type, subject, message, rewardSuggestion,
  });

  const handleSend = async () => {
    setSending(true);
    const result = await sendEmployeeIncentive({
      companyId, sentByUserId: currentUserId, sentByEmail: currentUserEmail,
      employeeUserId, employeeName, employeeEmail,
      type, subject, message, rewardSuggestion, ccManager,
    });
    setSending(false);
    if (result) setSent(result.status === 'simulated' ? 'Envio simulado registrado — integração real de e-mail pode ser configurada depois.' : 'Incentivo enviado.');
  };

  return (
    <Modal open onClose={onClose} title={`Enviar Incentivo — ${employeeName}`} maxWidth="max-w-lg">
      <div className="space-y-4">
        {sent && (
          <div className="p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg text-sm">{sent}</div>
        )}

        <div>
          <label className={labelClass}>Tipo</label>
          <select value={type} onChange={e => setType(e.target.value as IncentiveType)} className={inputClass}>
            {(Object.keys(TYPE_LABEL) as IncentiveType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </div>

        <div>
          <label className={labelClass}>Assunto</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Mensagem</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} className={inputClass} placeholder="Escreva uma mensagem personalizada..." />
        </div>

        <div>
          <label className={labelClass}>Sugestão de Prêmio</label>
          <select value={rewardSuggestion} onChange={e => setRewardSuggestion(e.target.value)} className={inputClass}>
            {rewardOptions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={ccManager} onChange={e => setCcManager(e.target.checked)} />
          Enviar cópia ao gestor
        </label>

        <div className="rounded-lg border border-edge bg-surface-3/40 p-3 text-xs text-fg-muted whitespace-pre-line">
          {preview}
        </div>

        <Button className="w-full" disabled={sending} onClick={handleSend}>
          <Send size={16} /> {sending ? 'Enviando...' : 'Enviar Incentivo'}
        </Button>
      </div>
    </Modal>
  );
}
