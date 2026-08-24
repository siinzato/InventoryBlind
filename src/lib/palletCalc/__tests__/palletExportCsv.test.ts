import { describe, expect, it } from 'vitest';
import { buildBatchResultsCsv } from '../palletExportCsv';
import { processBatchRows } from '../batchProcessor';

describe('buildBatchResultsCsv — Formula Injection', () => {
  it('neutraliza SKU iniciado com caractere de fórmula', async () => {
    const row = {
      sku: '+HYPERLINK("http://evil")', length: '400', width: '300', height: '250', lengthUnit: 'mm',
      weight: '5', weightUnit: 'kg', quantity: '10', palletType: 'PBR', rotation: '90',
    };
    const summary = await processBatchRows([{ sourceRowNumber: 2, row: row as never }], []);
    const csv = buildBatchResultsCsv(summary);
    expect(csv).toContain("'+HYPERLINK");
    expect(csv).not.toContain(';+HYPERLINK');
  });

  it('gera uma linha de cabeçalho e uma por resultado', async () => {
    const row = {
      sku: 'OK', length: '400', width: '300', height: '250', lengthUnit: 'mm',
      weight: '5', weightUnit: 'kg', quantity: '10', palletType: 'PBR', rotation: '90',
    };
    const summary = await processBatchRows([{ sourceRowNumber: 2, row: row as never }], []);
    const csv = buildBatchResultsCsv(summary);
    expect(csv.split('\n')).toHaveLength(2);
  });
});
