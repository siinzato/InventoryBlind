import { describe, expect, it } from 'vitest';
import { buildBatchWorkbook } from '../palletExportExcel';
import { processBatchRows } from '../batchProcessor';

const goodRow = {
  sku: '=CMD|/C calc!A1', length: '400', width: '300', height: '250', lengthUnit: 'mm',
  weight: '5', weightUnit: 'kg', quantity: '120', palletType: 'PBR', rotation: '90',
};

describe('buildBatchWorkbook — Formula Injection (spec §10/§12)', () => {
  it('neutraliza SKU que começa com "=" (fórmula) nas abas geradas', async () => {
    const summary = await processBatchRows([{ sourceRowNumber: 2, row: goodRow as never }], []);
    const wb = await buildBatchWorkbook(summary);

    const XLSX = await import('xlsx');
    const resultsSheet = wb.Sheets['Resultados'];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(resultsSheet, { header: 1 });
    const skuCell = String(rows[1][1]);

    expect(skuCell.startsWith("'")).toBe(true);
    expect(skuCell).not.toBe(goodRow.sku);
  });

  it('cria as 5 abas exigidas pelo spec (Resumo/Resultados/Alertas/Inválidos/Parâmetros)', async () => {
    const summary = await processBatchRows([{ sourceRowNumber: 2, row: goodRow as never }], []);
    const wb = await buildBatchWorkbook(summary);
    expect(wb.SheetNames).toEqual(['Resumo', 'Resultados', 'Alertas', 'Inválidos', 'Parâmetros']);
  });

  it('linha inválida aparece na aba Inválidos com o motivo', async () => {
    const badRow = { ...goodRow, length: 'abc' };
    const summary = await processBatchRows([{ sourceRowNumber: 5, row: badRow as never }], []);
    const wb = await buildBatchWorkbook(summary);

    const XLSX = await import('xlsx');
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['Inválidos'], { header: 1 });
    expect(rows.length).toBeGreaterThan(1);
    expect(String(rows[1][0])).toBe('5');
  });
});
