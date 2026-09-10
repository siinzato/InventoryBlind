// Warehouse Digital Twin — indicadores do resumo da Central Operacional (Imagem 1).
// Funções puras, mesmo espírito de slottingEngine.ts/warehouseInsightsEngine.ts: recebem
// dados já carregados (cells/liveData, já reais e já paginados por warehouseTwinService.ts)
// e só agregam — nenhum score novo é calculado aqui.

import type { WarehouseCell, LocationLiveStatus } from './supabase';

export interface OccupancySummary {
  pct: number;
  /** 'capacity' quando pelo menos uma posição tem `capacity` configurada (ocupação =
   *  quantidade armazenada ÷ capacidade total); 'presenca' quando nenhuma tem, e a
   *  ocupação vira posições com saldo>0 ÷ posições utilizáveis (endereço cadastrado). */
  method: 'capacity' | 'presenca';
}

/** Ocupação consolidada — null só quando não há nenhuma posição utilizável ainda (planta
 *  sem estrutura desenhada), nunca 0 forçado nesse caso (0 significaria "vazio", que é
 *  uma informação diferente de "não há como calcular"). */
export function computeOccupancySummary(
  cells: WarehouseCell[],
  liveData: Map<string, LocationLiveStatus>
): OccupancySummary | null {
  const usable = cells.filter(c => c.cell_type === 'posicao' && c.location_code);
  if (usable.length === 0) return null;

  const withCapacity = usable.filter(c => c.capacity != null && c.capacity > 0);
  if (withCapacity.length > 0) {
    let stored = 0;
    let capacityTotal = 0;
    for (const c of withCapacity) {
      capacityTotal += c.capacity as number;
      stored += liveData.get(c.location_code!)?.stockQuantity ?? 0;
    }
    return { pct: capacityTotal > 0 ? Math.min(100, Math.max(0, (stored / capacityTotal) * 100)) : 0, method: 'capacity' };
  }

  const occupied = usable.filter(c => (liveData.get(c.location_code!)?.stockQuantity ?? 0) > 0).length;
  return { pct: (occupied / usable.length) * 100, method: 'presenca' };
}

/** Endereços ativos = posições da grade publicada com um location_code vinculado. */
export function countActiveAddresses(cells: WarehouseCell[]): number {
  return cells.filter(c => c.cell_type === 'posicao' && !!c.location_code).length;
}

/** Divergências abertas = nº de posições com pelo menos uma divergência (RCA) registrada
 *  contra o SKU ali armazenado. Deliberadamente a MESMA base de dado que já colore a
 *  camada "Divergência" do mapa (`LocationLiveStatus.divergenceCount`) — nunca uma segunda
 *  fórmula calculando "divergência" de outro jeito, para o card do resumo e o mapa nunca
 *  poderem divergir entre si (a mesma lição do bug de acuracidade do fechamento de linha:
 *  uma fonte só). O InventoryBlind não tem um conceito de "divergência resolvida/aberta"
 *  com lifecycle próprio — isto conta ocorrências registradas, não pendências de correção. */
export function countOpenDivergencePositions(liveData: Map<string, LocationLiveStatus>): number {
  let count = 0;
  for (const status of liveData.values()) {
    if (status.divergenceCount > 0) count += 1;
  }
  return count;
}

/** Horário do evento operacional mais recente dentre uma lista de timestamps ISO já
 *  coletados pelo chamador (picks/contagens/divergências) — null quando não há nenhum
 *  evento ainda, nunca "agora" fabricado. */
export function findLatestEventAt(timestamps: (string | null | undefined)[]): string | null {
  const valid = timestamps.filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  if (valid.length === 0) return null;
  return valid.reduce((latest, t) => (t > latest ? t : latest));
}
