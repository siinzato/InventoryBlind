import { describe, expect, it } from 'vitest';
import { classifyAddressRows, parseAddressCsv, type AddressCsvRow } from '../warehouseAddressImport';

function row(overrides: Partial<AddressCsvRow> = {}): AddressCsvRow {
  return { addressCode: 'A-01-01', zone: null, aisle: null, rack: null, level: null, bin: null, spatialEntityCode: null, x: 1, y: 1, capacity: null, ...overrides };
}

describe('classifyAddressRows', () => {
  it('vincula quando o endereço já existe no InventoryBlind e a posição está dentro da grade', () => {
    const result = classifyAddressRows({
      rows: [row({ addressCode: 'A-01-01' })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01']),
      existingBindings: new Map(),
    });
    expect(result.rows[0].status).toBe('linked');
    expect(result.totals).toEqual({ total: 1, linked: 1, unmatched: 0, duplicate: 0, outOfBounds: 0 });
  });

  it('marca sem correspondência quando o código não existe no InventoryBlind — nunca cria um endereço novo', () => {
    const result = classifyAddressRows({
      rows: [row({ addressCode: 'Z-99-99' })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01']),
      existingBindings: new Map(),
    });
    expect(result.rows[0].status).toBe('unmatched');
  });

  it('marca fora da planta quando x/y estão fora dos limites ou ausentes', () => {
    const result = classifyAddressRows({
      rows: [row({ x: 999 }), row({ addressCode: 'A-02', x: null, y: null })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01', 'A-02']),
      existingBindings: new Map(),
    });
    expect(result.rows[0].status).toBe('out_of_bounds');
    expect(result.rows[1].status).toBe('out_of_bounds');
  });

  it('marca duplicado quando o mesmo código aparece duas vezes no arquivo', () => {
    const result = classifyAddressRows({
      rows: [row({ addressCode: 'A-01-01', x: 1, y: 1 }), row({ addressCode: 'A-01-01', x: 2, y: 2 })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01']),
      existingBindings: new Map(),
    });
    expect(result.rows[1].status).toBe('duplicate');
  });

  it('marca duplicado quando o endereço já está vinculado a outra posição existente', () => {
    const result = classifyAddressRows({
      rows: [row({ addressCode: 'A-01-01', x: 5, y: 5 })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01']),
      existingBindings: new Map([['A-01-01', { x: 1, y: 1 }]]),
    });
    expect(result.rows[0].status).toBe('duplicate');
  });

  it('não marca duplicado quando o vínculo existente já é para a mesma posição (reimportação idempotente)', () => {
    const result = classifyAddressRows({
      rows: [row({ addressCode: 'A-01-01', x: 1, y: 1 })],
      gridWidth: 10, gridHeight: 10,
      knownAddressCodes: new Set(['A-01-01']),
      existingBindings: new Map([['A-01-01', { x: 1, y: 1 }]]),
    });
    expect(result.rows[0].status).toBe('linked');
  });
});

describe('parseAddressCsv', () => {
  it('lê o cabeçalho template e extrai as colunas por alias', () => {
    const csv = 'address_code,zone,aisle,rack,level,bin,spatial_entity_code,x,y,capacity\nA-01-01,A,01,01,1,1,A-CORR-01,3,4,20';
    const rows = parseAddressCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ addressCode: 'A-01-01', zone: 'A', x: 3, y: 4, capacity: 20 });
  });

  it('campos numéricos ausentes ou inválidos viram null, nunca NaN', () => {
    const csv = 'address_code,x,y\nA-01-01,,';
    const rows = parseAddressCsv(csv);
    expect(rows[0].x).toBeNull();
    expect(rows[0].y).toBeNull();
  });
});
