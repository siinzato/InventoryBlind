// Slotting Intelligence — motor de grade. Funções puras, sem I/O, operando sobre a grade
// desenhada pelo usuário no editor (src/components/slotting/LayoutEditor.tsx). Distância é
// calculada por BFS real considerando obstáculos ('modulo'/'vazio' bloqueiam o caminho) —
// não é Manhattan/euclidiana fingida, é o caminho real dentro do layout desenhado.

import type { WarehouseCell } from './supabase';

export interface GridPoint {
  x: number;
  y: number;
}

const WALK_SPEED_MPS = 1.2; // velocidade média de caminhada de um operador
const HANDLING_TIME_SECONDS = 8; // tempo médio de manuseio por pick, além do deslocamento

const cellKey = (x: number, y: number) => `${x},${y}`;

function isWalkable(cell: WarehouseCell | undefined): boolean {
  if (!cell) return false;
  return (
    cell.cell_type === 'rua' || cell.cell_type === 'posicao' || cell.cell_type === 'expedicao' ||
    cell.cell_type === 'porta' || cell.cell_type === 'doca'
  );
}

export type LengthUnit = 'm' | 'cm';

export interface ScaleCalibrationInput {
  /** Coordenadas em pixel dos dois pontos clicados sobre a planta renderizada. */
  pointA: GridPoint;
  pointB: GridPoint;
  /** Pitch atual de renderização (px por célula da grade, já considerando zoom). */
  pixelsPerCell: number;
  realDistance: number;
  unit: LengthUnit;
}

/** Calibração visual de escala (Etapa "Escala" do configurador): converte a distância em
 *  pixels entre dois pontos clicados + a distância real informada pelo usuário em
 *  `cell_size_meters`. Retorna null em qualquer entrada degenerada (dois pontos iguais,
 *  distância/pitch <= 0) — nunca NaN/Infinity, e a UI deve tratar null como "escala não
 *  calibrada", nunca como zero metros por célula. */
export function computeCellSizeFromTwoPoints(input: ScaleCalibrationInput): number | null {
  const { pointA, pointB, pixelsPerCell, realDistance, unit } = input;
  if (pixelsPerCell <= 0 || realDistance <= 0) return null;

  const pixelDistance = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (pixelDistance <= 0) return null;

  const cellsDistance = pixelDistance / pixelsPerCell;
  const realDistanceMeters = unit === 'cm' ? realDistance / 100 : realDistance;
  return realDistanceMeters / cellsDistance;
}

export function findExpeditionCell(cells: WarehouseCell[]): WarehouseCell | null {
  return cells.find(c => c.cell_type === 'expedicao') ?? null;
}

export interface PathResult {
  path: GridPoint[];
  lengthCells: number;
}

/** BFS num grid 2D — célula 'modulo'/'vazio' é obstáculo, 'rua'/'posicao'/'expedicao' é
 *  andável. Retorna o caminho real (não a distância Manhattan ignorando obstáculos). */
export function findShortestPath(cells: WarehouseCell[], from: GridPoint, to: GridPoint): PathResult | null {
  const byKey = new Map(cells.map(c => [cellKey(c.x, c.y), c]));
  if (!isWalkable(byKey.get(cellKey(from.x, from.y))) || !isWalkable(byKey.get(cellKey(to.x, to.y)))) {
    return null;
  }
  if (from.x === to.x && from.y === to.y) return { path: [from], lengthCells: 0 };

  const visited = new Set<string>([cellKey(from.x, from.y)]);
  const queue: { point: GridPoint; path: GridPoint[] }[] = [{ point: from, path: [from] }];
  const deltas = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  while (queue.length > 0) {
    const { point, path } = queue.shift()!;
    for (const [dx, dy] of deltas) {
      const next = { x: point.x + dx, y: point.y + dy };
      const key = cellKey(next.x, next.y);
      if (visited.has(key)) continue;
      if (!isWalkable(byKey.get(key))) continue;

      const nextPath = [...path, next];
      if (next.x === to.x && next.y === to.y) {
        return { path: nextPath, lengthCells: nextPath.length - 1 };
      }
      visited.add(key);
      queue.push({ point: next, path: nextPath });
    }
  }
  return null;
}

export interface SkuDistanceResult {
  locationCode: string;
  cell: GridPoint;
  distanceMeters: number;
  pickCount: number;
  totalDistanceMeters: number;
  path: GridPoint[];
}

/** Distância percorrida por SKU: caminho real até a expedição × nº de picks no período
 *  (ida e volta — um picker vai até a posição e volta para a expedição a cada visita). */
export function computeSkuDistances(
  cells: WarehouseCell[],
  expeditionCell: GridPoint,
  pickCountsByLocation: Map<string, number>,
  cellSizeMeters: number
): SkuDistanceResult[] {
  const results: SkuDistanceResult[] = [];
  const posicaoCells = cells.filter(c => c.cell_type === 'posicao' && c.location_code);

  for (const cell of posicaoCells) {
    const pickCount = pickCountsByLocation.get(cell.location_code!) ?? 0;
    if (pickCount === 0) continue;

    const result = findShortestPath(cells, { x: cell.x, y: cell.y }, expeditionCell);
    if (!result) continue;

    const distanceMeters = result.lengthCells * cellSizeMeters;
    results.push({
      locationCode: cell.location_code!,
      cell: { x: cell.x, y: cell.y },
      distanceMeters,
      pickCount,
      totalDistanceMeters: distanceMeters * pickCount * 2,
      path: result.path,
    });
  }

  return results.sort((a, b) => b.totalDistanceMeters - a.totalDistanceMeters);
}

export interface OperatorPickRecord {
  locationCode: string;
  operatorId: string;
}

/** Soma a distância (ida e volta) atribuível a cada operador, uma visita por registro de
 *  pick — não multiplica pela quantidade movimentada (um picker visita a posição uma vez
 *  por evento de separação, independente de quantas unidades ele leva daquela visita). */
export function computeOperatorDistances(
  pickRecords: OperatorPickRecord[],
  distanceMetersByLocation: Map<string, number>
): Map<string, number> {
  const byOperator = new Map<string, number>();
  for (const record of pickRecords) {
    const distance = distanceMetersByLocation.get(record.locationCode);
    if (distance === undefined) continue;
    byOperator.set(record.operatorId, (byOperator.get(record.operatorId) ?? 0) + distance * 2);
  }
  return byOperator;
}

/** Tráfego por célula — acumula quantas vezes cada célula aparece nos caminhos reais
 *  calculados, ponderado pela frequência de picks. Vira o heatmap e o ranking de corredores. */
export function computeCorridorTraffic(skuDistances: SkuDistanceResult[]): Map<string, number> {
  const traffic = new Map<string, number>();
  for (const sku of skuDistances) {
    for (const point of sku.path) {
      const key = cellKey(point.x, point.y);
      traffic.set(key, (traffic.get(key) ?? 0) + sku.pickCount);
    }
  }
  return traffic;
}

export function estimatePickingTimeSeconds(distanceMeters: number, pickCount: number): number {
  return distanceMeters / WALK_SPEED_MPS + pickCount * HANDLING_TIME_SECONDS;
}

export function findUnderutilizedPositions(cells: WarehouseCell[], pickCountsByLocation: Map<string, number>): WarehouseCell[] {
  return cells.filter(c => c.cell_type === 'posicao' && c.location_code && (pickCountsByLocation.get(c.location_code) ?? 0) === 0);
}

export function findEmptyWalkablePositions(cells: WarehouseCell[]): WarehouseCell[] {
  return cells.filter(c => c.cell_type === 'posicao' && !c.location_code);
}

export interface RouteSegment {
  fromLocation: string | null; // null = expedição (início do percurso)
  toLocation: string;
  path: GridPoint[];
  lengthCells: number;
}

export interface RouteResult {
  segments: RouteSegment[];
  fullPath: GridPoint[];
  totalLengthCells: number;
}

/** Encadeia BFS real expedição → parada 1 → parada 2 → ... → parada N → expedição,
 *  na ordem dada (ex: ordem cronológica de picks de uma operação Full). Reusa
 *  findShortestPath — não duplica a lógica de pathfinding, só concatena os trechos. */
export function computeRouteThroughStops(cells: WarehouseCell[], stops: GridPoint[], expedition: GridPoint): RouteResult | null {
  if (stops.length === 0) return null;

  const waypoints = [expedition, ...stops, expedition];
  const cellByLocation = new Map(cells.filter(c => c.location_code).map(c => [`${c.x},${c.y}`, c.location_code!]));
  const locationFor = (p: GridPoint) => cellByLocation.get(`${p.x},${p.y}`) ?? null;

  const segments: RouteSegment[] = [];
  const fullPath: GridPoint[] = [];
  let totalLengthCells = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const result = findShortestPath(cells, from, to);
    if (!result) return null;

    segments.push({
      fromLocation: i === 0 ? null : locationFor(from),
      toLocation: locationFor(to) ?? `(${to.x},${to.y})`,
      path: result.path,
      lengthCells: result.lengthCells,
    });
    fullPath.push(...(fullPath.length > 0 ? result.path.slice(1) : result.path));
    totalLengthCells += result.lengthCells;
  }

  return { segments, fullPath, totalLengthCells };
}

export interface MoveSimulationResult {
  currentDistanceMeters: number;
  candidateDistanceMeters: number;
  metersSavedPerTrip: number;
  metersSavedPerWeek: number;
  timeSecondsSavedPerWeek: number;
  feasible: boolean;
}

/** Simulação "e se" pura — não persiste nada. Compara a distância real (BFS) da posição
 *  atual do SKU até a expedição com a de uma posição candidata, projetando a economia
 *  semanal a partir da frequência de pick observada no período consultado. */
export function simulateMove(
  cells: WarehouseCell[],
  currentCell: GridPoint,
  candidateCell: GridPoint,
  expedition: GridPoint,
  pickCountInPeriod: number,
  cellSizeMeters: number,
  periodDays: number
): MoveSimulationResult {
  const currentPath = findShortestPath(cells, currentCell, expedition);
  const candidatePath = findShortestPath(cells, candidateCell, expedition);

  if (!currentPath || !candidatePath) {
    return { currentDistanceMeters: 0, candidateDistanceMeters: 0, metersSavedPerTrip: 0, metersSavedPerWeek: 0, timeSecondsSavedPerWeek: 0, feasible: false };
  }

  const currentDistanceMeters = currentPath.lengthCells * cellSizeMeters;
  const candidateDistanceMeters = candidatePath.lengthCells * cellSizeMeters;
  const metersSavedPerTrip = (currentDistanceMeters - candidateDistanceMeters) * 2; // ida e volta
  const tripsPerWeek = periodDays > 0 ? (pickCountInPeriod / periodDays) * 7 : 0;
  const metersSavedPerWeek = metersSavedPerTrip * tripsPerWeek;

  return {
    currentDistanceMeters,
    candidateDistanceMeters,
    metersSavedPerTrip,
    metersSavedPerWeek,
    timeSecondsSavedPerWeek: estimatePickingTimeSeconds(Math.max(0, metersSavedPerWeek), 0),
    feasible: true,
  };
}
