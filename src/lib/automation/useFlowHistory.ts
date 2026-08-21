// Hook de desfazer/refazer do editor visual — casca de React fina em torno do
// núcleo puro em flowHistory.ts (é lá que a lógica é testada).
//
// `set()` atualiza na hora mas só empilha um ponto de desfazer depois de
// `COALESCE_MS` de silêncio — sem isso, desfazer um campo de texto voltaria uma
// letra por vez. `commit()` fecha a fronteira imediatamente, chamado antes de
// qualquer ação discreta (arrastar, conectar, adicionar, remover node), para
// não misturar essa ação com uma digitação recente no mesmo passo de desfazer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { canRedo, canUndo, historyFlush, historyRedo, historySet, historyUndo, initHistory, type HistoryState } from './flowHistory';
import type { AutomationWorkflow } from './types';

const COALESCE_MS = 500;

export type WorkflowUpdater = AutomationWorkflow | ((prev: AutomationWorkflow) => AutomationWorkflow);

export interface FlowHistory {
  workflow: AutomationWorkflow;
  /** Aceita um valor OU uma função `(prev) => next` — a forma função é a
   *  correta para qualquer handler que também LEIA o workflow atual (mover,
   *  conectar, remover), porque dois handlers desses podem disparar no mesmo
   *  evento (ex.: o pointerup que solta uma conexão também encerra um drag de
   *  node) com o React ainda não tendo re-renderizado entre um e outro — os
   *  dois fechamentos (`closures`) capturariam o MESMO workflow antigo, e o
   *  segundo a aplicar apagaria o que o primeiro acabou de gravar. A forma
   *  função resolve contra o estado mais recente de verdade, não contra uma
   *  cópia capturada no momento em que o callback foi criado. */
  set: (next: WorkflowUpdater) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useFlowHistory(initial: AutomationWorkflow): FlowHistory {
  const [state, setState] = useState<HistoryState<AutomationWorkflow>>(() => initHistory(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current != null) clearTimeout(timer.current);
  }, []);

  const flush = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setState(historyFlush);
  }, []);

  const set = useCallback((next: WorkflowUpdater) => {
    setState(current => historySet(current, typeof next === 'function' ? next(current.present) : next));
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, COALESCE_MS);
  }, [flush]);

  const commit = useCallback(() => flush(), [flush]);
  const undo = useCallback(() => { flush(); setState(historyUndo); }, [flush]);
  const redo = useCallback(() => setState(historyRedo), []);

  return {
    workflow: state.present,
    set,
    commit,
    undo,
    redo,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
  };
}
