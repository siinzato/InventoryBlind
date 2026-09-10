// Warehouse Digital Twin — Modo Apresentação. Fabrica ocupação/risco/confidence/ABC-XYZ/
// divergência/recomendações plausíveis sobre a MESMA grade real da empresa (layout/cells
// não são alterados, nada é gravado no banco) — para demonstrações comerciais em contas
// novas ou vazias. Alimenta os mesmos componentes e motores já existentes
// (computeInsights, LiveWarehouseMap, PickingReplay) com dados fictícios em vez de reais.
// Sempre exibido atrás de um badge visível "Modo Apresentação" no chamador — nunca deve
// ser confundido com dados reais da empresa.

import type {
  WarehouseCell, LocationLiveStatus, AbcClass, XyzClass, RiskBand, RiskLevel, WarehouseSlottingRecommendation,
} from './supabase';

const ABC_CLASSES: AbcClass[] = ['A', 'B', 'C'];
const XYZ_CLASSES: XyzClass[] = ['X', 'Y', 'Z'];

// Mesmas faixas de riskAlgorithm.ts/cbcAlgorithm.ts, só para colorir o dado fictício de
// forma consistente com o resto do app — não recalcula nem reusa o algoritmo real.
function riskBandFor(score: number): RiskBand {
  if (score >= 90) return 'critico';
  if (score >= 70) return 'alto';
  if (score >= 50) return 'medio';
  return 'baixo';
}

function confidenceLevelFor(score: number): RiskLevel {
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'bom';
  if (score >= 50) return 'medio';
  return 'critico';
}

function corridorOf(locationCode: string): string {
  return locationCode.split('-')[0] || locationCode;
}

export interface WarehouseDemoBundle {
  liveData: Map<string, LocationLiveStatus>;
  traffic: Map<string, number>;
}

/** Fabrica o estado completo da grade real — ocupação total ("mapa cheio"), com dois
 *  corredores propositalmente amplificados (mais divergência, mais tráfego) para que os
 *  cards de insight automático (motor real, não texto fixo) tenham algo relevante para
 *  destacar durante a demonstração. */
export function generateDemoBundle(cells: WarehouseCell[]): WarehouseDemoBundle {
  const posicoes = cells.filter(c => c.cell_type === 'posicao' && c.location_code);
  const corridors = Array.from(new Set(posicoes.map(c => corridorOf(c.location_code!)))).sort();
  const hotDivergenceCorridor = corridors[0];
  const hotTrafficCorridor = corridors[1] ?? corridors[0];
  const locations = posicoes.map(c => c.location_code!);

  const liveData = new Map<string, LocationLiveStatus>();
  const traffic = new Map<string, number>();

  posicoes.forEach((cell, i) => {
    const locationCode = cell.location_code!;
    const corridor = corridorOf(locationCode);
    const riskScore = Math.round(20 + Math.random() * 75);
    const confidenceScore = Math.round(40 + Math.random() * 58);
    const pickCount = Math.round(3 + Math.random() * 25);
    const divergenceCount = corridor === hotDivergenceCorridor
      ? Math.round(4 + Math.random() * 6)
      : Math.random() < 0.2 ? Math.round(Math.random() * 2) : 0;
    const abcClass = ABC_CLASSES[i % ABC_CLASSES.length];
    const xyzClass = XYZ_CLASSES[Math.floor(i / 3) % XYZ_CLASSES.length];

    const recommendation: WarehouseSlottingRecommendation | null = Math.random() < 0.12 ? {
      id: `demo-${locationCode}`,
      company_id: 'demo',
      layout_id: 'demo',
      product_id: null,
      recommendation_type: 'aproximar_expedicao',
      current_location: locationCode,
      suggested_location: locations[(i + 5) % locations.length] ?? null,
      estimated_meters_saved: Math.round(8 + Math.random() * 24),
      estimated_time_saved_seconds: Math.round(30 + Math.random() * 90),
      estimated_productivity_gain_pct: Math.round(8 + Math.random() * 22),
      status: 'pendente',
      reason: 'SKU de alto giro distante da expedição — aproximar reduz o percurso médio de picking.',
      created_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
    } : null;

    liveData.set(locationCode, {
      locationCode,
      productId: `demo-${locationCode}`,
      sku: `DEMO-${1000 + i}`,
      productName: `Produto Demonstração ${i + 1}`,
      stockQuantity: Math.round(10 + Math.random() * 200),
      occupied: true,
      pickCount,
      riskScore,
      riskLevel: riskBandFor(riskScore),
      riskReason: 'Dados de demonstração — combina divergência, giro e ocupação fictícios.',
      confidenceScore,
      confidenceLevel: confidenceLevelFor(confidenceScore),
      confidenceTopReasons: ['Última contagem recente (demonstração)', 'Frequência de atualização estável (demonstração)'],
      abcClass,
      xyzClass,
      valueMoved: Math.round(500 + Math.random() * 15000),
      divergenceCount,
      lastCountAt: new Date(Date.now() - Math.random() * 20 * 86400000).toISOString(),
      lastDivergenceAt: divergenceCount > 0 ? new Date(Date.now() - Math.random() * 10 * 86400000).toISOString() : null,
      recommendation,
    });

    traffic.set(`${cell.x},${cell.y}`, corridor === hotTrafficCorridor ? pickCount * 3 : pickCount);
  });

  return { liveData, traffic };
}

export interface DemoRoute {
  label: string;
  stops: { x: number; y: number }[];
}

/** Rota fabricada para o Picking Replay em Modo Apresentação — usa posições reais da
 *  grade e o mesmo pathfinding real (computeRouteThroughStops), só a escolha das paradas
 *  é fictícia. */
export function generateDemoRoute(cells: WarehouseCell[]): DemoRoute | null {
  const posicoes = cells.filter(c => c.cell_type === 'posicao');
  if (posicoes.length < 3) return null;
  const stride = Math.max(1, Math.floor(posicoes.length / 4));
  const idxs = Array.from(new Set([0, stride, stride * 2, stride * 3].map(i => i % posicoes.length)));
  return {
    label: 'Pedido Full #24871 (demonstração)',
    stops: idxs.map(i => ({ x: posicoes[i].x, y: posicoes[i].y })),
  };
}
