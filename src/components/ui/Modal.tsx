import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}

/** Shell only (backdrop + panel + optional header) — form/content logic stays in the caller. */
export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div
          // `m-0`: o overlay é filho direto de quem o renderiza, então um `space-y-*`
          // no container (o caso de Page) lhe daria margin-top e deslocaria o
          // `inset-0` para baixo, deixando uma faixa do topo fora do backdrop.
          // Os insets somam ao `p-4` existente: o overlay é `inset-0`, então em iPhone o
          // painel podia encostar na barra de status e no home indicator, deixando o
          // botão de fechar e as ações do rodapé fora de alcance. No desktop resolve
          // para o mesmo `p-4` de antes.
          className="fixed inset-0 m-0 flex items-center justify-center p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))]"
          style={{ zIndex: 'var(--z-modal)' }}
        >
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            style={{ zIndex: 'var(--z-modal-backdrop)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2 }}
            // Painel acima do backdrop pela mesma escala de tokens que o backdrop usa.
            // Um `z-10` do Tailwind aqui perde para o --z-modal-backdrop (3000) do
            // backdrop, que é irmão no MESMO contexto de empilhamento: o painel ficava
            // desenhado por baixo do véu e todo clique caía no backdrop, que fecha.
            style={{ zIndex: 'var(--z-modal)' }}
            // `min(90vh,100%)`: 90vh sozinho ignora o padding de área segura do overlay,
            // e num iPhone o painel voltava a passar por baixo da barra de status. O
            // `100%` é a altura já descontada dos insets. No desktop 90vh continua sendo
            // o menor dos dois, então a aparência é idêntica.
            className={`relative w-full ${maxWidth} rounded-sheet border border-edge bg-surface shadow-overlay max-h-[min(90vh,100%)] overflow-y-auto`}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
                <h2 className="text-base font-semibold text-fg">{title}</h2>
                <button onClick={onClose} className="text-fg-subtle hover:text-fg transition-colors">
                  <X size={18} />
                </button>
              </div>
            )}
            <div className="p-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
