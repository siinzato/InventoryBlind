// Warehouse Digital Twin — timeline histórica. Arquitetura preparada, dados mockados por
// enquanto (pedido explícito: "não precisa criar backend real agora, usando dados
// mockados"). Retorna o snapshot vivo atual rotulado como prévia (isMock: true) — quando
// existir persistência histórica real (ex.: tabela de snapshots diários), só esta função
// muda: a assinatura e o tipo de retorno (WarehouseSnapshot) já são os definitivos, então
// nenhum consumidor (WarehouseTimelinePanel.tsx) precisa mudar.

import type { WarehouseCell, WarehouseSnapshot } from './supabase';
import { getLiveLayerData } from './warehouseTwinService';

export function listSnapshotDates(days = 30): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

export async function getSnapshotForDate(
  companyId: string,
  layoutId: string,
  cells: WarehouseCell[],
  date: string
): Promise<WarehouseSnapshot> {
  const liveData = await getLiveLayerData(companyId, layoutId, cells);
  return { date, layoutId, cells, liveData, isMock: true };
}
