// Warehouse Digital Twin — decisões puras do fluxo rascunho → publicar e dos estados
// obrigatórios de tela. Sem I/O: quem chama já carregou layout/cells/zones (mesmo padrão
// de warehouseInsightsEngine.ts/slottingEngine.ts).

import type { WarehouseCell, WarehouseLayout, WarehouseZone } from './supabase';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  canPublish: boolean;
  /** % de posições desenhadas que já têm um endereço vinculado. */
  coveragePct: number;
}

export interface ValidateLayoutInput {
  layout: Pick<WarehouseLayout, 'background_image_path' | 'scale_confirmed' | 'grid_width' | 'grid_height'>;
  cells: WarehouseCell[];
  zones: WarehouseZone[];
}

function zonesOverlap(a: WarehouseZone, b: WarehouseZone): boolean {
  return a.min_x <= b.max_x && b.min_x <= a.max_x && a.min_y <= b.max_y && b.min_y <= a.max_y;
}

/**
 * Checklist de publicação (Etapa "Validar"). Erros bloqueiam o botão "Publicar"; avisos só
 * são explicados. Nunca decide sozinha — só informa a decisão que o usuário/UI tomam.
 */
export function validateLayoutForPublish({ layout, cells, zones }: ValidateLayoutInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!layout.background_image_path) {
    issues.push({ code: 'no_floorplan', severity: 'error', message: 'Nenhuma planta (imagem) foi enviada.' });
  }
  if (!layout.scale_confirmed) {
    issues.push({ code: 'no_scale', severity: 'error', message: 'A escala ainda não foi calibrada visualmente.' });
  }
  if (zones.length === 0) {
    issues.push({ code: 'no_zones', severity: 'warning', message: 'Nenhuma zona foi definida — o mapa não mostrará divisões por zona.' });
  }

  const positionCells = cells.filter(c => c.cell_type === 'posicao');
  const linked = positionCells.filter(c => !!c.location_code);
  const coveragePct = positionCells.length > 0 ? (linked.length / positionCells.length) * 100 : 0;

  if (positionCells.length === 0) {
    issues.push({ code: 'no_positions', severity: 'error', message: 'Nenhuma posição de endereço foi desenhada na estrutura.' });
  } else if (linked.length === 0) {
    issues.push({ code: 'no_addresses_linked', severity: 'error', message: 'Nenhum endereço foi vinculado às posições desenhadas.' });
  } else if (coveragePct < 100) {
    issues.push({
      code: 'partial_coverage',
      severity: 'warning',
      message: `Cobertura parcial: ${Math.round(coveragePct)}% das posições desenhadas têm endereço vinculado.`,
    });
  }

  const codeOccurrences = new Map<string, number>();
  for (const c of linked) codeOccurrences.set(c.location_code as string, (codeOccurrences.get(c.location_code as string) ?? 0) + 1);
  const duplicated = Array.from(codeOccurrences.entries()).filter(([, count]) => count > 1).map(([code]) => code);
  if (duplicated.length > 0) {
    issues.push({
      code: 'duplicate_addresses',
      severity: 'error',
      message: `${duplicated.length} código(s) de endereço duplicado(s) entre posições: ${duplicated.join(', ')}.`,
    });
  }

  const outOfBounds = cells.filter(c => c.x < 0 || c.y < 0 || c.x >= layout.grid_width || c.y >= layout.grid_height);
  if (outOfBounds.length > 0) {
    issues.push({ code: 'out_of_bounds', severity: 'error', message: `${outOfBounds.length} estrutura(s) fora dos limites da grade.` });
  }
  const zonesOutOfBounds = zones.filter(z => z.min_x < 0 || z.min_y < 0 || z.max_x >= layout.grid_width || z.max_y >= layout.grid_height);
  if (zonesOutOfBounds.length > 0) {
    issues.push({ code: 'zones_out_of_bounds', severity: 'error', message: `${zonesOutOfBounds.length} zona(s) fora dos limites da grade.` });
  }

  const overlappingZonePairs: string[] = [];
  const namedZones = zones.filter(z => z.kind === 'zona');
  for (let i = 0; i < namedZones.length; i++) {
    for (let j = i + 1; j < namedZones.length; j++) {
      if (zonesOverlap(namedZones[i], namedZones[j])) {
        overlappingZonePairs.push(`${namedZones[i].code} × ${namedZones[j].code}`);
      }
    }
  }
  if (overlappingZonePairs.length > 0) {
    issues.push({
      code: 'overlapping_zones',
      severity: 'error',
      message: `Zonas sobrepostas de forma inválida: ${overlappingZonePairs.join(', ')}.`,
    });
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  return { issues, errors, warnings, canPublish: errors.length === 0, coveragePct };
}

// ── Estados obrigatórios de tela ─────────────────────────────────────────────────────

export type TwinPrimaryState =
  | 'no_layout'
  | 'draft_unpublished'
  | 'no_scale'
  | 'no_addresses'
  | 'source_disconnected'
  | 'syncing'
  | 'load_error'
  | 'no_permission'
  | 'ready';

export interface TwinStateFlags {
  partialMapping: boolean;
  noEvents: boolean;
  eventsWithoutPosition: boolean;
}

export interface TwinState {
  primary: TwinPrimaryState;
  flags: TwinStateFlags;
}

export interface ResolveTwinStateInput {
  canEdit: boolean;
  loading: boolean;
  loadError: boolean;
  /** Planta publicada — null quando a empresa nunca configurou nenhuma. */
  publishedLayout: Pick<WarehouseLayout, 'scale_confirmed'> | null;
  hasDraftLayout: boolean;
  cells: WarehouseCell[];
  totalEvents: number;
  positionedEvents: number;
  /** Fonte de sincronização respondeu na última tentativa — false representa uma falha real
   *  de leitura (não "sem dado ainda"), nunca fabricado por timer. */
  sourceConnected: boolean;
}

/**
 * Resolve qual dos estados obrigatórios de tela se aplica. `primary` é hierárquico (o
 * bloqueio mais fundamental vence); `flags` carrega condições que podem coexistir com
 * `ready` (ex.: publicado E com eventos sem posição ao mesmo tempo).
 */
export function resolveTwinState(input: ResolveTwinStateInput): TwinState {
  const { canEdit, loading, loadError, publishedLayout, hasDraftLayout, cells, totalEvents, positionedEvents, sourceConnected } = input;

  const linkedPositions = cells.filter(c => c.cell_type === 'posicao' && !!c.location_code).length;
  const totalPositions = cells.filter(c => c.cell_type === 'posicao').length;

  const flags: TwinStateFlags = {
    partialMapping: totalPositions > 0 && linkedPositions > 0 && linkedPositions < totalPositions,
    noEvents: totalEvents === 0,
    eventsWithoutPosition: totalEvents > 0 && positionedEvents < totalEvents,
  };

  let primary: TwinPrimaryState;
  if (loadError) primary = 'load_error';
  else if (loading) primary = 'syncing';
  else if (!sourceConnected) primary = 'source_disconnected';
  else if (!publishedLayout && !canEdit) primary = 'no_permission'; // nada publicado e o viewer não pode configurar
  else if (!publishedLayout) primary = hasDraftLayout ? 'draft_unpublished' : 'no_layout';
  else if (!publishedLayout.scale_confirmed) primary = 'no_scale';
  else if (linkedPositions === 0) primary = 'no_addresses';
  else primary = 'ready';

  return { primary, flags };
}

export const TWIN_STATE_MESSAGE: Record<TwinPrimaryState, string> = {
  no_layout: 'Configure a planta e associe os endereços para ativar o mapa operacional.',
  draft_unpublished: 'Existe um rascunho de planta em edição — publique para ativar o mapa operacional.',
  no_scale: 'Calibre a escala da planta para liberar distâncias e tempos estimados.',
  no_addresses: 'Nenhum endereço vinculado ainda — associe endereços na Etapa 4 do configurador.',
  source_disconnected: 'Não foi possível ler os dados operacionais agora.',
  syncing: 'Sincronizando dados operacionais...',
  load_error: 'Erro ao carregar o Warehouse Digital Twin.',
  no_permission: 'Você não tem permissão para editar a planta deste workspace.',
  ready: '',
};
