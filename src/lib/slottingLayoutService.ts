// Slotting Intelligence — CRUD do layout (grade + células) e leitura de dados de movimento
// (picks do Full Manager) que alimentam o motor puro em slottingEngine.ts.

import { supabase, WarehouseLayout, WarehouseCell, WarehouseCellType } from './supabase';
import { logAuditEvent } from './auditLogService';

export async function getActiveLayout(companyId: string): Promise<WarehouseLayout | null> {
  const { data, error } = await supabase
    .from('warehouse_layouts').select('*').eq('company_id', companyId).eq('is_active', true).order('created_at', { ascending: false }).maybeSingle();
  if (error) { console.error('[Slotting] Error loading active layout:', error); return null; }
  return data as WarehouseLayout | null;
}

export async function createLayout(
  companyId: string,
  name: string,
  gridWidth: number,
  gridHeight: number,
  userId: string,
  userEmail: string
): Promise<WarehouseLayout | null> {
  const { data: layout, error } = await supabase
    .from('warehouse_layouts')
    .insert({ company_id: companyId, name, grid_width: gridWidth, grid_height: gridHeight })
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

export async function getCells(layoutId: string, companyId: string): Promise<WarehouseCell[]> {
  const { data, error } = await supabase
    .from('warehouse_cells').select('*').eq('layout_id', layoutId).eq('company_id', companyId).order('y').order('x');
  if (error) { console.error('[Slotting] Error loading cells:', error); return []; }
  return data as WarehouseCell[];
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

/** Sobe a imagem da planta para o Storage privado e salva o caminho no layout — o app
 *  não tinha nenhum pipeline de upload até aqui; PDF/DWG com parsing automático continua
 *  fora de escopo (decisão confirmada), então só aceitamos imagem (PNG/JPG/SVG). */
export async function uploadFloorPlanImage(companyId: string, layoutId: string, file: File, userId: string, userEmail: string): Promise<string | null> {
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
