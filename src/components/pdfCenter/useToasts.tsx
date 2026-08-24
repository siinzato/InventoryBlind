import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';
export interface Toast { id: number; message: string; type: ToastType }

let _tid = 0;

/** Mesmo padrão de toast usado em BarcodeLabPage/LabelGeneratorPage — extraído
 *  aqui porque a Central de PDFs tem 3 telas de nível superior (editor,
 *  Converter, Lote) que precisam da mesma coisa, cada uma como página
 *  independente (sem chrome compartilhado por trás). Renderização em
 *  ToastStack.tsx. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_tid;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  return { toasts, toast };
}
