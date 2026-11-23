// Slotting Intelligence — CRUD do layout (grade + células) e leitura de dados de movimento
// (picks do Full Manager) que alimentam o motor puro em slottingEngine.ts.

import { fetchAllPages, SUPABASE_PAGE } from './supabasePagination';
import { supabase, WarehouseLayout, WarehouseCell, WarehouseCellType, WarehouseZone, WarehouseZoneKind } from './supabase';
import { logAuditEvent } from './auditLogService';
import type { ClassifiedAddressRow } from './warehouseAddressImport';
import { planGridResize } from './slottingEngine';
import { listRecords } from './rcaService';
import type { RawReplayEvent, ReplayEventType } from './warehouseReplayEngine';

/**
 * Pavimento padrão das leituras de planta.
 *
 * Toda tela que existia antes do AZ 2027 falava de UM galpão de um piso só, e continua
 * falando: sem passar `andar`, tudo que já funcionava segue lendo o térreo. O Andar 2 só
 * aparece para quem pedir por ele.
 */
export const ANDAR_TERREO = 1;

// ── Por que todas as leituras de planta passaram a filtrar por andar ──────────────────
// `.maybeSingle()` devolve ERRO quando a consulta casa mais de uma linha, e o tratamento
// aqui é log + null — ou seja, a tela perderia a planta sem dizer por quê. Enquanto havia
// uma planta por empresa isso nunca acontecia. Com uma planta por PAVIMENTO, aconteceria
// na primeira vez que o Andar 2 existisse.
//
// O filtro por `andar` é o que mantém `.maybeSingle()` correto, e os índices parciais da
// migration 131 garantem a mesma coisa do lado do banco: no máximo uma publicada e um
// rascunho por pavimento. Correto por construção, não por sorte.

export async function getActiveLayout(companyId: string, andar: number = ANDAR_TERREO): Promise<WarehouseLayout | null> {
  const { data, error } = await supabase
    .from('warehouse_layouts').select('*').eq('company_id', companyId).eq('andar', andar).eq('is_active', true).order('created_at', { ascending: false }).maybeSingle();
  if (error) { console.error('[Slotting] Error loading active layout:', error); return null; }
  return data as WarehouseLayout | null;
}

export async function createLayout(
  companyId: string,
  name: string,
  gridWidth: number,
  gridHeight: number,
  userId: string,
  userEmail: string,
  andar: number = ANDAR_TERREO
): Promise<WarehouseLayout | null> {
  const { data: layout, error } = await supabase
    .from('warehouse_layouts')
    .insert({ company_id: companyId, name, andar, grid_width: gridWidth, grid_height: gridHeight })
    .select()
    .maybeSingle();
  if (error || !layout) { console.error('[Slotting] Error creating layout:', error); return null; }

  const cellRows: { layout_id: string; company_id: string; x: number; y: number; cell_type: WarehouseCellType }[] = [];
  for (let x = 0; x < gridWidth; x++) {
    for (let y = 0; y < gridHeight; y++) {
      cellRows.push({ layout_id: layout.id, company_id: companyId, x, y, cell_type: 'vazio' });
    }
  }
  const { error: cellsError } = await supabase.from('warehouse_cells').insert(cellRows);
  if (cellsError) console.error('[Slotting] Error creating cells:', cellsError);

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layout.id, metadata: { event: 'created', gridWidth, gridHeight } });
  return layout as WarehouseLayout;
}

/**
 * Redimensiona a grade de um RASCUNHO.
 *
 * Só rascunho: a planta publicada é a que as telas operacionais leem, e mudar a grade dela
 * embaixo de quem está usando trocaria o chão no meio do caminho. O fluxo continua sendo o
 * mesmo de sempre — mexe no rascunho, confere, publica.
 *
 * Crescer só acrescenta célula 'vazio'. Encolher APAGA o que fica fora, por isso quem chama
 * precisa ter mostrado `desenhoPerdido` do plano antes de chegar aqui.
 */
export async function resizeLayoutDraft(
  layoutId: string,
  companyId: string,
  nextWidth: number,
  nextHeight: number,
  userId: string,
  userEmail: string,
): Promise<{ ok: boolean; erro?: string }> {
  const { data: layout, error: loadError } = await supabase
    .from('warehouse_layouts').select('id, status, grid_width, grid_height')
    .eq('id', layoutId).eq('company_id', companyId).maybeSingle();
  if (loadError || !layout) {
    console.error('[Slotting] Error loading layout for resize:', loadError);
    return { ok: false, erro: 'Não foi possível ler a planta.' };
  }
  if (layout.status !== 'draft') return { ok: false, erro: 'Só o rascunho pode ser redimensionado.' };

  const cells = await getCells(layoutId, companyId);
  const plano = planGridResize(cells, nextWidth, nextHeight);
  if (!plano.valido) return { ok: false, erro: plano.motivo ?? 'Tamanho de grade inválido.' };

  // Fora da grade é exatamente `x >= largura` OU `y >= altura`. Duas faixas resolvem, em vez
  // de mandar centenas de pares (x,y) numa cláusula gigante.
  if (plano.toRemove.length > 0) {
    const { error: errX } = await supabase.from('warehouse_cells').delete()
      .eq('layout_id', layoutId).eq('company_id', companyId).gte('x', nextWidth);
    if (errX) {
      console.error('[Slotting] Error trimming cells by width:', errX);
      return { ok: false, erro: 'Não foi possível remover as células que ficaram fora.' };
    }
    const { error: errY } = await supabase.from('warehouse_cells').delete()
      .eq('layout_id', layoutId).eq('company_id', companyId).gte('y', nextHeight);
    if (errY) {
      console.error('[Slotting] Error trimming cells by height:', errY);
      return { ok: false, erro: 'Não foi possível remover as células que ficaram fora.' };
    }
  }

  // Em blocos: com a grade podendo chegar a milhares de celulas, um insert unico viraria
  // um corpo de requisicao enorme numa ida so. O tamanho do bloco acompanha o teto de
  // linhas do PostgREST, que e o mesmo numero que a leitura ja respeita.
  for (let i = 0; i < plano.toCreate.length; i += SUPABASE_PAGE) {
    const bloco = plano.toCreate.slice(i, i + SUPABASE_PAGE);
    const { error: insertError } = await supabase.from('warehouse_cells').insert(
      bloco.map(p => ({
        layout_id: layoutId, company_id: companyId, x: p.x, y: p.y, cell_type: 'vazio' as WarehouseCellType,
      })),
    );
    if (insertError) {
      console.error('[Slotting] Error creating cells for resize:', insertError);
      return { ok: false, erro: 'Não foi possível criar as células novas.' };
    }
  }

  // A dimensão vai por último: se qualquer passo acima falhar, a grade continua coerente com
  // as células que existem, em vez de anunciar um tamanho que o banco não tem.
  const { error: dimError } = await supabase
    .from('warehouse_layouts').update({ grid_width: nextWidth, grid_height: nextHeight })
    .eq('id', layoutId).eq('company_id', companyId);
  if (dimError) {
    console.error('[Slotting] Error updating grid dimensions:', dimError);
    return { ok: false, erro: 'Não foi possível gravar o novo tamanho da grade.' };
  }

  await logAuditEvent({
    companyId, userId, userEmail, action: 'slotting.layout_updated',
    resourceType: 'warehouse_layout', resourceId: layoutId,
    metadata: {
      event: 'grid_resized',
      de: `${layout.grid_width}x${layout.grid_height}`,
      para: `${nextWidth}x${nextHeight}`,
      criadas: plano.toCreate.length,
      removidas: plano.toRemove.length,
    },
  });
  return { ok: true };
}

/**
 * Todas as células da planta.
 *
 * Paginada porque uma consulta sem `.range()` volta no maximo 1.000 linhas e PARECE
 * completa — e a grade passou a poder ter mais que isso. Uma planta de 21 × 90 tem 1.890
 * celulas: sem paginar, o configurador desenharia 1.000 e o resto sumiria sem erro, o
 * publish contaria posicoes a menos e `openLayoutDraft` clonaria um rascunho truncado.
 *
 * `order('y').order('x')` ja da a ordenacao estavel que o paginador exige: existe unique
 * em (layout_id, x, y), entao nao ha empate possivel na virada do bloco.
 */
export async function getCells(layoutId: string, companyId: string): Promise<WarehouseCell[]> {
  const { rows, error } = await fetchAllPages<WarehouseCell>('Slotting/cells', (from, to) =>
    supabase
      .from('warehouse_cells').select('*').eq('layout_id', layoutId).eq('company_id', companyId)
      .order('y').order('x').range(from, to));
  if (error) { console.error('[Slotting] Error loading cells:', error); return []; }
  return rows;
}

export async function upsertCell(
  layoutId: string,
  companyId: string,
  x: number,
  y: number,
  cellType: WarehouseCellType,
  locationCode: string | null,
  userId: string,
  userEmail: string
): Promise<void> {
  const { error } = await supabase
    .from('warehouse_cells')
    .upsert({ layout_id: layoutId, company_id: companyId, x, y, cell_type: cellType, location_code: locationCode }, { onConflict: 'layout_id,x,y' });
  if (error) { console.error('[Slotting] Error updating cell:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'cell_updated', x, y, cellType } });
}

/** Pintura em lote (corredor/rack/área de uma vez) — uma única ida ao banco em vez de um
 *  upsert por célula, tanto por desempenho (grades de até 3600 células) quanto porque é
 *  literalmente a mesma operação de `upsertCell`, só que para várias células de uma vez. */
export async function upsertCellsBatch(
  layoutId: string,
  companyId: string,
  cells: { x: number; y: number; cellType: WarehouseCellType; locationCode: string | null; capacity?: number | null }[],
  userId: string,
  userEmail: string
): Promise<void> {
  if (cells.length === 0) return;
  const { error } = await supabase.from('warehouse_cells').upsert(
    cells.map(c => ({
      layout_id: layoutId, company_id: companyId, x: c.x, y: c.y,
      cell_type: c.cellType, location_code: c.locationCode, capacity: c.capacity ?? null,
    })),
    { onConflict: 'layout_id,x,y' }
  );
  if (error) { console.error('[Slotting] Error batch-updating cells:', error); return; }
  await logAuditEvent({
    companyId, userId, userEmail, action: 'slotting.layout_updated',
    resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'cells_batch_updated', count: cells.length },
  });
}

// ── Zonas (agrupamento retangular de células — migration 103) ──────────────────────────

function zoneFromRow(row: WarehouseZone): WarehouseZone { return row; }

export async function getZones(layoutId: string, companyId: string): Promise<WarehouseZone[]> {
  const { data, error } = await supabase
    .from('warehouse_zones').select('*').eq('layout_id', layoutId).eq('company_id', companyId).order('code');
  if (error) { console.error('[Slotting] Error loading zones:', error); return []; }
  return (data as WarehouseZone[]).map(zoneFromRow);
}

export async function upsertZone(
  layoutId: string,
  companyId: string,
  zone: { id?: string; code: string; name: string; kind: WarehouseZoneKind; minX: number; minY: number; maxX: number; maxY: number },
  userId: string,
  userEmail: string
): Promise<WarehouseZone | null> {
  const { data, error } = await supabase
    .from('warehouse_zones')
    .upsert(
      {
        id: zone.id, layout_id: layoutId, company_id: companyId, code: zone.code, name: zone.name, kind: zone.kind,
        min_x: zone.minX, min_y: zone.minY, max_x: zone.maxX, max_y: zone.maxY, updated_at: new Date().toISOString(),
      },
      { onConflict: 'layout_id,code' }
    )
    .select()
    .maybeSingle();
  if (error || !data) { console.error('[Slotting] Error saving zone:', error); return null; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'zone_saved', code: zone.code } });
  return data as WarehouseZone;
}

export async function deleteZone(zoneId: string, companyId: string, layoutId: string, userId: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from('warehouse_zones').delete().eq('id', zoneId).eq('company_id', companyId);
  if (error) { console.error('[Slotting] Error deleting zone:', error); return; }
  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'zone_deleted', zoneId } });
}

// ── Rascunho / publicação (migration 103) ───────────────────────────────────────────────
// "Configurar planta" nunca edita a planta operacional diretamente: clona a publicada (ou
// parte de uma planta em branco, se ainda não existir nenhuma) para uma linha própria
// `status='draft'`. Toda tela operacional (Operação/Layout e slotting/Replay/Análises) só
// lê `is_active=true AND status='published'` — nunca o rascunho.

export async function getPublishedLayout(companyId: string, andar: number = ANDAR_TERREO): Promise<WarehouseLayout | null> {
  const { data, error } = await supabase
    .from('warehouse_layouts').select('*').eq('company_id', companyId).eq('andar', andar).eq('is_active', true).eq('status', 'published')
    .order('created_at', { ascending: false }).maybeSingle();
  if (error) { console.error('[Slotting] Error loading published layout:', error); return null; }
  return data as WarehouseLayout | null;
}

export async function getDraftLayout(companyId: string, andar: number = ANDAR_TERREO): Promise<WarehouseLayout | null> {
  const { data, error } = await supabase
    .from('warehouse_layouts').select('*').eq('company_id', companyId).eq('andar', andar).eq('status', 'draft')
    .order('created_at', { ascending: false }).maybeSingle();
  if (error) { console.error('[Slotting] Error loading draft layout:', error); return null; }
  return data as WarehouseLayout | null;
}

/** Abre (ou reaproveita) o rascunho de edição — clona a planta publicada e todas as suas
 *  células/zonas; nunca move a operação ao vivo para o rascunho. */
export async function openLayoutDraft(
  companyId: string,
  userId: string,
  userEmail: string,
  andar: number = ANDAR_TERREO,
): Promise<WarehouseLayout | null> {
  const existingDraft = await getDraftLayout(companyId, andar);
  if (existingDraft) return existingDraft;

  const published = await getPublishedLayout(companyId, andar);

  const { data: draft, error } = await supabase
    .from('warehouse_layouts')
    .insert({
      company_id: companyId,
      // O rascunho nasce no MESMO pavimento que se pediu para editar. Herdar do
      // publicado não serviria: quando o Andar 2 ainda não tem planta, `published` é
      // null e o rascunho cairia no térreo, sobrescrevendo o rascunho de lá.
      andar,
      name: published?.name ?? 'Layout Principal',
      grid_width: published?.grid_width ?? 20,
      grid_height: published?.grid_height ?? 20,
      cell_size_meters: published?.cell_size_meters ?? 1.5,
      scale_confirmed: published?.scale_confirmed ?? false,
      background_image_path: published?.background_image_path ?? null,
      background_offset_x: published?.background_offset_x ?? 0,
      background_offset_y: published?.background_offset_y ?? 0,
      background_scale: published?.background_scale ?? 1,
      background_opacity: published?.background_opacity ?? 0.5,
      is_active: false,
      status: 'draft',
      version: (published?.version ?? 0) + 1,
    })
    .select()
    .maybeSingle();
  if (error || !draft) { console.error('[Slotting] Error creating draft layout:', error); return null; }

  if (published) {
    const [cells, zones] = await Promise.all([getCells(published.id, companyId), getZones(published.id, companyId)]);
    if (cells.length > 0) {
      const { error: cellsError } = await supabase.from('warehouse_cells').insert(
        cells.map(c => ({ layout_id: draft.id, company_id: companyId, x: c.x, y: c.y, cell_type: c.cell_type, location_code: c.location_code, capacity: c.capacity }))
      );
      if (cellsError) console.error('[Slotting] Error cloning cells into draft:', cellsError);
    }
    if (zones.length > 0) {
      const { error: zonesError } = await supabase.from('warehouse_zones').insert(
        zones.map(z => ({ layout_id: draft.id, company_id: companyId, code: z.code, name: z.name, kind: z.kind, min_x: z.min_x, min_y: z.min_y, max_x: z.max_x, max_y: z.max_y }))
      );
      if (zonesError) console.error('[Slotting] Error cloning zones into draft:', zonesError);
    }
  }

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: draft.id, metadata: { event: 'draft_opened' } });
  return draft as WarehouseLayout;
}

/** Publica o rascunho: a planta publicada anterior vira `archived` (nunca apagada nem
 *  editada), o rascunho vira a nova publicada. Chamador já deve ter confirmado
 *  `validateLayoutForPublish` sem erros bloqueadores. */
export async function publishLayoutDraft(companyId: string, draftLayoutId: string, userId: string, userEmail: string): Promise<boolean> {
  // O pavimento vem do PRÓPRIO rascunho, não de um parâmetro: publicar o Andar 2 não
  // pode arquivar a planta do térreo. Ler aqui evita que quem chama precise lembrar
  // de passar o andar certo — e errar isso apagaria a planta do andar errado.
  const { data: rascunho, error: draftError } = await supabase
    .from('warehouse_layouts').select('andar')
    .eq('id', draftLayoutId).eq('company_id', companyId).maybeSingle();
  if (draftError || !rascunho) {
    console.error('[Slotting] Error loading draft before publish:', draftError);
    return false;
  }

  const published = await getPublishedLayout(companyId, (rascunho as { andar: number }).andar);

  if (published) {
    const { error: archiveError } = await supabase
      .from('warehouse_layouts').update({ is_active: false, status: 'archived' }).eq('id', published.id).eq('company_id', companyId);
    if (archiveError) { console.error('[Slotting] Error archiving previous layout:', archiveError); return false; }
  }

  const { error: publishError } = await supabase
    .from('warehouse_layouts')
    .update({ is_active: true, status: 'published', published_at: new Date().toISOString(), version: (published?.version ?? 0) + 1 })
    .eq('id', draftLayoutId).eq('company_id', companyId);
  if (publishError) { console.error('[Slotting] Error publishing draft:', publishError); return false; }

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_published', resourceType: 'warehouse_layout', resourceId: draftLayoutId, metadata: { previousLayoutId: published?.id ?? null } });
  return true;
}

/** Grava a escala calibrada visualmente (Etapa "Escala") — única forma de
 *  `scale_confirmed` virar true; distância/tempo só são exibidos depois disso. */
export async function confirmLayoutScale(layoutId: string, companyId: string, cellSizeMeters: number): Promise<void> {
  const { error } = await supabase
    .from('warehouse_layouts').update({ cell_size_meters: cellSizeMeters, scale_confirmed: true }).eq('id', layoutId).eq('company_id', companyId);
  if (error) console.error('[Slotting] Error confirming layout scale:', error);
}

/** Endereços já "conhecidos" pelo InventoryBlind — union de `products.location` (produto
 *  real já alocado ali) e `location_code` já usado em qualquer célula da empresa (posição
 *  cadastrada mesmo que hoje vazia). O CSV de importação só pode vincular a um destes —
 *  nunca cria um endereço novo do zero. */
export async function getKnownAddressCodes(companyId: string): Promise<Set<string>> {
  // Paginado, e aqui o corte não era cosmético: esta lista decide quais endereços
  // o CSV pode usar. Com 1.000 dos 4.628 produtos, endereços reais eram recusados
  // na importação como se não existissem. `warehouse_cells` tem 600 linhas hoje —
  // abaixo do teto, mas pagina junto para não repetir o mesmo bug quando crescer.
  const [{ rows: products, error: productsError }, { rows: cells, error: cellsError }] = await Promise.all([
    fetchAllPages<{ location: string | null }>('Slotting/productLocations', (from, to) =>
      supabase.from('products').select('location').eq('company_id', companyId)
        .not('location', 'is', null).order('id').range(from, to)),
    fetchAllPages<{ location_code: string | null }>('Slotting/cellCodes', (from, to) =>
      supabase.from('warehouse_cells').select('location_code').eq('company_id', companyId)
        .not('location_code', 'is', null).order('id').range(from, to)),
  ]);
  if (productsError) console.error('[Slotting] Error loading product locations:', productsError);
  if (cellsError) console.error('[Slotting] Error loading known cell locations:', cellsError);

  const codes = new Set<string>();
  for (const row of products) if (row.location) codes.add(row.location as string);
  for (const row of cells) if (row.location_code) codes.add(row.location_code as string);
  return codes;
}

/** location_code → (x,y) já vinculado em QUALQUER célula da empresa (não só do rascunho
 *  atual) — usado por `classifyAddressRows` para detectar duplicidade de vínculo. */
export async function getExistingAddressBindings(companyId: string): Promise<Map<string, { x: number; y: number }>> {
  const { data, error } = await supabase
    .from('warehouse_cells').select('x, y, location_code').eq('company_id', companyId).not('location_code', 'is', null);
  if (error) { console.error('[Slotting] Error loading existing address bindings:', error); return new Map(); }
  const bindings = new Map<string, { x: number; y: number }>();
  for (const row of data ?? []) if (row.location_code) bindings.set(row.location_code as string, { x: row.x as number, y: row.y as number });
  return bindings;
}

/** Grava só as linhas classificadas como `linked` — as demais (sem correspondência/
 *  duplicado/fora da planta) nunca chegam a esta função; a decisão de quais linhas contam
 *  como vinculáveis já foi tomada por `classifyAddressRows` (pura, sem I/O). */
export async function applyAddressImport(
  layoutId: string,
  companyId: string,
  linkedRows: ClassifiedAddressRow[],
  userId: string,
  userEmail: string
): Promise<void> {
  const linked = linkedRows.filter(r => r.status === 'linked' && r.x != null && r.y != null);
  if (linked.length === 0) return;

  await upsertCellsBatch(
    layoutId, companyId,
    linked.map(r => ({ x: r.x as number, y: r.y as number, cellType: 'posicao' as WarehouseCellType, locationCode: r.addressCode, capacity: r.capacity })),
    userId, userEmail
  );

  await logAuditEvent({
    companyId, userId, userEmail, action: 'slotting.addresses_imported',
    resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { count: linked.length },
  });
}

/** "Atividades em andamento" do resumo da Central Operacional — escopo deliberadamente
 *  restrito a Operações Full (`checking`/`ready` = iniciada e ainda não concluída), a única
 *  entidade do app com um status de progresso persistente e multi-etapa; contagens manuais/
 *  importadas são eventos atômicos (não têm um estado "em andamento" para contar aqui). */
export async function getInProgressActivityCount(companyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('full_operations').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['checking', 'ready']);
  if (error) { console.error('[Slotting] Error counting in-progress activities:', error); return 0; }
  return count ?? 0;
}

export interface ReplayEventFilters {
  dateFrom?: string;
  dateTo?: string;
  operatorId?: string | null;
  operationId?: string | null;
  /** Subconjunto de tipos a incluir — só 'picking' e 'divergencia' têm endereço real hoje
   *  (inventory_count_records é por linha/marca, não por endereço físico, e o histórico de
   *  otimização do slotting não guarda location_code) — "contagem"/"movimentação" não
   *  aparecem como opção de filtro porque o InventoryBlind não tem esse evento posicionável
   *  ainda; mostrar um filtro para um tipo que nunca existe seria fingir uma capacidade que
   *  não existe. */
  types?: ReplayEventType[];
}

/**
 * Funde os eventos REAIS posicionáveis por endereço — picks de Full Manager e divergências
 * RCA — numa lista bruta única, para `buildReplayTimeline` (warehouseReplayEngine.ts)
 * ordenar e calcular distância/cobertura. Nenhum evento é inventado; operador/produto só
 * aparecem quando o dado de origem já os tem.
 */
export async function getReplayEvents(companyId: string, filters: ReplayEventFilters = {}): Promise<RawReplayEvent[]> {
  const types = filters.types ?? ['picking', 'divergencia'];
  const events: RawReplayEvent[] = [];

  if (types.includes('picking')) {
    let query = supabase
      .from('full_operation_items')
      .select('id, location, picked_at, picked_by_user_id, sku, quantity_picked, operation_id')
      .eq('company_id', companyId)
      .eq('status', 'picked');
    if (filters.dateFrom) query = query.gte('picked_at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('picked_at', filters.dateTo);
    if (filters.operatorId) query = query.eq('picked_by_user_id', filters.operatorId);
    if (filters.operationId) query = query.eq('operation_id', filters.operationId);
    const { data, error } = await query.order('picked_at', { ascending: true }).limit(2000);
    if (error) {
      console.error('[WarehouseTwin] Error loading picking events for replay:', error);
    } else {
      const rows = (data ?? []) as { id: string; location: string | null; picked_at: string | null; picked_by_user_id: string | null; sku: string | null; quantity_picked: number | null; operation_id: string }[];
      const operatorIds = Array.from(new Set(rows.map(r => r.picked_by_user_id).filter((id): id is string => !!id)));
      const operationIds = Array.from(new Set(rows.map(r => r.operation_id)));
      const [{ data: profiles }, { data: operations }] = await Promise.all([
        operatorIds.length > 0 ? supabase.from('profiles').select('id, name').in('id', operatorIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
        operationIds.length > 0 ? supabase.from('full_operations').select('id, full_number').in('id', operationIds) : Promise.resolve({ data: [] as { id: string; full_number: string }[] }),
      ]);
      const nameById = new Map((profiles ?? []).map(p => [p.id, p.name]));
      const labelById = new Map((operations ?? []).map(o => [o.id, o.full_number]));

      for (const row of rows) {
        if (!row.picked_at) continue;
        events.push({
          id: row.id, type: 'picking', occurredAt: row.picked_at, locationCode: row.location,
          operatorId: row.picked_by_user_id, operatorName: row.picked_by_user_id ? nameById.get(row.picked_by_user_id) ?? null : null,
          sku: row.sku, quantity: row.quantity_picked, operationId: row.operation_id, operationLabel: labelById.get(row.operation_id) ?? null,
        });
      }
    }
  }

  if (types.includes('divergencia')) {
    const records = await listRecords(companyId);
    for (const r of records) {
      if (filters.dateFrom && r.occurred_at < filters.dateFrom) continue;
      if (filters.dateTo && r.occurred_at > filters.dateTo) continue;
      if (filters.operatorId && r.operator_user_id !== filters.operatorId) continue;
      events.push({
        id: r.id, type: 'divergencia', occurredAt: r.occurred_at, locationCode: r.location,
        operatorId: r.operator_user_id, operatorName: r.operator_name,
        sku: r.sku, quantity: r.divergence_qty, operationId: null, operationLabel: null,
      });
    }
  }

  return events;
}

/** Contagem de picks por localização (products.location / warehouse_cells.location_code)
 *  numa janela móvel — fonte real de frequência de movimentação para o motor de distância. */
export async function getPickCountsByLocation(companyId: string, days = 90): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('location')
    .eq('company_id', companyId)
    .eq('status', 'picked')
    .gte('picked_at', since);
  if (error) { console.error('[Slotting] Error loading pick counts:', error); return new Map(); }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.location) continue;
    counts.set(row.location, (counts.get(row.location) ?? 0) + 1);
  }
  return counts;
}

export interface PickRecordRow {
  locationCode: string;
  operatorId: string;
}

export async function getPickRecords(companyId: string, days = 90): Promise<PickRecordRow[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('location, picked_by_user_id')
    .eq('company_id', companyId)
    .eq('status', 'picked')
    .gte('picked_at', since);
  if (error) { console.error('[Slotting] Error loading pick records:', error); return []; }

  return (data ?? [])
    .filter((r): r is { location: string; picked_by_user_id: string } => !!r.location && !!r.picked_by_user_id)
    .map(r => ({ locationCode: r.location, operatorId: r.picked_by_user_id }));
}

const FLOORPLAN_BUCKET = 'warehouse-floorplans';
const FLOORPLAN_ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const FLOORPLAN_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Sobe a imagem da planta para o Storage privado e salva o caminho no layout — o app
 *  não tinha nenhum pipeline de upload até aqui; PDF/DWG com parsing automático continua
 *  fora de escopo (decisão confirmada), então só aceitamos imagem (PNG/JPG). SVG é
 *  bloqueado (vetor de XSS armazenado) tanto aqui quanto no bucket (allowed_mime_types). */
export async function uploadFloorPlanImage(companyId: string, layoutId: string, file: File, userId: string, userEmail: string): Promise<string | null> {
  if (!FLOORPLAN_ALLOWED_TYPES.includes(file.type)) { console.error('[Slotting] Rejected floor plan upload: invalid type', file.type); return null; }
  if (file.size > FLOORPLAN_MAX_SIZE_BYTES) { console.error('[Slotting] Rejected floor plan upload: file too large', file.size); return null; }

  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${companyId}/${layoutId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(FLOORPLAN_BUCKET).upload(path, file, { upsert: true });
  if (uploadError) { console.error('[Slotting] Error uploading floor plan:', uploadError); return null; }

  const { error: updateError } = await supabase.from('warehouse_layouts').update({ background_image_path: path }).eq('id', layoutId).eq('company_id', companyId);
  if (updateError) { console.error('[Slotting] Error saving floor plan path:', updateError); return null; }

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.layout_updated', resourceType: 'warehouse_layout', resourceId: layoutId, metadata: { event: 'floorplan_uploaded' } });
  return path;
}

/** Bucket é privado — a URL de exibição precisa ser assinada e expira, então é gerada
 *  sob demanda em vez de guardada junto com o path. */
export async function getFloorPlanSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FLOORPLAN_BUCKET).createSignedUrl(path, 3600);
  if (error) { console.error('[Slotting] Error creating signed URL:', error); return null; }
  return data.signedUrl;
}

export async function updateBackgroundCalibration(
  layoutId: string,
  companyId: string,
  calibration: { offsetX: number; offsetY: number; scale: number; opacity: number }
): Promise<void> {
  const { error } = await supabase
    .from('warehouse_layouts')
    .update({ background_offset_x: calibration.offsetX, background_offset_y: calibration.offsetY, background_scale: calibration.scale, background_opacity: calibration.opacity })
    .eq('id', layoutId).eq('company_id', companyId);
  if (error) console.error('[Slotting] Error saving background calibration:', error);
}

export interface RecentOperationSummary {
  id: string;
  fullNumber: string;
  createdAt: string;
  itemCount: number;
}

/** Operações Full recentes concluídas — alimentam o seletor "ver rota desta operação"
 *  do visualizador de rota de picking. */
export async function getRecentOperations(companyId: string, limit = 20): Promise<RecentOperationSummary[]> {
  const { data, error } = await supabase
    .from('full_operations')
    .select('id, full_number, created_at, total_sku')
    .eq('company_id', companyId)
    .in('status', ['checking', 'ready', 'completed'])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[Slotting] Error loading recent operations:', error); return []; }
  return (data ?? []).map(r => ({ id: r.id as string, fullNumber: r.full_number as string, createdAt: r.created_at as string, itemCount: (r.total_sku as number) ?? 0 }));
}

/** Sequência de localizações efetivamente separadas numa operação, na ordem cronológica
 *  real dos picks — é o insumo bruto para desenhar a rota no mapa. */
export async function getOperationLocations(companyId: string, operationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('location, picked_at')
    .eq('company_id', companyId)
    .eq('operation_id', operationId)
    .eq('status', 'picked')
    .order('picked_at', { ascending: true });
  if (error) { console.error('[Slotting] Error loading operation locations:', error); return []; }
  return (data ?? []).filter((r): r is { location: string; picked_at: string } => !!r.location).map(r => r.location);
}

/** Aplica de fato a movimentação simulada no SkuMoveSimulator — diferente de uma
 *  recomendação pendente, aqui o usuário já decidiu e viu o ganho estimado antes de
 *  confirmar, então grava direto no histórico de otimizações (mesmo padrão do fluxo de
 *  aprovar recomendação). products.location é o mesmo campo-ponte já usado por todo o
 *  módulo — mover um SKU é só reatribuir esse campo a um endereço físico já existente. */
export async function applySkuMove(
  productId: string,
  newLocationCode: string,
  companyId: string,
  layoutId: string,
  metersSavedPerWeek: number,
  userId: string,
  userEmail: string
): Promise<boolean> {
  const { error } = await supabase.from('products').update({ location: newLocationCode }).eq('id', productId).eq('company_id', companyId);
  if (error) { console.error('[Slotting] Error applying SKU move:', error); return false; }

  const { error: historyError } = await supabase.from('warehouse_optimization_history').insert({
    company_id: companyId,
    layout_id: layoutId,
    event: `SKU movido manualmente via simulador para ${newLocationCode}`,
    meters_saved: Math.max(0, metersSavedPerWeek),
  });
  if (historyError) console.error('[Slotting] Error inserting optimization history:', historyError);

  await logAuditEvent({ companyId, userId, userEmail, action: 'slotting.sku_moved', resourceType: 'product', resourceId: productId, metadata: { newLocationCode, metersSavedPerWeek } });
  return true;
}

export async function getCoOccurringSkuPairs(companyId: string, days = 90): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('full_operation_items')
    .select('operation_id, location')
    .eq('company_id', companyId)
    .gte('picked_at', since);
  if (error) { console.error('[Slotting] Error loading co-occurrence data:', error); return new Map(); }

  const byOperation = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    if (!row.location) continue;
    const set = byOperation.get(row.operation_id) ?? new Set<string>();
    set.add(row.location);
    byOperation.set(row.operation_id, set);
  }

  const pairCounts = new Map<string, number>();
  for (const locations of byOperation.values()) {
    const arr = Array.from(locations);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join('|');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  return pairCounts;
}
