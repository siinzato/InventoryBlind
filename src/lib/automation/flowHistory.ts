// Núcleo puro do desfazer/refazer — sem React, sem timer.
//
// Extraído do hook (useFlowHistory.ts) de propósito: o projeto não tem
// @testing-library/react nem jsdom (ver o comentário em
// physicalCountAdmin.test.ts §6 — decisão já tomada de não trazer as duas coisas
// só para testar hook/componente), então a lógica que precisa de cobertura de
// teste fica aqui, como funções puras sobre um estado simples, e o hook por
// cima é fino o bastante para não precisar de teste próprio.

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  /** Valor de antes da rajada de mudanças em andamento — só existe entre um
   *  `set()` e o próximo `flush()`. Nulo significa "nada pendente para
   *  empilhar". */
  pendingBase: T | null;
}

export function initHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [], pendingBase: null };
}

/** Atualiza o presente. NÃO empilha um ponto de desfazer — isso é `flush()`. */
export function historySet<T>(state: HistoryState<T>, next: T): HistoryState<T> {
  return { ...state, present: next, pendingBase: state.pendingBase ?? state.present };
}

/** Fecha a fronteira de desfazer no que estava pendente. Chamado tanto pelo
 *  timer de inatividade quanto por uma ação discreta (arrastar, conectar). */
export function historyFlush<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.pendingBase == null) return state;
  return { past: [...state.past, state.pendingBase], present: state.present, future: [], pendingBase: null };
}

export function historyUndo<T>(state: HistoryState<T>): HistoryState<T> {
  const flushed = historyFlush(state);
  if (flushed.past.length === 0) return flushed;

  const previous = flushed.past[flushed.past.length - 1];
  return {
    past: flushed.past.slice(0, -1),
    present: previous,
    future: [flushed.present, ...flushed.future],
    pendingBase: null,
  };
}

export function historyRedo<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state;

  const [next, ...rest] = state.future;
  return { past: [...state.past, state.present], present: next, future: rest, pendingBase: null };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0 || state.pendingBase != null;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
