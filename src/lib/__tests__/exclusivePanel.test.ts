import { describe, expect, it, vi } from 'vitest';
import { notifyPanelOpened, registerExclusivePanel } from '../exclusivePanel';

describe('exclusivePanel — sino de tarefas e comunicados gerais nunca ficam abertos juntos', () => {
  it('abrir um painel fecha os outros registrados', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const unregisterA = registerExclusivePanel('a', closeA);
    const unregisterB = registerExclusivePanel('b', closeB);

    notifyPanelOpened('a');

    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledTimes(1);

    unregisterA();
    unregisterB();
  });

  it('painel desregistrado não é mais notificado', () => {
    const close = vi.fn();
    const unregister = registerExclusivePanel('x', close);
    unregister();

    notifyPanelOpened('y');

    expect(close).not.toHaveBeenCalled();
  });

  it('abrir o próprio painel de novo não fecha a si mesmo', () => {
    const close = vi.fn();
    const unregister = registerExclusivePanel('same', close);

    notifyPanelOpened('same');

    expect(close).not.toHaveBeenCalled();
    unregister();
  });
});
