import { useState } from 'react';
import { Panel, PanelSection, Button } from '../ui';
import { upsertCell } from '../../lib/slottingLayoutService';
import { FloorPlanBackground } from './FloorPlanBackground';
import { FloorPlanUploadControl } from './FloorPlanUploadControl';
import type { WarehouseLayout, WarehouseCell, WarehouseCellType } from '../../lib/supabase';

interface LayoutEditorProps {
  companyId: string;
  userId: string;
  userEmail: string;
  layout: WarehouseLayout;
  cells: WarehouseCell[];
  onCellsChanged: () => void;
}

const CELL_COLOR: Record<WarehouseCellType, string> = {
  rua: 'bg-surface-3',
  modulo: 'bg-fg-subtle/40',
  posicao: 'bg-accent/20 border-accent/50',
  expedicao: 'bg-emerald-500/30 border-emerald-500',
  porta: 'bg-amber-500/30 border-amber-500',
  doca: 'bg-sky-500/30 border-sky-500',
  vazio: 'bg-transparent border-edge/30',
};

const TYPE_LABEL: Record<WarehouseCellType, string> = {
  vazio: 'Vazio', rua: 'Rua', modulo: 'Módulo', posicao: 'Posição', expedicao: 'Expedição', porta: 'Porta', doca: 'Doca',
};

/** Editor manual de grade 2D — clique numa célula seleciona, o painel abaixo define o tipo
 *  (e o código de localização, para células de posição). Divs, não canvas — mais robusto e
 *  consistente com o resto do app. */
export function LayoutEditor({ companyId, userId, userEmail, layout, cells, onCellsChanged }: LayoutEditorProps) {
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [pendingType, setPendingType] = useState<WarehouseCellType>('vazio');
  const [pendingLocation, setPendingLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const cellByKey = new Map(cells.map(c => [`${c.x},${c.y}`, c]));

  const handleSelect = (x: number, y: number) => {
    const cell = cellByKey.get(`${x},${y}`);
    setSelected({ x, y });
    setPendingType(cell?.cell_type ?? 'vazio');
    setPendingLocation(cell?.location_code ?? '');
  };

  const handleApply = async () => {
    if (!selected) return;
    setSaving(true);
    await upsertCell(
      layout.id, companyId, selected.x, selected.y, pendingType,
      pendingType === 'posicao' ? (pendingLocation.trim() || null) : null,
      userId, userEmail
    );
    setSaving(false);
    onCellsChanged();
  };

  return (
    <div className="space-y-4">
      <FloorPlanUploadControl companyId={companyId} userId={userId} userEmail={userEmail} layout={layout} onChanged={onCellsChanged} />

      <div className="overflow-auto border border-edge rounded-xl p-2 bg-surface" style={{ maxHeight: 460 }}>
        <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${layout.grid_width}, 22px)` }}>
          <FloorPlanBackground layout={layout} cellPixelSize={22.5} />
          {Array.from({ length: layout.grid_height }).map((_, y) =>
            Array.from({ length: layout.grid_width }).map((_, x) => {
              const cell = cellByKey.get(`${x},${y}`);
              const type = cell?.cell_type ?? 'vazio';
              const isSelected = selected?.x === x && selected?.y === y;
              return (
                <button
                  key={`${x}-${y}`}
                  onClick={() => handleSelect(x, y)}
                  title={cell?.location_code ?? `(${x},${y})`}
                  className={`w-[22px] h-[22px] border ${CELL_COLOR[type]} ${isSelected ? 'ring-2 ring-accent' : ''}`}
                />
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <Panel>
          <PanelSection padding="md" className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-xs text-fg-subtle mb-1">Célula ({selected.x},{selected.y})</p>
              <select
                value={pendingType}
                onChange={e => setPendingType(e.target.value as WarehouseCellType)}
                className="p-2 border border-edge rounded-lg bg-surface text-sm text-fg"
              >
                {(Object.keys(TYPE_LABEL) as WarehouseCellType[]).map(t => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            {pendingType === 'posicao' && (
              <div>
                <p className="text-xs text-fg-subtle mb-1">Código de localização (deve bater com o campo "Local" do produto)</p>
                <input
                  value={pendingLocation}
                  onChange={e => setPendingLocation(e.target.value)}
                  className="p-2 border border-edge rounded-lg bg-surface text-sm text-fg"
                  placeholder="Ex: A1-03"
                />
              </div>
            )}
            <Button onClick={handleApply} disabled={saving}>{saving ? 'Salvando...' : 'Aplicar'}</Button>
          </PanelSection>
        </Panel>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-fg-subtle">
        {(Object.keys(TYPE_LABEL) as WarehouseCellType[]).filter(t => t !== 'vazio').map(t => (
          <span key={t} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded border inline-block ${CELL_COLOR[t]}`} /> {TYPE_LABEL[t]}
          </span>
        ))}
      </div>
    </div>
  );
}
