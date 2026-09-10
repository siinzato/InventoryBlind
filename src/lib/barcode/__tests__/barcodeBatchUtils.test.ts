import { describe, expect, it } from 'vitest';
import {
  detectBarcodeColumnMappings, suggestBarcodeMapping, applyBarcodeColumnMapping,
  processBarcodeBatchRows, summarizeBarcodeBatch, barcodeBatchErrorsToCSV,
  BarcodeRow,
} from '../barcodeBatchUtils';

describe('detectBarcodeColumnMappings / suggestBarcodeMapping', () => {
  it('detecta as colunas do lote por nome exato ou aproximado', () => {
    const headers = ['Valor do Código', 'Tipo', 'Nome', 'SKU', 'Cópias'];
    const detected = detectBarcodeColumnMappings(headers);
    const mapping = suggestBarcodeMapping(detected);
    expect(mapping.value).toBe('Valor do Código');
    expect(mapping.symbology).toBe('Tipo');
    expect(mapping.name).toBe('Nome');
    expect(mapping.sku).toBe('SKU');
    expect(mapping.copies).toBe('Cópias');
  });

  it('applyBarcodeColumnMapping remapeia linhas cruas para os campos canônicos', () => {
    const rawRows: BarcodeRow[] = [{ 'Valor do Código': '4006381333931', Tipo: 'ean13' }];
    const mapping = suggestBarcodeMapping(detectBarcodeColumnMappings(['Valor do Código', 'Tipo']));
    const mapped = applyBarcodeColumnMapping(rawRows, mapping);
    expect(mapped[0].value).toBe('4006381333931');
    expect(mapped[0].symbology).toBe('ean13');
  });
});

describe('processBarcodeBatchRows', () => {
  it('linhas inválidas não impedem o preview das válidas', async () => {
    const rows: BarcodeRow[] = [
      { value: '400638133393', symbology: 'ean13' }, // válido (12 dígitos, calcula o 13º)
      { value: 'abc', symbology: 'ean13' },             // inválido — letras
      { value: '9638507', symbology: 'ean8' },          // válido, código diferente
    ];
    const result = await processBarcodeBatchRows(rows, null);
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe('valid');
    expect(result[1].status).toBe('invalid');
    expect(result[2].status).toBe('valid');
  });

  it('detecta duplicados dentro do próprio lote (mesmo símbolo + mesmo código final)', async () => {
    const rows: BarcodeRow[] = [
      { value: '4006381333931', symbology: 'ean13' },
      { value: '400638133393', symbology: 'ean13' }, // gera o mesmo código final
      { value: '96385074', symbology: 'ean8' },        // símbolo diferente, não é duplicado
    ];
    const result = await processBarcodeBatchRows(rows, null);
    expect(result[0].status).toBe('duplicate');
    expect(result[1].status).toBe('duplicate');
    expect(result[2].status).toBe('valid');
  });

  it('respeita o tipo global quando a linha não informa symbology', async () => {
    const rows: BarcodeRow[] = [{ value: '400638133393' }];
    const result = await processBarcodeBatchRows(rows, 'ean13');
    expect(result[0].status).toBe('valid');
    expect(result[0].symbology).toBe('ean13');
  });

  it('marca inválida quando não há tipo global nem por linha', async () => {
    const rows: BarcodeRow[] = [{ value: '400638133393' }];
    const result = await processBarcodeBatchRows(rows, null);
    expect(result[0].status).toBe('invalid');
  });

  it('número de cópias é respeitado (padrão 1, mínimo 1, lê da coluna quando presente)', async () => {
    const rows: BarcodeRow[] = [
      { value: '400638133393', symbology: 'ean13', copies: 5 },
      { value: '9638507', symbology: 'ean8' }, // sem coluna copies -> padrão 1
      { value: '03600029145', symbology: 'upca', copies: -3 }, // inválido -> cai para 1
    ];
    const result = await processBarcodeBatchRows(rows, null);
    expect(result[0].copies).toBe(5);
    expect(result[1].copies).toBe(1);
    expect(result[2].copies).toBe(1);
  });

  it('processa lotes grandes (chunking) sem perder nenhuma linha', async () => {
    const rows: BarcodeRow[] = Array.from({ length: 1200 }, (_, i) => ({ value: String(i).padStart(12, '0'), symbology: 'ean13' }));
    const result = await processBarcodeBatchRows(rows, null);
    expect(result).toHaveLength(1200);
  });
});

describe('summarizeBarcodeBatch / barcodeBatchErrorsToCSV', () => {
  it('resume total/válidos/inválidos/duplicados/etiquetas', async () => {
    const rows: BarcodeRow[] = [
      { value: '400638133393', symbology: 'ean13', copies: 2 },
      { value: 'abc', symbology: 'ean13' },
      { value: '4006381333931', symbology: 'ean13', copies: 3 }, // duplicado do primeiro
    ];
    const processed = await processBarcodeBatchRows(rows, null);
    const summary = summarizeBarcodeBatch(processed);
    expect(summary.total).toBe(3);
    expect(summary.invalid).toBe(1);
    expect(summary.duplicate).toBe(2);
    expect(summary.valid).toBe(0);
    expect(summary.totalLabels).toBe(0);
  });

  it('CSV de erros inclui só as linhas não-válidas', async () => {
    const rows: BarcodeRow[] = [
      { value: '400638133393', symbology: 'ean13' },
      { value: 'abc', symbology: 'ean13' },
    ];
    const processed = await processBarcodeBatchRows(rows, null);
    const csv = barcodeBatchErrorsToCSV(processed);
    expect(csv).toContain('abc');
    expect(csv.split('\n')).toHaveLength(2); // header + 1 linha inválida
  });
});
