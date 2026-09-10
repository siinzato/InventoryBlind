import type { ReactNode } from 'react';

export type NoticeTone = 'danger' | 'warning' | 'success' | 'neutral';

const NOTICE_TONE: Record<NoticeTone, string> = {
  danger: 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400',
  warning: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  neutral: 'border-edge bg-surface-3 text-fg-muted',
};

/** Mensagem inline — texto direto, borda fina, fundo quase neutro. Nunca um
 *  balão colorido: a cor é pontual (borda + texto), nunca um preenchimento
 *  saturado (§7). Extraído de IntegrationsPage.tsx, que já implementava isso
 *  corretamente, mas era reimplementado localmente (com pequenas variações de
 *  opacidade/padding) em vários outros arquivos (§24). */
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <div className={`rounded-container border px-4 py-3 text-sm leading-relaxed ${NOTICE_TONE[tone]}`}>
      {children}
    </div>
  );
}
