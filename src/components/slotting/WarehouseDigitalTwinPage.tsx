import { useEffect, useState, useCallback, useMemo } from 'react';
import { Radio, Sparkles } from 'lucide-react';
import { PageHeader, Panel, PanelSection, Badge } from '../ui';
import { getActiveLayout, getCells, getPickCountsByLocation } from '../../lib/slottingLayoutService';
import { getLiveLayerData } from '../../lib/warehouseTwinService';
import { computeInsights } from '../../lib/warehouseInsightsEngine';
import { generateDemoBundle, generateDemoRoute } from '../../lib/warehouseDemoData';
import { findExpeditionCell, computeSkuDistances, computeCorridorTraffic } from '../../lib/slottingEngine';
import { SlottingDashboardPage } from './SlottingDashboardPage';
import { WarehouseHeatmap } from './WarehouseHeatmap';
import { FloorPlanUploadControl } from './FloorPlanUploadControl';
import { LiveWarehouseMap } from './LiveWarehouseMap';
import { WarehousePositionDrawer } from './WarehousePositionDrawer';
import { WarehouseInsightsStrip } from './WarehouseInsightsStrip';
import { WarehouseTimelinePanel } from './WarehouseTimelinePanel';
import { PickingReplay } from './PickingReplay';
import { WarehouseAnalyticsPanel } from './WarehouseAnalyticsPanel';
import { RecommendationsPanel } from './RecommendationsPanel';
import type { WarehouseLayout, WarehouseCell, LocationLiveStatus, WarehouseLiveLayer } from '../../lib/supabase';

interface WarehouseDigitalTwinPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role?: string;
}

type SubModule = 'mapa' | 'slotting' | 'heatmaps' | 'replay' | 'analytics' | 'ocupacao' | 'divergencias' | 'recomendacoes';

const SUBMODULES: { id: SubModule; label: string; icon: string }[] = [
  { id: 'mapa', label: 'Mapa', icon: '🗺️' },
  { id: 'slotting', label: 'Slotting', icon: '📦' },
  { id: 'heatmaps', label: 'Heatmaps', icon: '🔥' },
  { id: 'replay', label: 'Picking Replay', icon: '🚶' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'ocupacao', label: 'Ocupação', icon: '📊' },
  { id: 'divergencias', label: 'Divergências', icon: '⚠️' },
  { id: 'recomendacoes', label: 'Recomendações', icon: '🤖' },
];

/** Composição raiz da Fase 3 (Warehouse Digital Twin). Não toca em nenhum arquivo do
 *  Slotting Intelligence existente — a aba "Slotting" embute SlottingDashboardPage
 *  inalterado (editor/simulador/recomendações/rankings continuam exatamente como eram),
 *  e as outras 7 abas são views novas sobre a mesma leitura (layout/cells) já carregada
 *  aqui, mais o merge de camadas feito por warehouseTwinService.ts. */
export function WarehouseDigitalTwinPage({ companyId, userId, userEmail, role }: WarehouseDigitalTwinPageProps) {
  const canEdit = role === 'owner' || role === 'admin' || role === 'manager';

  const [layout, setLayout] = useState<WarehouseLayout | null>(null);
  const [cells, setCells] = useState<WarehouseCell[]>([]);
  const [liveData, setLiveData] = useState<Map<string, LocationLiveStatus>>(new Map());
  const [pickCounts, setPickCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [submodule, setSubmodule] = useState<SubModule>('mapa');
  const [mapLayer, setMapLayer] = useState<WarehouseLiveLayer>('ocupacao');
  const [selectedCell, setSelectedCell] = useState<WarehouseCell | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusLocationCode, setFocusLocationCode] = useState<string | null>(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const activeLayout = await getActiveLayout(companyId);
    setLayout(activeLayout);
    if (activeLayout) {
      const [cellRows, counts] = await Promise.all([
        getCells(activeLayout.id, companyId),
        getPickCountsByLocation(companyId),
      ]);
      setCells(cellRows);
      setPickCounts(counts);
      const live = await getLiveLayerData(companyId, activeLayout.id, cellRows);
      setLiveData(live);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const traffic = useMemo(() => {
    if (!layout) return new Map<string, number>();
    const expedition = findExpeditionCell(cells);
    if (!expedition) return new Map<string, number>();
    const skuDistances = computeSkuDistances(cells, { x: expedition.x, y: expedition.y }, pickCounts, layout.cell_size_meters);
    return computeCorridorTraffic(skuDistances);
  }, [layout, cells, pickCounts]);

  const insights = useMemo(() => computeInsights(cells, liveData, traffic), [cells, liveData, traffic]);

  // Modo Apresentação: fabrica ocupação/risco/insights sobre a MESMA grade real (nunca
  // grava nada) — ligar o modo liga junto a simulação ambiente, para o presenter não
  // precisar lembrar de acionar as duas coisas separadamente.
  const demoBundle = useMemo(() => (demoMode ? generateDemoBundle(cells) : null), [demoMode, cells]);
  const demoRoute = useMemo(() => (demoMode ? generateDemoRoute(cells) : null), [demoMode, cells]);
  const demoInsights = useMemo(
    () => (demoBundle ? computeInsights(cells, demoBundle.liveData, demoBundle.traffic) : null),
    [demoBundle, cells]
  );
  useEffect(() => { if (demoMode) setSimulationActive(true); }, [demoMode]);

  const effectiveLiveData = demoBundle?.liveData ?? liveData;
  const effectiveTraffic = demoBundle?.traffic ?? traffic;
  const effectiveInsights = demoInsights ?? insights;

  const handleSelectPosition = (cell: WarehouseCell) => {
    setSelectedCell(cell);
    setDrawerOpen(true);
  };

  /** "Detectou problema → clica → mapa foca": muda de aba se preciso, dispara o zoom/
   *  destaque automático da câmera e já abre o painel de posição. */
  const handleFocus = useCallback((locationCode: string) => {
    setSubmodule('mapa');
    setFocusLocationCode(locationCode);
    const cell = cells.find(c => c.location_code === locationCode);
    if (cell) { setSelectedCell(cell); setDrawerOpen(true); }
  }, [cells]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8">
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Warehouse Digital Twin...</PanelSection></Panel>
      </div>
    );
  }

  if (!layout) {
    return <SlottingDashboardPage companyId={companyId} userId={userId} userEmail={userEmail} role={role} />;
  }

  const selectedStatus = selectedCell?.location_code ? effectiveLiveData.get(selectedCell.location_code) ?? null : null;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Warehouse Digital Twin"
        description="O que está acontecendo agora no seu armazém — mapa vivo, replay de picking e insights automáticos sobre a mesma grade do Slotting Intelligence."
        actions={
          <>
            <button
              onClick={() => setSimulationActive(a => !a)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                simulationActive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'
              }`}
              title="Pulsos visuais de atividade — não é um feed de posição em tempo real"
            >
              <Radio size={13} /> Simulação ao vivo
            </button>
            <button
              onClick={() => setDemoMode(d => !d)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                demoMode ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'
              }`}
              title="Preenche o mapa com dados fictícios para demonstração comercial"
            >
              <Sparkles size={13} /> Modo Apresentação
            </button>
          </>
        }
      />

      {demoMode && (
        <Badge variant="accent">🎭 Modo Apresentação ativo — ocupação, insights e rota são fictícios, nada é salvo</Badge>
      )}

      <WarehouseInsightsStrip insights={effectiveInsights} onFocus={handleFocus} />

      <div className="flex flex-wrap gap-1.5">
        {SUBMODULES.map(s => (
          <button
            key={s.id}
            onClick={() => setSubmodule(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              submodule === s.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:bg-surface-3'
            }`}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {submodule === 'mapa' && (
        <>
          {canEdit && (
            <Panel>
              <PanelSection padding="md">
                <p className="text-section mb-3">Planta do Armazém</p>
                <FloorPlanUploadControl companyId={companyId} userId={userId} userEmail={userEmail} layout={layout} onChanged={load} />
              </PanelSection>
            </Panel>
          )}
          <Panel>
            <PanelSection padding="md">
              <LiveWarehouseMap
                layout={layout} cells={cells} liveData={effectiveLiveData} traffic={effectiveTraffic}
                layer={mapLayer} onLayerChange={setMapLayer} onSelectPosition={handleSelectPosition}
                focusLocationCode={focusLocationCode} simulationActive={simulationActive}
              />
            </PanelSection>
          </Panel>
          <WarehouseTimelinePanel
            companyId={companyId} layoutId={layout.id} layout={layout} cells={cells}
            onSelectPosition={handleSelectPosition}
          />
        </>
      )}

      {submodule === 'slotting' && (
        <SlottingDashboardPage companyId={companyId} userId={userId} userEmail={userEmail} role={role} />
      )}

      {submodule === 'heatmaps' && (
        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Heatmap de Tráfego</p>
            <WarehouseHeatmap layout={layout} cells={cells} traffic={traffic} />
          </PanelSection>
        </Panel>
      )}

      {submodule === 'replay' && (
        <PickingReplay companyId={companyId} layout={layout} cells={cells} demoRoute={demoRoute} />
      )}

      {submodule === 'analytics' && (
        <WarehouseAnalyticsPanel companyId={companyId} />
      )}

      {submodule === 'ocupacao' && (
        <Panel>
          <PanelSection padding="md">
            <LiveWarehouseMap
              layout={layout} cells={cells} liveData={effectiveLiveData} traffic={effectiveTraffic}
              layer="ocupacao" onSelectPosition={handleSelectPosition} lockLayer
            />
          </PanelSection>
        </Panel>
      )}

      {submodule === 'divergencias' && (
        <Panel>
          <PanelSection padding="md">
            <LiveWarehouseMap
              layout={layout} cells={cells} liveData={effectiveLiveData} traffic={effectiveTraffic}
              layer="divergencia" onSelectPosition={handleSelectPosition} lockLayer
            />
          </PanelSection>
        </Panel>
      )}

      {submodule === 'recomendacoes' && (
        <RecommendationsPanel companyId={companyId} layoutId={layout.id} userId={userId} userEmail={userEmail} canEdit={canEdit} />
      )}

      <WarehousePositionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        companyId={companyId}
        cell={selectedCell}
        status={selectedStatus}
        cells={cells}
        cellSizeMeters={layout.cell_size_meters}
      />
    </div>
  );
}
