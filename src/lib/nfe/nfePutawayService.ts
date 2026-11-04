// Leitura e escrita do endereçamento do recebimento.
//
// A escrita é uma RPC só (`nfe_putaway_item`, migration 124), que valida o lado da
// NOTA — nota finalizada, item com produto, não endereçar mais do que foi conferido —
// e delega o endereçamento para `wms_bin_putaway`, que já cobra endereço bloqueado,
// capacidade declarada e pack divergente. Duas validações em camadas diferentes, uma
// implementação de cada regra.

import { supabase } from '../supabase';
import type { PutawayAssignment } from './nfePutawayDomain';

interface AssignmentRow {
  id: string;
  item_id: string;
  bin_code: string;
  boxes: number;
  units_per_box: number;
  units: number;
  created_at: string;
}

const COLUNAS = 'id, item_id, bin_code, boxes, units_per_box, units, created_at';

export async function listInvoiceAssignments(invoiceId: string): Promise<PutawayAssignment[]> {
  const { data, error } = await supabase
    .from('nfe_putaway_assignments')
    .select(COLUNAS)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r: AssignmentRow) => ({
    id: r.id,
    itemId: r.item_id,
    binCode: r.bin_code,
    boxes: r.boxes,
    unitsPerBox: r.units_per_box,
    units: r.units,
    createdAt: r.created_at,
  }));
}

export interface ExistingSpot {
  binCode: string;
  boxes: number;
  unitsPerBox: number;
  blocked: boolean;
}

/** Onde cada um destes produtos já está guardado.
 *
 *  É a única sugestão que a tela dá, e é a que vale: juntar a mercadoria nova onde a
 *  mesma já está evita espalhar um SKU por cinco endereços. Vem numa consulta só para
 *  a nota inteira — uma por item transformaria uma nota de 60 linhas em 60 idas ao
 *  banco. Endereço bloqueado vem junto, marcado, porque some da lista de opções mas
 *  explica onde o resto da mercadoria está. */
export async function binsHoldingProducts(productIds: string[]): Promise<Map<string, ExistingSpot[]>> {
  const mapa = new Map<string, ExistingSpot[]>();
  const unicos = [...new Set(productIds)];
  if (unicos.length === 0) return mapa;

  const { data, error } = await supabase
    .from('wms_product_stock_v')
    .select('product_id, bin_code, boxes, units_per_box, bin_blocked')
    .in('product_id', unicos)
    .order('first_stored_at', { ascending: true });

  if (error) throw error;
  for (const r of (data ?? []) as {
    product_id: string; bin_code: string; boxes: number; units_per_box: number; bin_blocked: boolean;
  }[]) {
    const spot: ExistingSpot = {
      binCode: r.bin_code, boxes: r.boxes, unitsPerBox: r.units_per_box, blocked: r.bin_blocked,
    };
    const lista = mapa.get(r.product_id);
    if (lista) lista.push(spot);
    else mapa.set(r.product_id, [spot]);
  }
  return mapa;
}

export interface PlaceParams {
  itemId: string;
  binCode: string;
  boxes: number;
  unitsPerBox: number;
}

/** Endereça uma parte do item. Devolve o id do movimento gerado no Pulmão.
 *
 *  Os erros do banco sobem como estão: são frases escritas para o operador
 *  ("Capacidade do endereço PP-A01-N1 excedida: 40 de 40 caixas ocupadas"), e
 *  traduzi-las aqui só acrescentaria uma camada onde a mensagem envelhece. */
export async function placeItem(params: PlaceParams): Promise<string> {
  const { data, error } = await supabase.rpc('nfe_putaway_item', {
    p_item_id: params.itemId,
    p_bin_code: params.binCode,
    p_boxes: params.boxes,
    p_units_per_box: params.unitsPerBox,
  });

  if (error) throw new Error(error.message);
  return data as string;
}
