import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Modal, Textarea } from '../ui';
import { MIN_ADMIN_REASON_LENGTH, validateAdminReason } from '../../lib/admin/recordAdmin';

interface AdminReasonModalProps {
  open: boolean;
  title: string;
  /** O registro em questão, para a pessoa confirmar que é o certo. */
  summary: ReactNode;
  /** O que vai acontecer, em uma ou duas frases. */
  consequence: ReactNode;
  confirmLabel: string;
  /** Texto do aceite explícito. Sem ele o botão de confirmar fica desabilitado. */
  acknowledgeLabel: string;
  variant?: 'primary' | 'danger';
  reasonPlaceholder?: string;
  onClose: () => void;
  /** Lança para mostrar o erro dentro do modal; resolve para fechar com sucesso. */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Modal de ação administrativa com justificativa obrigatória — um só para
 * arquivar, restaurar, excluir e corrigir, em qualquer módulo.
 *
 * Escape é tratado aqui, e não no `Modal` compartilhado, porque passar a fechar
 * com Escape mudaria o comportamento de todos os modais já existentes no sistema
 * — inclusive formulários longos, onde isso seria perda de trabalho digitado.
 */
export function AdminReasonModal({
  open,
  title,
  summary,
  consequence,
  confirmLabel,
  acknowledgeLabel,
  variant = 'danger',
  reasonPlaceholder,
  onClose,
  onConfirm,
}: AdminReasonModalProps) {
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    setReason('');
    setAcknowledged(false);
    setSubmitted(false);
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Durante o envio, fechar deixaria a pessoa sem saber se a operação foi.
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const reasonError = validateAdminReason(reason);
  // Só mostra o erro depois da primeira tentativa: a mensagem não aparece
  // enquanto a pessoa ainda está digitando o primeiro caractere.
  const showReasonError = submitted && reasonError != null;

  const handleConfirm = async () => {
    if (busy) return;
    setSubmitted(true);
    if (reasonError != null || !acknowledged) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="space-y-4">
        {summary}

        <p className="text-sm text-fg-muted">{consequence}</p>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-reason`} className="block text-xs font-semibold text-fg-muted">
            Justificativa (obrigatória, mínimo de {MIN_ADMIN_REASON_LENGTH} caracteres)
          </label>
          <Textarea
            id={`${fieldId}-reason`}
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            required
            aria-invalid={showReasonError}
            aria-describedby={showReasonError ? `${fieldId}-reason-error` : undefined}
            placeholder={reasonPlaceholder}
          />
          <div aria-live="polite">
            {showReasonError && (
              <p id={`${fieldId}-reason-error`} className="text-sm text-red-600 dark:text-red-400">
                {reasonError}
              </p>
            )}
          </div>
        </div>

        <label className="flex min-h-[44px] items-center gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 shrink-0 rounded border-edge text-accent focus:ring-2 focus:ring-accent/40"
          />
          {acknowledgeLabel}
        </label>

        <div aria-live="polite">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={busy || !acknowledged}>
            {busy ? 'Processando…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Grade de rótulo/valor usada nos resumos dos modais — mesma aparência em todos
 *  os módulos, para o resumo do registro nunca virar improviso por tela. */
export function AdminRecordSummary({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-sheet border border-edge bg-surface-3 p-4 text-sm sm:grid-cols-2">
      {fields.map(field => (
        <div key={field.label}>
          <dt className="text-xs font-semibold text-fg-muted">{field.label}</dt>
          <dd className="text-fg">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}
