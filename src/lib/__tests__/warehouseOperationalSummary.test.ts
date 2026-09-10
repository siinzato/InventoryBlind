import { describe, expect, it } from 'vitest';
import { computeOccupancySummary, countActiveAddresses, countOpenDivergencePositions, findLatestEventAt } from '../warehouseOperationalSummary';
import type { WarehouseCell, LocationLiveStatus } from '../supabase';

function cell(overrides: Partial<WarehouseCell> = {}): WarehouseCell {
  return { id: 'c1', layout_id: 'l1', company_id: 'co1', x: 0, y: 0, cell_type: 'posicao', location_code: 'A-01', capacity: null, ...overrides };
}

function status(overrides: Partial<LocationLiveStatus> = {}): LocationLiveStatus {
  return {
    locationCode: 'A-01', productId: null, sku: null, productName: null, stockQuantity: null, occupied: false,
    pickCount: 0, riskScore: null, riskLevel: null, riskReason: null, confidenceScore: null, confidenceLevel: null,
    confidenceTopReasons: [], abcClass: null, xyzClass: null, valueMoved: null, divergenceCount: 0,
    lastCountAt: null, lastDivergenceAt: null, recommendation: null, ...overrides,
  };
}

describe('computeOccupancySummary', () => {
  it('retorna null quando não há nenhuma posição utilizável (planta sem estrutura)', () => {
    expect(computeOccupancySummary([], new Map())).toBeNull();
  });

  it('usa capacidade quando pelo menos uma posição tem capacity configurada', () => {
    const cells = [cell({ location_code: 'A-01', capacity: 100 }), cell({ id: 'c2', location_code: 'A-02', capacity: 50 })];
    const liveData = new Map([
      ['A-01', status({ locationCode: 'A-01', stockQuantity: 50 })],
      ['A-02', status({ locationCode: 'A-02', stockQuantity: 50 })],
    ]);
    const result = computeOccupancySummary(cells, liveData);
    expect(result?.method).toBe('capacity');
    expect(result?.pct).toBeCloseTo((100 / 150) * 100, 5);
  });

  it('cai para presença (saldo>0) quando nenhuma posição tem capacidade', () => {
    const cells = [cell({ location_code: 'A-01' }), cell({ id: 'c2', location_code: 'A-02' })];
    const liveData = new Map([
      ['A-01', status({ locationCode: 'A-01', stockQuantity: 5 })],
      ['A-02', status({ locationCode: 'A-02', stockQuantity: 0 })],
    ]);
    const result = computeOccupancySummary(cells, liveData);
    expect(result?.method).toBe('presenca');
    expect(result?.pct).toBeCloseTo(50, 5);
  });

  it('nunca excede 100% mesmo com saldo acima da capacidade somada', () => {
    const cells = [cell({ location_code: 'A-01', capacity: 10 })];
    const liveData = new Map([['A-01', status({ locationCode: 'A-01', stockQuantity: 999 })]]);
    expect(computeOccupancySummary(cells, liveData)?.pct).toBe(100);
  });
});

describe('countActiveAddresses', () => {
  it('conta só posições com location_code vinculado', () => {
    const cells = [cell({ location_code: 'A-01' }), cell({ id: 'c2', location_code: null }), cell({ id: 'c3', cell_type: 'rua', location_code: null })];
    expect(countActiveAddresses(cells)).toBe(1);
  });
});

describe('countOpenDivergencePositions', () => {
  it('conta posições com pelo menos 1 divergência — mesma base do layer do mapa', () => {
    const liveData = new Map([
      ['A-01', status({ divergenceCount: 3 })],
      ['A-02', status({ divergenceCount: 0 })],
      ['A-03', status({ divergenceCount: 1 })],
    ]);
    expect(countOpenDivergencePositions(liveData)).toBe(2);
  });
});

describe('findLatestEventAt', () => {
  it('retorna o timestamp mais recente, ignorando nulos e datas inválidas', () => {
    expect(findLatestEventAt(['2026-08-01T10:00:00Z', null, '2026-08-30T09:00:00Z', undefined, 'lixo'])).toBe('2026-08-30T09:00:00Z');
  });

  it('retorna null quando não há nenhum timestamp válido', () => {
    expect(findLatestEventAt([null, undefined, 'lixo'])).toBeNull();
  });
});
