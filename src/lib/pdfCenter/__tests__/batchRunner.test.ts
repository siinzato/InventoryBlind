import { describe, expect, it } from 'vitest';
import { failedItems, runBatch } from '../batchRunner';

describe('runBatch', () => {
  it('uma falha isolada não interrompe o lote', async () => {
    const items = [
      { id: '1', input: 'a', label: 'a.pdf' },
      { id: '2', input: 'bad', label: 'b.pdf' },
      { id: '3', input: 'c', label: 'c.pdf' },
    ];

    const results = await runBatch(items, {
      process: async item => {
        if (item.input === 'bad') throw new Error('arquivo corrompido');
        return { outputName: `${item.label}.out`, outputBytes: new Uint8Array([1]) };
      },
    });

    expect(results.map(r => r.status)).toEqual(['done', 'error', 'done']);
    expect(results[1].error).toBe('arquivo corrompido');
    expect(results[0].outputName).toBe('a.pdf.out');
    expect(results[2].outputName).toBe('c.pdf.out');
  });

  it('reporta progresso a cada item (processing e depois done/error)', async () => {
    const progressCalls: Array<{ status: string; completed: number }> = [];
    const items = [{ id: '1', input: 'x', label: 'x' }, { id: '2', input: 'y', label: 'y' }];

    await runBatch(items, {
      process: async () => ({ outputName: 'out', outputBytes: new Uint8Array() }),
      onProgress: (result, completed) => progressCalls.push({ status: result.status, completed }),
    });

    expect(progressCalls.filter(c => c.status === 'processing')).toHaveLength(2);
    expect(progressCalls.filter(c => c.status === 'done')).toHaveLength(2);
    expect(progressCalls[progressCalls.length - 1].completed).toBe(2);
  });

  it('lote vazio não quebra', async () => {
    const results = await runBatch([], { process: async () => ({ outputName: '', outputBytes: new Uint8Array() }) });
    expect(results).toEqual([]);
  });

  it('failedItems filtra só os itens que falharam, pra permitir repetir', async () => {
    const items = [
      { id: '1', input: 'ok', label: 'a' },
      { id: '2', input: 'bad', label: 'b' },
    ];
    const results = await runBatch(items, {
      process: async item => {
        if (item.input === 'bad') throw new Error('falhou');
        return { outputName: 'ok', outputBytes: new Uint8Array() };
      },
    });

    const retry = failedItems(items, results);
    expect(retry).toEqual([items[1]]);
  });
});
