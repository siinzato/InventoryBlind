import { describe, expect, it } from 'vitest';
import { validateLayoutForPublish, resolveTwinState, type ValidateLayoutInput } from '../warehouseLayoutPublishing';
import type { WarehouseCell, WarehouseZone } from '../supabase';

function cell(overrides: Partial<WarehouseCell> = {}): WarehouseCell {
  return { id: 'c1', layout_id: 'l1', company_id: 'co1', x: 0, y: 0, cell_type: 'posicao', location_code: 'A-01', capacity: null, ...overrides };
}

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return { id: 'z1', layout_id: 'l1', company_id: 'co1', code: 'A', name: 'Zona A', kind: 'zona', min_x: 0, min_y: 0, max_x: 2, max_y: 2, created_at: '', updated_at: '', ...overrides };
}

function baseInput(overrides: Partial<ValidateLayoutInput['layout']> = {}): Pick<ValidateLayoutInput['layout'], never> & ValidateLayoutInput['layout'] {
  return { background_image_path: 'co1/plant.png', scale_confirmed: true, grid_width: 10, grid_height: 10, ...overrides };
}

describe('validateLayoutForPublish', () => {
  it('bloqueia sem planta enviada', () => {
    const result = validateLayoutForPublish({ layout: baseInput({ background_image_path: null }), cells: [cell()], zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('no_floorplan');
  });

  it('bloqueia sem escala calibrada', () => {
    const result = validateLayoutForPublish({ layout: baseInput({ scale_confirmed: false }), cells: [cell()], zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('no_scale');
  });

  it('avisa (não bloqueia) quando não há nenhuma zona', () => {
    const result = validateLayoutForPublish({ layout: baseInput(), cells: [cell()], zones: [] });
    expect(result.warnings.map(w => w.code)).toContain('no_zones');
    expect(result.errors.map(e => e.code)).not.toContain('no_zones');
  });

  it('bloqueia quando não há nenhuma posição desenhada', () => {
    const result = validateLayoutForPublish({ layout: baseInput(), cells: [cell({ cell_type: 'rua', location_code: null })], zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('no_positions');
  });

  it('bloqueia quando nenhuma posição tem endereço vinculado', () => {
    const result = validateLayoutForPublish({ layout: baseInput(), cells: [cell({ location_code: null })], zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('no_addresses_linked');
  });

  it('avisa (não bloqueia) cobertura parcial de endereços', () => {
    const cells = [cell({ location_code: 'A-01' }), cell({ id: 'c2', x: 1, location_code: null })];
    const result = validateLayoutForPublish({ layout: baseInput(), cells, zones: [zone()] });
    expect(result.canPublish).toBe(true);
    expect(result.warnings.map(w => w.code)).toContain('partial_coverage');
    expect(result.coveragePct).toBeCloseTo(50, 5);
  });

  it('bloqueia códigos de endereço duplicados entre posições', () => {
    const cells = [cell({ location_code: 'A-01' }), cell({ id: 'c2', x: 1, location_code: 'A-01' })];
    const result = validateLayoutForPublish({ layout: baseInput(), cells, zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('duplicate_addresses');
  });

  it('bloqueia estrutura fora dos limites da grade', () => {
    const cells = [cell({ x: 999, y: 0 })];
    const result = validateLayoutForPublish({ layout: baseInput(), cells, zones: [zone()] });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('out_of_bounds');
  });

  it('bloqueia zonas sobrepostas de forma inválida', () => {
    const zones = [zone({ id: 'z1', code: 'A', min_x: 0, max_x: 3, min_y: 0, max_y: 3 }), zone({ id: 'z2', code: 'B', min_x: 2, max_x: 5, min_y: 2, max_y: 5 })];
    const result = validateLayoutForPublish({ layout: baseInput(), cells: [cell()], zones });
    expect(result.canPublish).toBe(false);
    expect(result.errors.map(e => e.code)).toContain('overlapping_zones');
  });

  it('permite publicar quando não há nenhum erro bloqueador', () => {
    const result = validateLayoutForPublish({ layout: baseInput(), cells: [cell()], zones: [zone()] });
    expect(result.canPublish).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('resolveTwinState', () => {
  const readyCells = [cell({ location_code: 'A-01' })];

  it('nenhuma planta configurada', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: null, hasDraftLayout: false,
      cells: [], totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('no_layout');
  });

  it('rascunho existe mas não foi publicado ainda', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: null, hasDraftLayout: true,
      cells: [], totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('draft_unpublished');
  });

  it('planta publicada sem escala calibrada', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: { scale_confirmed: false }, hasDraftLayout: false,
      cells: readyCells, totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('no_scale');
  });

  it('publicada, com escala, mas sem nenhum endereço vinculado', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: { scale_confirmed: true }, hasDraftLayout: false,
      cells: [cell({ location_code: null })], totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('no_addresses');
  });

  it('mapeamento parcial e eventos sem posição coexistem com o estado "ready"', () => {
    const cells = [cell({ location_code: 'A-01' }), cell({ id: 'c2', x: 1, location_code: null })];
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: { scale_confirmed: true }, hasDraftLayout: false,
      cells, totalEvents: 10, positionedEvents: 6, sourceConnected: true,
    });
    expect(state.primary).toBe('ready');
    expect(state.flags.partialMapping).toBe(true);
    expect(state.flags.eventsWithoutPosition).toBe(true);
  });

  it('sem eventos ainda', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: { scale_confirmed: true }, hasDraftLayout: false,
      cells: readyCells, totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('ready');
    expect(state.flags.noEvents).toBe(true);
  });

  it('fonte desconectada tem prioridade sobre o estado da planta', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: false, publishedLayout: { scale_confirmed: true }, hasDraftLayout: false,
      cells: readyCells, totalEvents: 0, positionedEvents: 0, sourceConnected: false,
    });
    expect(state.primary).toBe('source_disconnected');
  });

  it('sincronizando tem prioridade sobre qualquer outro estado', () => {
    const state = resolveTwinState({
      canEdit: true, loading: true, loadError: false, publishedLayout: null, hasDraftLayout: false,
      cells: [], totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('syncing');
  });

  it('sem planta publicada e sem permissão de editar — operador não pode fazer nada, mensagem específica', () => {
    const state = resolveTwinState({
      canEdit: false, loading: false, loadError: false, publishedLayout: null, hasDraftLayout: false,
      cells: [], totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('no_permission');
  });

  it('erro de carregamento tem prioridade máxima', () => {
    const state = resolveTwinState({
      canEdit: true, loading: false, loadError: true, publishedLayout: { scale_confirmed: true }, hasDraftLayout: false,
      cells: readyCells, totalEvents: 0, positionedEvents: 0, sourceConnected: true,
    });
    expect(state.primary).toBe('load_error');
  });
});
