import { describe, expect, it } from 'vitest';
import {
  detectPoColumnMappings, suggestPoColumnMapping, applyPoColumnMapping,
  classifyPoImportRow, validatePoImportFile,
} from '../poImportParsing';

describe('detectPoColumnMappings / suggestPoColumnMapping', () => {
  it('detecta colunas por alias conhecido', () => {
    const headers = ['Numero OC', 'Fornecedor', 'SKU', 'Descricao', 'Quantidade', 'Preco Unitario'];
    const detected = detectPoColumnMappings(headers);
    const mapping = suggestPoColumnMapping(detected);

    expect(mapping.poNumber).toBe('Numero OC');
    expect(mapping.supplierName).toBe('Fornecedor');
    expect(mapping.code).toBe('SKU');
    expect(mapping.description).toBe('Descricao');
    expect(mapping.quantity).toBe('Quantidade');
    expect(mapping.unitPrice).toBe('Preco Unitario');
  });

  it('coluna sem correspondência fica sem mapeamento (nunca inventa)', () => {
    const detected = detectPoColumnMappings(['Coluna Aleatoria Sem Sentido']);
    expect(detected[0].detectedField).toBeNull();
  });
});

describe('applyPoColumnMapping', () => {
  it('remapeia linhas cruas para os campos-alvo', () => {
    const rows = [{ 'Numero OC': 'OC-1', SKU: 'ABC', Quantidade: '10' }];
    const mapping = { poNumber: 'Numero OC', supplierName: null, code: 'SKU', ean: null, description: null, unit: null, quantity: 'Quantidade', unitPrice: null, total: null };
    const mapped = applyPoColumnMapping(rows, mapping);
    expect(mapped[0]).toEqual({ poNumber: 'OC-1', code: 'ABC', quantity: '10' });
  });
});

describe('classifyPoImportRow', () => {
  it('linha válida não tem erros', () => {
    const row = { poNumber: 'OC-1', code: 'SKU1', description: 'Produto', quantity: '10', unitPrice: '5.5' };
    const classified = classifyPoImportRow(row, 1);
    expect(classified.errors).toEqual([]);
    expect(classified.quantity).toBe(10);
    expect(classified.unitPrice).toBe(5.5);
  });

  it('linha inválida carrega os erros — nunca é descartada silenciosamente', () => {
    const row = { poNumber: '', description: '', quantity: 'abc' };
    const classified = classifyPoImportRow(row, 2);
    expect(classified.errors.length).toBeGreaterThan(0);
    expect(classified.errors).toContain('Número da OC ausente.');
    expect(classified.errors).toContain('Descrição ausente.');
    expect(classified.errors).toContain('Quantidade ausente ou inválida.');
  });

  it('quantidade zero ou negativa é erro', () => {
    const row = { poNumber: 'OC-1', description: 'Produto', quantity: '0' };
    const classified = classifyPoImportRow(row, 3);
    expect(classified.errors).toContain('Quantidade precisa ser maior que zero.');
  });

  it('EAN inválido é descartado do campo (nunca lançado como código de barras)', () => {
    const row = { poNumber: 'OC-1', description: 'Produto', quantity: '1', ean: 'SEM GTIN' };
    const classified = classifyPoImportRow(row, 4);
    expect(classified.ean).toBeNull();
  });
});

describe('validatePoImportFile', () => {
  it('aceita .csv e .xlsx', () => {
    expect(validatePoImportFile('pedido.csv')).toBeNull();
    expect(validatePoImportFile('pedido.xlsx')).toBeNull();
  });

  it('rejeita arquivos com macro/formato legado', () => {
    expect(validatePoImportFile('pedido.xlsm')).toContain('macro');
    expect(validatePoImportFile('pedido.xls')).toContain('macro');
  });

  it('rejeita formato desconhecido', () => {
    expect(validatePoImportFile('pedido.pdf')).toContain('não suportado');
  });
});
