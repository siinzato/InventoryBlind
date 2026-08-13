import { useEffect, useState, useCallback } from 'react';
import { PackageOpen, Route, Footprints, Clock, TrendingUp, Check, X, Clock3, PenSquare, RefreshCw } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Button, Badge, ListRow } from '../ui';
import { supabase } from '../../lib/supabase';
import {
  getActiveLayout, createLayout, getCells, getPickCountsByLocation, getPickRecords,
} from '../../lib/slottingLayoutService';
import {
  generateRecommendations, getRecommendations, decideRecommendation, getOptimizationHistory,
} from '../../lib/slottingRecommendationService';
import {
  findExpeditionCell, computeSkuDistances, computeOperatorDistances, computeCorridorTraffic,
  estimatePickingTimeSeconds, findUnderutilizedPositions, SkuDistanceResult,
} from '../../lib/slottingEngine';
import { LayoutEditor } from './LayoutEditor';
import { WarehouseHeatmap } from './WarehouseHeatmap';
import { PickingRouteViewer } from './PickingRouteViewer';
import { SkuMoveSimulator } from './SkuMoveSimulator';
import type { WarehouseLayout, WarehouseCell, WarehouseSlottingRecommendation } from '../../lib/supabase';

interface SlottingDashboardPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
  role?: string;
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  mover_mais_perto: 'Mover para mais perto',
  aproximar_expedicao: 'Aproximar da expedição',
  agrupar_frequentes: 'Agrupar SKUs frequentes',
  redistribuir_fluxo: 'Redistribuir fluxo',
};

export function SlottingDashboardPage({ companyId, userId, userEmail, role }: SlottingDashboardPageProps) {
  const canEdit = role === 'owner' || role === 'admin' || role === 'manager';

  const [layout, setLayout] = useState<WarehouseLayout | null>(null);
  const [cells, setCells] = useState<WarehouseCell[]>([]);
  const [pickCounts, setPickCounts] = useState<Map<string, number>>(new Map());
  const [pickRecords, setPickRecords] = useState<{ locationCode: string; operatorId: string }[]>([]);
  const [operatorNames, setOperatorNames] = useState<Map<string, string>>(new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [recommendations, setRecommendations] = useState<WarehouseSlottingRecommendation[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getOptimizationHistory>>>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Novo layout
  const [newName, setNewName] = useState('Layout Principal');
  const [newWidth, setNewWidth] = useState(20);
  const [newHeight, setNewHeight] = useState(15);
  const [creating, setCreating] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const activeLayout = await getActiveLayout(companyId);
    setLayout(activeLayout);

    if (activeLayout) {
      const [cellRows, counts, records, recs, hist] = await Promise.all([
        getCells(activeLayout.id, companyId),
        getPickCountsByLocation(companyId),
        getPickRecords(companyId),
        getRecommendations(companyId, activeLayout.id, 'pendente'),
        getOptimizationHistory(companyId, activeLayout.id),
      ]);
      setCells(cellRows);
      setPickCounts(counts);
      setPickRecords(records);
      setRecommendations(recs);
      setHistory(hist);

      const [{ data: products }, { data: profiles }] = await Promise.all([
        supabase.from('products').select('name, location').eq('company_id', companyId),
        supabase.from('profiles').select('id, name').eq('company_id', companyId),
      ]);
      setProductNames(new Map((products ?? []).filter(p => p.location).map(p => [p.location as string, p.name as string])));
      setOperatorNames(new Map((profiles ?? []).map(p => [p.id as string, p.name ?? '—'])));
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleCreateLayout = async () => {
    setCreating(true);
    await createLayout(companyId, newName, newWidth, newHeight, userId, userEmail);
    setCreating(false);
    loadAll();
  };

  const handleGenerateRecommendations = async () => {
    if (!layout) return;
    setGenerating(true);
    await generateRecommendations(companyId, layout.id, userId, userEmail);
    const recs = await getRecommendations(companyId, layout.id, 'pendente');
    setRecommendations(recs);
    setGenerating(false);
  };

  const handleDecide = async (id: string, status: 'aprovada' | 'rejeitada' | 'adiada') => {
    await decideRecommendation(id, status, companyId, userId, userEmail);
    if (!layout) return;
    const [recs, hist] = await Promise.all([
      getRecommendations(companyId, layout.id, 'pendente'),
      getOptimizationHistory(companyId, layout.id),
    ]);
    setRecommendations(recs);
    setHistory(hist);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8">
        <Panel><PanelSection padding="lg" className="text-center text-fg-subtle">Carregando Slotting Intelligence...</PanelSection></Panel>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <PageHeader title="Slotting Intelligence" description="Desenhe o layout do seu armazém para começar a otimizar deslocamentos." />
        <Panel>
          <PanelSection padding="lg" className="space-y-4">
            <p className="text-sm text-fg-muted">
              Nenhum layout ainda. Crie uma grade — depois use o editor para marcar ruas, módulos, posições e a expedição.
            </p>
            {canEdit ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Nome</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Largura (colunas)</label>
                    <input type="number" min={2} max={60} value={newWidth} onChange={e => setNewWidth(Number(e.target.value))} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Altura (linhas)</label>
                    <input type="number" min={2} max={60} value={newHeight} onChange={e => setNewHeight(Number(e.target.value))} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg" />
                  </div>
                </div>
                <Button onClick={handleCreateLayout} disabled={creating}>{creating ? 'Criando...' : 'Criar Layout'}</Button>
              </>
            ) : (
              <p className="text-xs text-fg-subtle">Apenas owner/admin/manager podem criar o layout do armazém.</p>
            )}
          </PanelSection>
        </Panel>
      </div>
    );
  }

  const expeditionCell = findExpeditionCell(cells);
  const skuDistances: SkuDistanceResult[] = expeditionCell
    ? computeSkuDistances(cells, { x: expeditionCell.x, y: expeditionCell.y }, pickCounts, layout.cell_size_meters)
    : [];
  const traffic = computeCorridorTraffic(skuDistances);
  const distanceByLocation = new Map(skuDistances.map(s => [s.locationCode, s.distanceMeters]));
  const operatorDistances = computeOperatorDistances(pickRecords, distanceByLocation);
  const underutilized = findUnderutilizedPositions(cells, pickCounts);

  const totalMetersEstimate = skuDistances.reduce((s, d) => s + d.totalDistanceMeters, 0);
  const totalSecondsEstimate = skuDistances.reduce((s, d) => s + estimatePickingTimeSeconds(d.distanceMeters * 2, 1) * d.pickCount, 0);
  const totalMetersSaved = history.reduce((s, h) => s + (h?.meters_saved ?? 0), 0);

  const corridorRanking = Array.from(traffic.entries()).sort(([, a], [, b]) => b - a).slice(0, 10);
  const skuRanking = skuDistances.slice(0, 10);
  const operatorRanking = Array.from(operatorDistances.entries()).sort(([, a], [, b]) => b - a).slice(0, 10);

  return (
    <Page width="wide">
      <PageHeader
        title="Slotting Intelligence"
        description="Otimiza o layout do armazém a partir de distâncias reais calculadas sobre a grade desenhada."
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowEditor(v => !v)}>
                <PenSquare size={15} /> {showEditor ? 'Fechar Editor' : 'Editar Layout'}
              </Button>
              <Button onClick={handleGenerateRecommendations} disabled={generating}>
                <RefreshCw size={15} className={generating ? 'animate-spin' : ''} /> {generating ? 'Gerando...' : 'Gerar Recomendações'}
              </Button>
            </div>
          ) : undefined
        }
      />

      {showEditor && canEdit && (
        <Panel>
          <PanelSection padding="md">
            <LayoutEditor
              companyId={companyId} userId={userId} userEmail={userEmail}
              layout={layout} cells={cells}
              onCellsChanged={() => getCells(layout.id, companyId).then(setCells)}
            />
          </PanelSection>
        </Panel>
      )}

      <Panel>
        <PanelSection padding="md" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-start gap-2.5">
            <Footprints size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
            <div><p className="text-xs text-fg-subtle">Distância Estimada (período)</p><p className="text-sm font-semibold text-fg">{Math.round(totalMetersEstimate).toLocaleString('pt-BR')} m</p></div>
          </div>
          <div className="flex items-start gap-2.5">
            <Clock size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
            <div><p className="text-xs text-fg-subtle">Tempo Estimado de Picking</p><p className="text-sm font-semibold text-fg">{Math.round(totalSecondsEstimate / 3600)} h</p></div>
          </div>
          <div className="flex items-start gap-2.5">
            <TrendingUp size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
            <div><p className="text-xs text-fg-subtle">Distância Economizada (aprovadas)</p><p className="text-sm font-semibold text-fg">{Math.round(totalMetersSaved).toLocaleString('pt-BR')} m</p></div>
          </div>
          <div className="flex items-start gap-2.5">
            <PackageOpen size={16} className="text-fg-subtle mt-0.5 flex-shrink-0" />
            <div><p className="text-xs text-fg-subtle">Endereços Subutilizados</p><p className="text-sm font-semibold text-fg">{underutilized.length}</p></div>
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Heatmap do Armazém</p>
          <WarehouseHeatmap layout={layout} cells={cells} traffic={traffic} />
        </PanelSection>
      </Panel>

      <PickingRouteViewer companyId={companyId} layout={layout} cells={cells} />

      <SkuMoveSimulator
        companyId={companyId} userId={userId} userEmail={userEmail}
        layout={layout} cells={cells} pickCounts={pickCounts} pickCountPeriodDays={90}
        canEdit={canEdit}
        onApplied={loadAll}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3 flex items-center gap-1.5"><Route size={14} /> SKUs Mais Percorridos</p>
            <div>
              {skuRanking.length === 0 && <p className="text-xs text-fg-subtle">Sem dados suficientes ainda.</p>}
              {skuRanking.map(sku => (
                <ListRow key={sku.locationCode} value={<Badge variant="neutral">{Math.round(sku.totalDistanceMeters)} m</Badge>}>
                  <p className="truncate text-sm font-medium text-fg">{productNames.get(sku.locationCode) ?? sku.locationCode}</p>
                  <p className="text-caption">{sku.locationCode} · {sku.pickCount} picks</p>
                </ListRow>
              ))}
            </div>
          </PanelSection>
        </Panel>

        <Panel>
          <PanelSection padding="md">
            <p className="text-section mb-3">Ranking de Corredores</p>
            <div>
              {corridorRanking.length === 0 && <p className="text-xs text-fg-subtle">Sem dados suficientes ainda.</p>}
              {corridorRanking.map(([key, count]) => (
                <ListRow key={key} value={<Badge variant="neutral">{count} passagens</Badge>}>
                  <p className="text-sm text-fg">Corredor ({key})</p>
                </ListRow>
              ))}
            </div>
          </PanelSection>
        </Panel>
      </div>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Distância por Operador</p>
          <div>
            {operatorRanking.length === 0 && <p className="text-xs text-fg-subtle">Sem dados suficientes ainda.</p>}
            {operatorRanking.map(([operatorId, meters]) => (
              <ListRow key={operatorId} value={<Badge variant="neutral">{Math.round(meters).toLocaleString('pt-BR')} m</Badge>}>
                <p className="text-sm text-fg">{operatorNames.get(operatorId) ?? operatorId}</p>
              </ListRow>
            ))}
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Recomendações Pendentes</p>
          <div className="space-y-2">
            {recommendations.length === 0 && (
              <p className="text-xs text-fg-subtle">Nenhuma recomendação pendente — clique em "Gerar Recomendações".</p>
            )}
            {recommendations.map(rec => (
              <div key={rec.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-surface-3/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="accent">{RECOMMENDATION_LABEL[rec.recommendation_type]}</Badge>
                    {rec.estimated_meters_saved > 0 && (
                      <span className="text-xs text-fg-subtle">~{Math.round(rec.estimated_meters_saved)}m economizados</span>
                    )}
                  </div>
                  <p className="text-sm text-fg-muted">{rec.reason}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleDecide(rec.id, 'aprovada')} className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded transition" title="Aprovar">
                      <Check size={16} />
                    </button>
                    <button onClick={() => handleDecide(rec.id, 'adiada')} className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded transition" title="Adiar">
                      <Clock3 size={16} />
                    </button>
                    <button onClick={() => handleDecide(rec.id, 'rejeitada')} className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded transition" title="Rejeitar">
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-section mb-3">Histórico de Otimizações</p>
          <div>
            {history.length === 0 && <p className="text-xs text-fg-subtle">Nenhuma otimização aprovada ainda.</p>}
            {history.map(h => (
              <ListRow
                key={h.id}
                value={<span className="text-caption">{new Date(h.recorded_at).toLocaleDateString('pt-BR')}</span>}
              >
                <p className="text-sm text-fg-muted">{h.event}</p>
              </ListRow>
            ))}
          </div>
        </PanelSection>
      </Panel>
    </Page>
  );
}
