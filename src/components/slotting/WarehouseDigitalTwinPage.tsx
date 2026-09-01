import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  // `Map` is aliased: the unaliased lucide import shadows the global Map
  // constructor, and this file builds `new Map(...)` lookups.
  Map as MapIcon, Warehouse, Footprints, TrendingUp, Settings2, Maximize2, Minimize2,
} from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, StatRow, StatCell, Stat, SegmentedControl } from '../ui';
import { getPublishedLayout, getDraftLayout, getCells, getZones, getPickCountsByLocation, getInProgressActivityCount } from '../../lib/slottingLayoutService';
import { getLiveLayerData, getLatestPickEventAt } from '../../lib/warehouseTwinService';
import { computeInsights } from '../../lib/warehouseInsightsEngine';
import { computeOccupancySummary, countActiveAddresses, countOpenDivergencePositions, findLatestEventAt } from '../../lib/warehouseOperationalSummary';
import { resolveTwinState, TWIN_STATE_MESSAGE } from '../../lib/warehouseLayoutPublishing';
import { findExpeditionCell, computeSkuDistances, computeCorridorTraffic } from '../../lib/slottingEngine';
import { SlottingDashboardPage } from './SlottingDashboardPage';
import { WarehouseHeatmap } from './WarehouseHeatmap';
import { LiveWarehouseMap } from './LiveWarehouseMap';
import { WarehousePositionDrawer } from './WarehousePositionDrawer';
import { WarehouseInsightsStrip } from './WarehouseInsightsStrip';
import { PickingReplay } from './PickingReplay';
import { WarehouseAnalyticsPanel } from './WarehouseAnalyticsPanel';
import { RecommendationsPanel } from './RecommendationsPanel';
import { LayoutConfiguratorWizard } from './LayoutConfiguratorWizard';
import type { WarehouseLayout, WarehouseCell, WarehouseZone, LocationLiveStatus, WarehouseLiveLayer } from '../../lib/supabase';

interface WarehouseDigitalTwinPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role?: string;
  onNavigateToCount?: () => void;
}

type MainTab = 'operacao' | 'layout' | 'replay' | 'analises';

const MAIN_TABS: { value: MainTab; label: string; icon: typeof MapIcon }[] = [
  { value: 'operacao', label: 'Operação', icon: MapIcon },
  { value: 'layout', label: 'Layout e slotting', icon: Warehouse },
  { value: 'replay', label: 'Replay', icon: Footprints },
  { value: 'analises', label: 'Análises', icon: TrendingUp },
];

function formatSyncLabel(latestEventAt: string | null, loadedAt: Date | null): string {
  if (!loadedAt) return 'Sincronizando...';
  if (!latestEventAt) return `Sem eventos registrados ainda · lido às ${loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const eventTime = new Date(latestEventAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `Baseado em operações registradas até ${eventTime}`;
}

/** Composição raiz do Warehouse Digital Twin — Fase 1 (2D). Evolui o mesmo modelo de grade
 *  do Slotting Intelligence (warehouse_layouts/warehouse_cells) em vez de reescrever a
 *  engine espacial: nenhuma tela aqui recalcula risco/confidence/ABC-XYZ/BFS, tudo é lido
 *  de warehouseTwinService.ts/slottingEngine.ts, já testados. Removidos desta versão:
 *  "Simulação ao vivo" e "Modo Apresentação" fictícios (fabricavam ocupação/rota) — o
 *  Modo apresentação agora só amplia o mapa e esconde a navegação, sem alterar nenhum dado. */
export function WarehouseDigitalTwinPage({ companyId, userId, userEmail, role, onNavigateToCount }: WarehouseDigitalTwinPageProps) {
  const canEdit = role === 'owner' || role === 'admin' || role === 'manager';

  const [layout, setLayout] = useState<WarehouseLayout | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [cells, setCells] = useState<WarehouseCell[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [liveData, setLiveData] = useState<Map<string, LocationLiveStatus>>(new Map());
  const [pickCounts, setPickCounts] = useState<Map<string, number>>(new Map());
  const [inProgressCount, setInProgressCount] = useState(0);
  const [latestEventAt, setLatestEventAt] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [tab, setTab] = useState<MainTab>('operacao');
  const [mapLayer, setMapLayer] = useState<WarehouseLiveLayer>('ocupacao');
  const [selectedCell, setSelectedCell] = useState<WarehouseCell | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusLocationCode, setFocusLocationCode] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [publishedLayout, draft] = await Promise.all([getPublishedLayout(companyId), getDraftLayout(companyId)]);
      setLayout(publishedLayout);
      setHasDraft(!!draft);

      if (publishedLayout) {
        const [cellRows, zoneRows, counts, latestPick, inProgress] = await Promise.all([
          getCells(publishedLayout.id, companyId),
          getZones(publishedLayout.id, companyId),
          getPickCountsByLocation(companyId),
          getLatestPickEventAt(companyId),
          getInProgressActivityCount(companyId),
        ]);
        setCells(cellRows);
        setZones(zoneRows);
        setPickCounts(counts);
        setLatestEventAt(latestPick);
        setInProgressCount(inProgress);
        const live = await getLiveLayerData(companyId, publishedLayout.id, cellRows);
        setLiveData(live);
      } else {
        setCells([]); setZones([]); setPickCounts(new Map()); setLiveData(new Map()); setLatestEventAt(null); setInProgressCount(0);
      }
      setLoadedAt(new Date());
    } catch (err) {
      console.error('[WarehouseTwin] Error loading Digital Twin data:', err);
      setLoadError(true);
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
  const occupancy = useMemo(() => computeOccupancySummary(cells, liveData), [cells, liveData]);
  const activeAddresses = useMemo(() => countActiveAddresses(cells), [cells]);
  const openDivergences = useMemo(() => countOpenDivergencePositions(liveData), [liveData]);
  const lastEventLabel = useMemo(() => {
    const latest = findLatestEventAt([latestEventAt]);
    return latest ? new Date(latest).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  }, [latestEventAt]);

  const twinState = useMemo(() => {
    const knownLocations = new Set(cells.filter(c => c.location_code).map(c => c.location_code as string));
    let totalEvents = 0;
    let positionedEvents = 0;
    for (const [locationCode, count] of pickCounts) {
      totalEvents += count;
      if (knownLocations.has(locationCode)) positionedEvents += count;
    }
    return resolveTwinState({
      canEdit, loading, loadError, publishedLayout: layout, hasDraftLayout: hasDraft, cells,
      totalEvents, positionedEvents, sourceConnected: true,
    });
  }, [canEdit, loading, loadError, layout, hasDraft, cells, pickCounts]);

  const handleSelectPosition = (cell: WarehouseCell) => { setSelectedCell(cell); setDrawerOpen(true); };
  const handleFocus = useCallback((locationCode: string) => {
    setTab('operacao');
    setFocusLocationCode(locationCode);
    const cell = cells.find(c => c.location_code === locationCode);
    if (cell) { setSelectedCell(cell); setDrawerOpen(true); }
  }, [cells]);

  if (loading && !layout) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8">
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Warehouse Digital Twin...</PanelSection></Panel>
      </div>
    );
  }

  if (twinState.primary !== 'ready') {
    return (
      <>
        <Page width="wide">
          <PageHeader
            title="Warehouse Digital Twin"
            description="O que está acontecendo agora no seu armazém — mapa vivo, replay operacional e insights automáticos."
            actions={canEdit && <Button size="sm" onClick={() => setWizardOpen(true)}><Settings2 size={14} /> Configurar planta</Button>}
          />
          <Panel>
            <PanelSection padding="lg" className="text-center space-y-3">
              <p className="text-sm text-fg-muted max-w-md mx-auto">{TWIN_STATE_MESSAGE[twinState.primary]}</p>
              {twinState.primary === 'load_error' && <Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button>}
              {canEdit && (twinState.primary === 'no_layout' || twinState.primary === 'draft_unpublished' || twinState.primary === 'no_scale' || twinState.primary === 'no_addresses') && (
                <Button size="sm" onClick={() => setWizardOpen(true)}><Settings2 size={14} /> Configurar planta</Button>
              )}
            </PanelSection>
          </Panel>
        </Page>
        {canEdit && (
          <LayoutConfiguratorWizard
            companyId={companyId} userId={userId} userEmail={userEmail}
            open={wizardOpen} onClose={() => setWizardOpen(false)}
            onPublished={() => { setWizardOpen(false); load(); }}
          />
        )}
      </>
    );
  }

  const selectedStatus = selectedCell?.location_code ? liveData.get(selectedCell.location_code) ?? null : null;

  const operationTabContent = (
    <>
      <PageHeader
        title="Warehouse Digital Twin"
        description="O que está acontecendo agora no seu armazém — mapa vivo, replay operacional e insights automáticos sobre a planta publicada."
        actions={
          <>
            <Badge variant="neutral">{formatSyncLabel(latestEventAt, loadedAt)}</Badge>
            {canEdit && !presentationMode && <Button size="sm" variant="secondary" onClick={() => setWizardOpen(true)}><Settings2 size={14} /> Configurar planta</Button>}
            <Button size="sm" variant={presentationMode ? 'primary' : 'secondary'} onClick={() => setPresentationMode(p => !p)} aria-pressed={presentationMode}>
              {presentationMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {presentationMode ? 'Sair da apresentação' : 'Modo apresentação'}
            </Button>
          </>
        }
      />

      <Panel>
        <PanelSection padding="md">
          <StatRow>
            <StatCell><Stat label="Ocupação" value={occupancy ? `${Math.round(occupancy.pct)}%` : '—'} context={occupancy ? (occupancy.method === 'capacity' ? 'Por capacidade cadastrada' : 'Por presença de saldo (sem capacidade cadastrada)') : 'Sem posições cadastradas'} /></StatCell>
            <StatCell><Stat label="Endereços ativos" value={activeAddresses.toLocaleString('pt-BR')} /></StatCell>
            <StatCell><Stat label="Atividades em andamento" value={inProgressCount.toLocaleString('pt-BR')} context="Operações Full iniciadas e ainda não concluídas" /></StatCell>
            <StatCell><Stat label="Divergências abertas" value={openDivergences.toLocaleString('pt-BR')} /></StatCell>
            <StatCell><Stat label="Último evento" value={lastEventLabel} /></StatCell>
          </StatRow>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <LiveWarehouseMap
            layout={layout!} cells={cells} liveData={liveData} traffic={traffic}
            layer={mapLayer} onLayerChange={setMapLayer} onSelectPosition={handleSelectPosition}
            focusLocationCode={focusLocationCode} zones={zones}
          />
        </PanelSection>
      </Panel>

      <WarehouseInsightsStrip insights={insights} onFocus={handleFocus} />
    </>
  );

  return (
    <>
      {presentationMode ? (
        <div className="fixed inset-0 z-[1000] bg-surface overflow-y-auto p-4 md:p-6">
          <div className="max-w-6xl mx-auto space-y-4">{operationTabContent}</div>
        </div>
      ) : (
        <Page width="wide">
          {tab === 'operacao' && operationTabContent}

          <SegmentedControl label="Seção do Digital Twin" options={MAIN_TABS.map(t => ({ value: t.value, label: t.label }))} value={tab} onChange={setTab} />

          {tab === 'layout' && (
            <div className="space-y-4">
              <SlottingDashboardPage companyId={companyId} userId={userId} userEmail={userEmail} role={role} />
              <Panel>
                <PanelSection padding="md">
                  <p className="text-section mb-3">Ocupação × Giro (tráfego real)</p>
                  <WarehouseHeatmap layout={layout!} cells={cells} traffic={traffic} />
                </PanelSection>
              </Panel>
              <Panel>
                <PanelSection padding="md">
                  <p className="text-section mb-3">Endereços vazios / capacidade</p>
                  <LiveWarehouseMap layout={layout!} cells={cells} liveData={liveData} traffic={traffic} layer="vazios" onSelectPosition={handleSelectPosition} lockLayer zones={zones} />
                </PanelSection>
              </Panel>
              <RecommendationsPanel companyId={companyId} layoutId={layout!.id} userId={userId} userEmail={userEmail} canEdit={canEdit} />
            </div>
          )}

          {tab === 'replay' && (
            <PickingReplay companyId={companyId} layout={layout!} cells={cells} onSelectPosition={handleSelectPosition} />
          )}

          {tab === 'analises' && (
            <WarehouseAnalyticsPanel companyId={companyId} layout={layout} cells={cells} zones={zones} liveData={liveData} />
          )}
        </Page>
      )}

      <WarehousePositionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        companyId={companyId}
        cell={selectedCell}
        status={selectedStatus}
        cells={cells}
        cellSizeMeters={layout!.cell_size_meters}
        onCreateCount={onNavigateToCount}
      />

      {canEdit && (
        <LayoutConfiguratorWizard
          companyId={companyId} userId={userId} userEmail={userEmail}
          open={wizardOpen} onClose={() => setWizardOpen(false)}
          onPublished={() => { setWizardOpen(false); load(); }}
        />
      )}
    </>
  );
}
