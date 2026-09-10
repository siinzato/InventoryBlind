import { describe, expect, it } from 'vitest';
import { buildReplayTimeline, type RawReplayEvent } from '../warehouseReplayEngine';
import type { WarehouseCell } from '../supabase';

function cell(overrides: Partial<WarehouseCell> = {}): WarehouseCell {
  return { id: 'c1', layout_id: 'l1', company_id: 'co1', x: 0, y: 0, cell_type: 'rua', location_code: null, capacity: null, ...overrides };
}

function event(overrides: Partial<RawReplayEvent> = {}): RawReplayEvent {
  return {
    id: 'e1', type: 'picking', occurredAt: '2026-08-31T10:00:00Z', locationCode: 'A-01',
    operatorId: null, operatorName: null, sku: null, quantity: null, operationId: null, operationLabel: null,
    ...overrides,
  };
}

// Corredor reto conectando (0,0) a (5,0), com posições em x=0 e x=5.
const CELLS: WarehouseCell[] = [
  cell({ id: 'p0', x: 0, y: 0, cell_type: 'posicao', location_code: 'A-01' }),
  cell({ id: 'r1', x: 1, y: 0 }), cell({ id: 'r2', x: 2, y: 0 }), cell({ id: 'r3', x: 3, y: 0 }), cell({ id: 'r4', x: 4, y: 0 }),
  cell({ id: 'p5', x: 5, y: 0, cell_type: 'posicao', location_code: 'A-02' }),
];

describe('buildReplayTimeline', () => {
  it('ordena eventos cronologicamente independente da ordem de entrada', () => {
    const events = [
      event({ id: 'later', occurredAt: '2026-08-31T12:00:00Z' }),
      event({ id: 'earlier', occurredAt: '2026-08-31T09:00:00Z' }),
    ];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(timeline.events.map(e => e.id)).toEqual(['earlier', 'later']);
    expect(timeline.events.map(e => e.sequenceIndex)).toEqual([1, 2]);
  });

  it('evento sem endereço correspondente na grade fica sem posição — nunca fabrica coordenada', () => {
    const events = [event({ locationCode: 'ENDERECO-INEXISTENTE' })];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(timeline.events[0].position).toBeNull();
    expect(timeline.positionedCount).toBe(0);
    expect(timeline.coveragePct).toBe(0);
  });

  it('cobertura é consistente: posicionados dividido por total', () => {
    const events = [
      event({ id: 'a', locationCode: 'A-01' }),
      event({ id: 'b', locationCode: 'SEM-CORRESPONDENCIA' }),
      event({ id: 'c', locationCode: 'A-02' }),
    ];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(timeline.totalEvents).toBe(3);
    expect(timeline.positionedCount).toBe(2);
    expect(timeline.coveragePct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('distância exige escala calibrada — sem cellSizeMeters, fica null mesmo com posição conhecida', () => {
    const events = [
      event({ id: 'a', occurredAt: '2026-08-31T09:00:00Z', locationCode: 'A-01' }),
      event({ id: 'b', occurredAt: '2026-08-31T09:05:00Z', locationCode: 'A-02' }),
    ];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: null });
    expect(timeline.events[1].distanceFromPreviousMeters).toBeNull();
  });

  it('calcula distância real via BFS (não linha reta) quando a escala está calibrada', () => {
    const events = [
      event({ id: 'a', occurredAt: '2026-08-31T09:00:00Z', locationCode: 'A-01' }),
      event({ id: 'b', occurredAt: '2026-08-31T09:05:00Z', locationCode: 'A-02' }),
    ];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 2 });
    // (0,0) -> (5,0) = 5 células * 2m = 10m
    expect(timeline.events[1].distanceFromPreviousMeters).toBeCloseTo(10, 5);
  });

  it('espera só é calculada quando os timestamps permitem, nunca inventada', () => {
    const events = [
      event({ id: 'a', occurredAt: '2026-08-31T09:00:00Z' }),
      event({ id: 'b', occurredAt: '2026-08-31T09:05:00Z' }),
    ];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(timeline.events[0].waitSecondsSincePrevious).toBeNull();
    expect(timeline.events[1].waitSecondsSincePrevious).toBe(300);
  });

  it('encadeia nextEventId na ordem cronológica final', () => {
    const events = [event({ id: 'a', occurredAt: '2026-08-31T09:00:00Z' }), event({ id: 'b', occurredAt: '2026-08-31T09:05:00Z' })];
    const timeline = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(timeline.events[0].nextEventId).toBe('b');
    expect(timeline.events[1].nextEventId).toBeNull();
  });

  it('é determinístico: mesma entrada produz exatamente o mesmo resultado', () => {
    const events = [event({ id: 'a' }), event({ id: 'b', occurredAt: '2026-08-31T09:05:00Z', locationCode: 'A-02' })];
    const t1 = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    const t2 = buildReplayTimeline(events, { cells: CELLS, cellSizeMeters: 1 });
    expect(t1).toEqual(t2);
  });
});
