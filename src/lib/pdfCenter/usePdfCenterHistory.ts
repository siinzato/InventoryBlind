// Hook de desfazer/refazer do editor — casca fina em torno do MESMO núcleo
// puro do editor de automações (src/lib/automation/flowHistory.ts), que já é
// genérico o bastante pra servir aqui sem duplicar a lógica (testada lá).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canRedo, canUndo, historyFlush, historyRedo, historySet, historyUndo, initHistory, type HistoryState,
} from '../automation/flowHistory';
import type { PdfCenterPage } from './types';

const COALESCE_MS = 400;

export type PagesUpdater = PdfCenterPage[] | ((prev: PdfCenterPage[]) => PdfCenterPage[]);

export interface PdfCenterHistory {
  pages: PdfCenterPage[];
  set: (next: PagesUpdater) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Substitui o histórico inteiro (novo arquivo carregado) sem virar um
   *  passo de desfazer — evita "desfazer" voltar para um documento anterior
   *  que o usuário já nem tem mais aberto. */
  reset: (pages: PdfCenterPage[]) => void;
}

export function usePdfCenterHistory(initial: PdfCenterPage[]): PdfCenterHistory {
  const [state, setState] = useState<HistoryState<PdfCenterPage[]>>(() => initHistory(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current); }, []);

  const flush = useCallback(() => {
    if (timer.current != null) { clearTimeout(timer.current); timer.current = null; }
    setState(historyFlush);
  }, []);

  const set = useCallback((next: PagesUpdater) => {
    setState(current => historySet(current, typeof next === 'function' ? next(current.present) : next));
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, COALESCE_MS);
  }, [flush]);

  const commit = useCallback(() => flush(), [flush]);
  const undo = useCallback(() => { flush(); setState(historyUndo); }, [flush]);
  const redo = useCallback(() => setState(historyRedo), []);
  const reset = useCallback((pages: PdfCenterPage[]) => setState(initHistory(pages)), []);

  return {
    pages: state.present,
    set, commit, undo, redo, reset,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
  };
}
