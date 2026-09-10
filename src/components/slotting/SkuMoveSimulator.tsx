import { useEffect, useMemo, useState } from 'react';
import { Shuffle, ArrowRight } from 'lucide-react';
import { Panel, PanelSection, Button, Badge } from '../ui';
import { supabase } from '../../lib/supabase';
import { applySkuMove } from '../../lib/slottingLayoutService';
import { findExpeditionCell, simulateMove, MoveSimulationResult } from '../../lib/slottingEngine';
import type { WarehouseLayout, WarehouseCell } from '../../lib/supabase';

interface SkuMoveSimulatorProps {
  companyId: string;
  userId: string;
  userEmail: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  pickCounts: Map<string, number>;
  pickCountPeriodDays: number;
  canEdit: boolean;
  onApplied: () => void;
}

/** Simulador "e se eu mover este SKU?" — calcula o ganho real (distância BFS + frequência
 *  observada) ANTES de aplicar qualquer mudança, para o usuário decidir com o número na
 *  mão em vez de mexer no endereço às cegas. Aplicar é uma decisão já tomada (diferente de
 *  uma recomendação pendente), então grava direto no histórico ao confirmar. */
export function SkuMoveSimulator({ companyId, userId, userEmail, layout, cells, pickCounts, pickCountPeriodDays, canEdit, onApplied }: SkuMoveSimulatorProps) {
  const [productsByLocation, setProductsByLocation] = useState<Map<string, { id: string; name: string }>>(new Map());
  const [sourceLocation, setSourceLocation] = useState('');
  const [destKey, setDestKey] = useState('');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const positionsWithCode = useMemo(() => cells.filter(c => c.cell_type === 'posicao' && c.location_code), [cells]);
  const expedition = useMemo(() => findExpeditionCell(cells), [cells]);

  useEffect(() => {
    supabase.from('products').select('id, name, location').eq('company_id', companyId).not('location', 'is', null).then(({ data }) => {
      setProductsByLocation(new Map((data ?? []).filter(p => p.location).map(p => [p.location as string, { id: p.id as string, name: p.name as string }])));
    });
  }, [companyId]);

  // Origem: endereços com um produto de fato alocado. Destino: endereços já rotulados no
  // layout (têm location_code) mas sem nenhum produto apontando pra lá agora — mover pra
  // "qualquer célula vazia" criaria um endereço que o motor de distância não reconhece.
  const occupiedPositions = useMemo(() => positionsWithCode.filter(c => productsByLocation.has(c.location_code!)), [positionsWithCode, productsByLocation]);
  const vacantLabeledPositions = useMemo(() => positionsWithCode.filter(c => !productsByLocation.has(c.location_code!)), [positionsWithCode, productsByLocation]);

  const sourceCell = occupiedPositions.find(c => c.location_code === sourceLocation) ?? null;
  const destCell = vacantLabeledPositions.find(c => `${c.x},${c.y}` === destKey) ?? null;
  const product = sourceLocation ? productsByLocation.get(sourceLocation) : undefined;

  let simulation: MoveSimulationResult | null = null;
  if (sourceCell && destCell && expedition) {
    const pickCount = pickCounts.get(sourceLocation) ?? 0;
    simulation = simulateMove(
      cells, { x: sourceCell.x, y: sourceCell.y }, { x: destCell.x, y: destCell.y },
      { x: expedition.x, y: expedition.y }, pickCount, layout.cell_size_meters, pickCountPeriodDays
    );
  }

  const handleApply = async () => {
    if (!product || !destCell || !simulation) return;
    setApplying(true);
    const ok = await applySkuMove(product.id, destCell.location_code!, companyId, layout.id, simulation.metersSavedPerWeek, userId, userEmail);
    setApplying(false);
    if (ok) {
      setApplied(true);
      setSourceLocation('');
      setDestKey('');
      onApplied();
    }
  };

  return (
    <Panel>
      <PanelSection padding="md" className="space-y-4">
        <p className="text-section flex items-center gap-1.5"><Shuffle size={14} /> Simulador de Movimentação de SKU</p>

        {occupiedPositions.length === 0 || vacantLabeledPositions.length === 0 ? (
          <p className="text-xs text-fg-subtle">
            Precisa de ao menos uma posição ocupada por um produto e outra posição já rotulada (com código de localização) mas vaga no layout para simular uma movimentação.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">SKU a mover (posição atual)</label>
                <select value={sourceLocation} onChange={e => { setSourceLocation(e.target.value); setApplied(false); }} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg">
                  <option value="">Selecione...</option>
                  {occupiedPositions.map(c => (
                    <option key={c.location_code} value={c.location_code!}>
                      {productsByLocation.get(c.location_code!)?.name ?? c.location_code} ({c.location_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Nova posição (livre)</label>
                <select value={destKey} onChange={e => { setDestKey(e.target.value); setApplied(false); }} className="w-full p-2.5 border border-edge rounded-lg bg-surface text-sm text-fg">
                  <option value="">Selecione...</option>
                  {vacantLabeledPositions.map(c => (
                    <option key={`${c.x},${c.y}`} value={`${c.x},${c.y}`}>{c.location_code} ({c.x},{c.y})</option>
                  ))}
                </select>
              </div>
            </div>

            {simulation && (
              <div className="p-4 rounded-xl bg-surface-3/50 space-y-2">
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <span>{Math.round(simulation.currentDistanceMeters)} m da expedição</span>
                  <ArrowRight size={14} />
                  <span>{Math.round(simulation.candidateDistanceMeters)} m da expedição</span>
                </div>
                {simulation.metersSavedPerWeek > 0 ? (
                  <p className="text-sm font-semibold text-fg">
                    Mover este SKU economiza ~{(simulation.metersSavedPerWeek / 1000).toFixed(1)} km de caminhada por semana
                    (~{Math.round(simulation.timeSecondsSavedPerWeek / 60)} min/semana).
                  </p>
                ) : simulation.metersSavedPerWeek < 0 ? (
                  <p className="text-sm font-semibold text-red-500">
                    Esta posição é ~{(Math.abs(simulation.metersSavedPerWeek) / 1000).toFixed(1)} km/semana pior que a atual — não recomendado.
                  </p>
                ) : (
                  <p className="text-sm text-fg-muted">Sem diferença estimada de distância (ou sem histórico de picks nesta posição).</p>
                )}
                {canEdit ? (
                  <Button onClick={handleApply} disabled={applying || simulation.metersSavedPerWeek <= 0}>
                    {applying ? 'Aplicando...' : 'Aplicar mudança'}
                  </Button>
                ) : (
                  <p className="text-xs text-fg-subtle">Apenas owner/admin/manager podem aplicar a movimentação.</p>
                )}
                {applied && <Badge variant="accent">Movimentação aplicada — endereço do produto atualizado</Badge>}
              </div>
            )}
          </>
        )}
      </PanelSection>
    </Panel>
  );
}
