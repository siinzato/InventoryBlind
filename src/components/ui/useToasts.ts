import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';
export interface ToastItem { id: number; message: string; type: ToastType }

let _tid = 0;

/** Fila de toasts efêmeros — extraído de pdfCenter/useToasts.tsx, que já era
 *  reaproveitado por BarcodeLabPage/LabelGeneratorPage/SpreadsheetComparatorPage/
 *  PalletCalcPage por cópia manual. Um único lugar em vez de 6 cópias quase
 *  idênticas (§24). Renderização em Toast.tsx (ToastStack). */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_tid;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  return { toasts, toast };
}
