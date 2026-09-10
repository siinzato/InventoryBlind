import { describe, expect, it } from 'vitest';
import { processBatchRows, type SourcedRow } from '../batchProcessor';

const goodRow = {
  sku: 'OK1', length: '400', width: '300', height: '250', lengthUnit: 'mm',
  weight: '5', weightUnit: 'kg', quantity: '120', palletType: 'PBR', rotation: '90',
};

function sourced(row: Record<string, unknown>, n: number): SourcedRow {
  return { sourceRowNumber: n, row: row as never };
}

describe('processBatchRows', () => {
  it('uma linha inválida não interrompe o lote — as demais continuam sendo processadas', async () => {
    const rows: SourcedRow[] = [
      sourced(goodRow, 2),
      sourced({ ...goodRow, sku: 'RUIM', length: 'abc' }, 3),
      sourced(goodRow, 4),
    ];
    const summary = await processBatchRows(rows, []);
    expect(summary.total).toBe(3);
    expect(summary.invalid).toBe(1);
    expect(summary.processed + summary.processedWithAlerts).toBe(2);
    expect(summary.rows[1].status).toBe('invalid');
    expect(summary.rows[0].status).not.toBe('invalid');
    expect(summary.rows[2].status).not.toBe('invalid');
  });

  it('caixa maior que o palete vira "sem solução", não erro que trava o lote', async () => {
    const huge = { ...goodRow, sku: 'GIGANTE', length: '5000', width: '5000' };
    const summary = await processBatchRows([sourced(huge, 2)], []);
    expect(summary.noSolution).toBe(1);
    expect(summary.rows[0].status).toBe('no-solution');
  });

  it('reporta progresso durante o processamento', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => sourced(goodRow, i + 2));
    const progressCalls: Array<[number, number]> = [];
    await processBatchRows(rows, [], (done, total) => progressCalls.push([done, total]));
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1]).toEqual([3, 3]);
  });

  it('lote vazio não quebra', async () => {
    const summary = await processBatchRows([], []);
    expect(summary.total).toBe(0);
  });
});
