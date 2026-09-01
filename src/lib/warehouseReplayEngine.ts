// Warehouse Digital Twin — Replay (Imagem 3). Função pura: funde eventos REAIS de 3 fontes
// já existentes (picks de Full Manager, contagens, divergências RCA) numa única linha do
// tempo por endereço. Nunca inventa posição, distância ou espera — cada uma só aparece
// quando o dado real permite calculá-la. Reaproveita o BFS real de slottingEngine.ts (o
// mesmo já usado pelo Picking Replay) em vez de linha reta entre pontos.

import type { GridPoint } from './slottingEngine';
import { findShortestPath } from './slottingEngine';
import type { WarehouseCell } from './supabase';

export type ReplayEventType = 'picking' | 'contagem' | 'movimentacao' | 'divergencia';

export interface RawReplayEvent {
  id: string;
  type: ReplayEventType;
  occurredAt: string; // ISO
  locationCode: string | null;
  operatorId: string | null;
  operatorName: string | null;
  sku: string | null;
  quantity: number | null;
  operationId: string | null;
  operationLabel: string | null;
}

export interface PositionedReplayEvent extends RawReplayEvent {
  sequenceIndex: number;
  position: GridPoint | null;
  /** null quando não há escala calibrada, ou quando o evento anterior não tem posição. */
  distanceFromPreviousMeters: number | null;
  /** null quando o timestamp do evento anterior é inválido/ausente. */
  waitSecondsSincePrevious: number | null;
  nextEventId: string | null;
}

export interface ReplayTimeline {
  events: PositionedReplayEvent[];
  totalEvents: number;
  positionedCount: number;
  /** eventos posicionados ÷ eventos elegíveis — nunca fabricado, 0 quando não há eventos. */
  coveragePct: number;
}

function parseDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export interface BuildReplayTimelineOptions {
  /** Grade completa (para BFS real) — undefined/vazia faz a distância recair para null em
   *  vez de uma linha reta fingindo ser uma rota. */
  cells: WarehouseCell[];
  /** metros por célula só quando a escala foi calibrada — null bloqueia toda distância. */
  cellSizeMeters: number | null;
}

/**
 * Ordena os eventos brutos cronologicamente (desempate estável por id), resolve a posição
 * de cada um pelo endereço real, e só preenche distância/espera quando os dados permitirem.
 */
export function buildReplayTimeline(rawEvents: RawReplayEvent[], options: BuildReplayTimelineOptions): ReplayTimeline {
  const { cells, cellSizeMeters } = options;
  const cellByLocation = new Map(cells.filter(c => c.location_code).map(c => [c.location_code as string, c]));

  const sorted = [...rawEvents].sort((a, b) => {
    const diff = (parseDate(a.occurredAt) ?? 0) - (parseDate(b.occurredAt) ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const events: PositionedReplayEvent[] = [];
  let previous: PositionedReplayEvent | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    const cell = raw.locationCode ? cellByLocation.get(raw.locationCode) : undefined;
    const position: GridPoint | null = cell ? { x: cell.x, y: cell.y } : null;

    let distanceFromPreviousMeters: number | null = null;
    if (cellSizeMeters != null && cellSizeMeters > 0 && previous?.position && position) {
      const result = findShortestPath(cells, previous.position, position);
      distanceFromPreviousMeters = result ? result.lengthCells * cellSizeMeters : null;
    }

    let waitSecondsSincePrevious: number | null = null;
    const previousMs = previous ? parseDate(previous.occurredAt) : null;
    const currentMs = parseDate(raw.occurredAt);
    if (previousMs != null && currentMs != null && currentMs >= previousMs) {
      waitSecondsSincePrevious = (currentMs - previousMs) / 1000;
    }

    const positioned: PositionedReplayEvent = {
      ...raw,
      sequenceIndex: i + 1,
      position,
      distanceFromPreviousMeters,
      waitSecondsSincePrevious,
      nextEventId: null,
    };
    if (previous) previous.nextEventId = positioned.id;
    events.push(positioned);
    previous = positioned;
  }

  const positionedCount = events.filter(e => e.position != null).length;
  return {
    events,
    totalEvents: events.length,
    positionedCount,
    coveragePct: events.length > 0 ? (positionedCount / events.length) * 100 : 0,
  };
}
