import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ToastItem, ToastType } from './useToasts';

const TOAST_ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;

/** Borda + ícone tonal, nunca preenchimento sólido saturado — mesmo princípio
 *  do Warning Card (§7): a cor é pontual, não um balão colorido inteiro. */
const TOAST_TONE: Record<ToastType, string> = {
  success: 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
  error: 'border-red-500/30 text-red-700 dark:text-red-400',
  info: 'border-edge text-fg',
};

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      className="fixed bottom-6 right-6 flex flex-col gap-2 pointer-events-none"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      {toasts.map(t => {
        const Icon = TOAST_ICON[t.type];
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-container border bg-surface-2 shadow-panel text-sm font-medium max-w-xs pointer-events-auto ${TOAST_TONE[t.type]}`}
          >
            <Icon size={15} className="shrink-0" />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
