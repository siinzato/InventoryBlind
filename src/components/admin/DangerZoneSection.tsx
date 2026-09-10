// Zona de Perigo — seção recolhida e separada dos cards comuns do painel. Só owner/admin
// veem o conteúdo; a barreira de verdade é a RPC admin_reset_inventory (migration 077),
// isto só evita mostrar um botão que o banco recusaria.

import { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, Archive, Loader2 } from 'lucide-react';
import { Panel, PanelSection, Button, Textarea, Stat, StatRow, StatCell } from '../ui';
import { canAccessDangerZone, validateDangerZoneForm, RESET_CONFIRMATION_PHRASE } from '../../lib/adminSales/dangerZone';
import { resetInventoryTransactional } from '../../lib/adminSales/salesService';

interface DangerZoneSectionProps {
  role: string | null | undefined;
  totalSku: number;
  totalDone: number;
  totalDivergences: number;
  accuracy: number;
  onResetComplete: () => void;
}

export function DangerZoneSection({ role, totalSku, totalDone, totalDivergences, accuracy, onResetComplete }: DangerZoneSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(`Inventário ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!canAccessDangerZone(role)) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateDangerZoneForm({ name, reason, confirmationPhrase });
    setErrors(validation.errors);
    if (!validation.valid) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      await resetInventoryTransactional(name, notes, reason);
      setFeedback('Inventário arquivado e resetado com sucesso.');
      setReason(''); setConfirmationPhrase(''); setNotes('');
      onResetComplete();
    } catch (err) {
      setFeedback(err instanceof Error ? `Erro: ${err.message}` : 'Erro ao processar o reset.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel className="border-red-500/30">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
          <ShieldAlert size={16} /> Zona de Perigo
        </span>
        {expanded ? <ChevronDown size={16} className="text-fg-subtle" /> : <ChevronRight size={16} className="text-fg-subtle" />}
      </button>

      {expanded && (
        <PanelSection padding="md" className="border-t border-edge">
          <p className="text-sm text-red-700 dark:text-red-400 mb-4">
            Arquivar e resetar encerra o ciclo atual: o inventário inteiro (progresso, acuracidade,
            divergências, KPIs e top vendas) é salvo permanentemente no histórico, e as contagens de
            todas as marcas voltam a zero para começar um novo ciclo. Esta ação não pode ser desfeita.
          </p>

          <StatRow className="grid-cols-2 mb-4">
            <StatCell><Stat label="Total SKUs" value={totalSku} /></StatCell>
            <StatCell><Stat label="Contabilizados" value={totalDone} /></StatCell>
            <StatCell><Stat label="Divergências" value={totalDivergences} /></StatCell>
            <StatCell><Stat label="Acuracidade" value={`${accuracy.toFixed(1)}%`} /></StatCell>
          </StatRow>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Nome do inventário arquivado</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm"
              />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Observações (opcional)</label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Motivo do reset (obrigatório)</label>
              <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex: fechamento do ciclo mensal de contagem" />
              {errors.reason && <p className="text-xs text-red-600 mt-1">{errors.reason}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-fg mb-1">
                Digite <strong>{RESET_CONFIRMATION_PHRASE}</strong> para confirmar
              </label>
              <input
                type="text" value={confirmationPhrase} onChange={e => setConfirmationPhrase(e.target.value)}
                className="w-full p-2.5 border border-red-500/40 rounded-lg bg-surface text-fg text-sm"
              />
              {errors.confirmationPhrase && <p className="text-xs text-red-600 mt-1">{errors.confirmationPhrase}</p>}
            </div>

            {feedback && <p className="text-sm text-fg">{feedback}</p>}

            <Button type="submit" variant="danger" disabled={submitting} className="w-full">
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Processando...</> : <><Archive size={16} /> Confirmar Arquivamento e Reset</>}
            </Button>
          </form>
        </PanelSection>
      )}
    </Panel>
  );
}
