import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Toast } from './useToasts';

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-container shadow-panel text-sm font-semibold max-w-xs pointer-events-auto ${
          t.type === 'success' ? 'bg-emerald-600 text-white' : t.type === 'error' ? 'bg-red-600 text-white' : 'bg-surface-2 text-fg border border-edge'}`}>
          {t.type === 'success' ? <CheckCircle2 size={15} /> : t.type === 'error' ? <AlertCircle size={15} /> : null}
          {t.message}
        </div>
      ))}
    </div>
  );
}
