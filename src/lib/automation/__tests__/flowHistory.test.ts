import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, historyFlush, historyRedo, historySet, historyUndo, initHistory } from '../flowHistory';

describe('flowHistory', () => {
  it('começa sem nada para desfazer ou refazer', () => {
    const state = initHistory('a');
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);
    expect(state.present).toBe('a');
  });

  it('set() atualiza o presente sem empilhar antes do flush', () => {
    const state = historySet(initHistory('a'), 'b');
    expect(state.present).toBe('b');
    expect(state.past).toHaveLength(0);
    expect(canUndo(state)).toBe(true); // pendente já conta como "algo para desfazer"
  });

  it('várias chamadas de set() antes do flush colapsam em UM ponto de desfazer', () => {
    let state = initHistory('a');
    state = historySet(state, 'b');
    state = historySet(state, 'c');
    state = historySet(state, 'd');
    state = historyFlush(state);

    expect(state.present).toBe('d');
    expect(state.past).toEqual(['a']); // não ['a','b','c'] — a rajada é um passo só
  });

  it('flush() sem nada pendente não empilha nada', () => {
    const state = historyFlush(initHistory('a'));
    expect(state.past).toHaveLength(0);
  });

  it('undo() restaura o valor anterior e move o atual para o futuro', () => {
    let state = initHistory('a');
    state = historyFlush(historySet(state, 'b'));
    state = historyUndo(state);

    expect(state.present).toBe('a');
    expect(state.future).toEqual(['b']);
    expect(canRedo(state)).toBe(true);
  });

  it('undo() funciona mesmo com uma rajada ainda não fechada por flush', () => {
    let state = initHistory('a');
    state = historySet(state, 'b'); // sem flush — simula o timer ainda não ter disparado
    state = historyUndo(state);

    expect(state.present).toBe('a');
  });

  it('undo() sem histórico não faz nada', () => {
    const state = historyUndo(initHistory('a'));
    expect(state.present).toBe('a');
    expect(canUndo(state)).toBe(false);
  });

  it('redo() reaplica o que foi desfeito', () => {
    let state = initHistory('a');
    state = historyFlush(historySet(state, 'b'));
    state = historyUndo(state);
    state = historyRedo(state);

    expect(state.present).toBe('b');
    expect(canRedo(state)).toBe(false);
  });

  it('uma mudança nova depois de um undo descarta o futuro (redo não reaparece)', () => {
    let state = initHistory('a');
    state = historyFlush(historySet(state, 'b'));
    state = historyUndo(state); // presente=a, futuro=[b]
    state = historyFlush(historySet(state, 'c')); // ramifica a partir de 'a'

    expect(state.present).toBe('c');
    expect(canRedo(state)).toBe(false);
  });

  it('redo() sem futuro não faz nada', () => {
    const state = historyRedo(initHistory('a'));
    expect(state.present).toBe('a');
  });

  it('sequência longa: múltiplos undo/redo preservam a ordem', () => {
    let state = initHistory(0);
    for (const value of [1, 2, 3]) {
      state = historyFlush(historySet(state, value));
    }
    expect(state.present).toBe(3);

    state = historyUndo(state);
    state = historyUndo(state);
    expect(state.present).toBe(1);

    state = historyRedo(state);
    expect(state.present).toBe(2);
  });
});
