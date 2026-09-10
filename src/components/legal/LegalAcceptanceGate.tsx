import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui';
import { LEGAL_CONFIG, PRIVACY_VERSION, TERMS_VERSION, formatEffectiveDate } from '../../config/legal';
import { LEGAL_ROUTES } from '../../lib/legal/legalRoutes';
import { needsAcceptance } from '../../lib/legal/legalAcceptance';
import { loadAcceptanceState, recordAcceptance } from '../../lib/legal/legalService';

/**
 * Pedido de aceite para quem já usava o sistema antes destes documentos
 * existirem, e para quando uma versão nova é publicada.
 *
 * Regras que valem a pena registrar:
 *
 * - NÃO cria aceite retroativo. Ausência de registro significa que a pessoa
 *   nunca aceitou, e é isso que a tela pede.
 * - Se a verificação FALHAR (tabela ainda não criada, rede fora), o sistema é
 *   liberado normalmente. Um erro de infraestrutura no aceite não pode prender
 *   ninguém numa tela cujo botão também vai falhar. O pedido volta na próxima
 *   sessão.
 * - Se o REGISTRO falhar, o erro aparece e o botão continua disponível para
 *   tentar de novo — a RPC é idempotente, então repetir não duplica.
 * - Enquanto verifica, nada é renderizado: um flash do aviso a cada carregamento
 *   para quem já aceitou seria pior do que esperar alguns instantes.
 */
export function LegalAcceptanceGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'blocked' | 'released'>('checking');
  const [saving, setSaving] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const result = await loadAcceptanceState();
    if (result.status === 'unavailable') {
      setState('released');
      return;
    }
    setState(needsAcceptance(result.latest) ? 'blocked' : 'released');
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state === 'checking') return null;
  if (state === 'released') return <>{children}</>;

  const handleAccept = async () => {
    setSubmitted(true);
    if (!accepted || saving) return;
    setSaving(true);
    setError(null);
    try {
      await recordAcceptance();
      setState('released');
    } catch (err) {
      setError(
        err instanceof Error
          ? `Não foi possível registrar seu aceite: ${err.message}`
          : 'Não foi possível registrar seu aceite. Tente novamente.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-gate-title"
      className="fixed inset-0 flex items-center justify-center bg-surface p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
      style={{ zIndex: 'var(--z-modal)' }}
    >
      <div className="w-full max-w-lg overflow-y-auto rounded-sheet border border-edge bg-surface-2 p-6 shadow-overlay max-h-[min(90vh,100%)]">
        <h2 id="legal-gate-title" className="text-lg font-semibold text-fg">
          Termos e Privacidade
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          Publicamos os Termos de Uso e a Política de Privacidade do {LEGAL_CONFIG.productName}. Para
          continuar, precisamos do seu aceite.
        </p>

        <dl className="mt-4 space-y-1 text-xs text-fg-subtle">
          <div>
            <dt className="inline">Termos de Uso: </dt>
            <dd className="inline">
              versão {TERMS_VERSION.version}, de {formatEffectiveDate(TERMS_VERSION.effectiveDate)}
            </dd>
          </div>
          <div>
            <dt className="inline">Política de Privacidade: </dt>
            <dd className="inline">
              versão {PRIVACY_VERSION.version}, de {formatEffectiveDate(PRIVACY_VERSION.effectiveDate)}
            </dd>
          </div>
        </dl>

        <label className="mt-5 flex min-h-[44px] items-start gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            disabled={saving}
            aria-invalid={submitted && !accepted}
            aria-describedby={submitted && !accepted ? 'legal-gate-error' : undefined}
            className="mt-1 h-4 w-4 shrink-0 rounded border-edge text-accent focus:ring-2 focus:ring-accent/40"
          />
          <span>
            Li e aceito os{' '}
            <a
              href={LEGAL_ROUTES.terms}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline"
            >
              Termos de Uso
            </a>{' '}
            e declaro que tive acesso à{' '}
            <a
              href={LEGAL_ROUTES.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline"
            >
              Política de Privacidade
            </a>
            .
          </span>
        </label>

        <div aria-live="polite" className="mt-2">
          {submitted && !accepted && (
            <p id="legal-gate-error" className="text-sm text-red-600 dark:text-red-400">
              É necessário aceitar os Termos de Uso para continuar.
            </p>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={handleAccept} disabled={saving}>
            {saving ? 'Registrando…' : 'Aceitar e continuar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
