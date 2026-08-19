import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Megaphone, X } from 'lucide-react';
import { Badge } from './ui';
import {
  WHATS_NEW_ENTRIES, WHATS_NEW_CATEGORY_LABEL,
  getLastSeenWhatsNewId, markWhatsNewSeen, hasUnseenWhatsNew,
} from '../lib/whatsNew';

const CATEGORY_BADGE_VARIANT: Record<string, 'accent' | 'neutral'> = {
  novidade: 'accent',
  melhoria: 'neutral',
  correcao: 'neutral',
};

/** Botão "Novidades" do header autenticado + painel lateral direito. Mesma linguagem visual
 *  do Modal (backdrop + z-modal), mas ancorado à direita em vez de centralizado. Fecha por
 *  botão, Escape ou clique no backdrop — nenhum estado global novo, só localStorage
 *  (ver src/lib/whatsNew.ts) para lembrar a última novidade já vista neste dispositivo. */
export function WhatsNewButton() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    setUnseen(hasUnseenWhatsNew());
  }, []);

  useEffect(() => {
    if (!open) return;
    const latest = WHATS_NEW_ENTRIES[0]?.id;
    if (latest && getLastSeenWhatsNewId() !== latest) {
      markWhatsNewSeen(latest);
      setUnseen(false);
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Novidades"
        title="Novidades"
        className="relative w-8 h-8 rounded-control flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors"
      >
        <Megaphone size={16} />
        {unseen && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-surface-2" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 m-0" style={{ zIndex: 'var(--z-modal)' }}>
            <motion.div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              style={{ zIndex: 'var(--z-modal-backdrop)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              style={{ zIndex: 'var(--z-modal)' }}
              className="absolute right-0 top-0 h-full w-full max-w-md bg-surface border-l border-edge shadow-overlay flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-edge flex-shrink-0">
                <h2 className="text-base font-semibold text-fg">O que há de novo no InventoryBlind?</h2>
                <button onClick={() => setOpen(false)} className="text-fg-subtle hover:text-fg transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {WHATS_NEW_ENTRIES.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-12">
                    <Megaphone size={28} className="text-fg-subtle" />
                    <p className="text-sm font-medium text-fg">Nenhuma novidade publicada ainda</p>
                    <p className="text-xs text-fg-subtle max-w-[26ch]">
                      Assim que lançarmos algo novo, você verá aqui primeiro.
                    </p>
                  </div>
                ) : (
                  WHATS_NEW_ENTRIES.map(entry => (
                    <div key={entry.id} className="space-y-1.5 pb-5 border-b border-edge last:border-b-0 last:pb-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={CATEGORY_BADGE_VARIANT[entry.category]}>
                          {WHATS_NEW_CATEGORY_LABEL[entry.category]}
                        </Badge>
                        <span className="text-xs text-fg-subtle">
                          {new Date(entry.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-fg">{entry.title}</p>
                      <p className="text-sm text-fg-muted">{entry.description}</p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
