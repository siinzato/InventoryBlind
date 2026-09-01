// Configurador visual de planta (Imagem 2) — substitui os campos crus de posição X/Y/
// escala/opacidade por um fluxo guiado em 5 etapas. Edita sempre um RASCUNHO
// (warehouse_layouts.status='draft', clonado da planta publicada por openLayoutDraft) —
// nenhuma tela operacional lê essa linha até "Publicar" trocar as duas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2, Square, Rows3, PackagePlus, Warehouse as WarehouseIcon, Eraser, ImageUp,
  Download, Upload, CheckCircle2, AlertTriangle, XCircle, Ruler,
} from 'lucide-react';
import { Modal, Button, Input, Select, Badge, Notice, PhaseRail, Panel, PanelSection } from '../ui';
import {
  openLayoutDraft, uploadFloorPlanImage, getFloorPlanSignedUrl, confirmLayoutScale,
  upsertCellsBatch, getZones, upsertZone, getCells, publishLayoutDraft,
  getKnownAddressCodes, getExistingAddressBindings, applyAddressImport,
} from '../../lib/slottingLayoutService';
import { computeCellSizeFromTwoPoints, type LengthUnit } from '../../lib/slottingEngine';
import { validateLayoutForPublish } from '../../lib/warehouseLayoutPublishing';
import { classifyAddressRows, parseAddressCsv, ADDRESS_CSV_TEMPLATE_HEADER, type ClassifiedAddressRow } from '../../lib/warehouseAddressImport';
import { downloadFile } from '../../lib/productImportUtils';
import { FloorPlanBackground } from './FloorPlanBackground';
import type { WarehouseCell, WarehouseCellType, WarehouseLayout, WarehouseZone } from '../../lib/supabase';

interface LayoutConfiguratorWizardProps {
  companyId: string;
  userId: string;
  userEmail: string;
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
}

type WizardStep = 'planta' | 'escala' | 'estrutura' | 'enderecos' | 'validar';
const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'planta', label: 'Planta' },
  { key: 'escala', label: 'Escala' },
  { key: 'estrutura', label: 'Estrutura' },
  { key: 'enderecos', label: 'Endereços' },
  { key: 'validar', label: 'Validar' },
];

const CELL_PX = 22;

type PaintTool = 'selecionar' | 'zona' | 'rua' | 'modulo' | 'posicao' | 'expedicao' | 'porta' | 'doca' | 'apagar';

const PAINT_TOOLS: { tool: PaintTool; label: string; icon: typeof MousePointer2 }[] = [
  { tool: 'selecionar', label: 'Selecionar', icon: MousePointer2 },
  { tool: 'zona', label: 'Desenhar zona', icon: Square },
  { tool: 'rua', label: 'Desenhar corredor', icon: Rows3 },
  { tool: 'modulo', label: 'Adicionar rack', icon: WarehouseIcon },
  { tool: 'posicao', label: 'Adicionar posição', icon: PackagePlus },
  { tool: 'apagar', label: 'Apagar', icon: Eraser },
];

const CELL_COLOR: Record<WarehouseCellType, string> = {
  rua: 'bg-surface-3', modulo: 'bg-fg-subtle/40', posicao: 'bg-accent/20 border-accent/50',
  expedicao: 'bg-emerald-500/30 border-emerald-500', porta: 'bg-amber-500/30 border-amber-500',
  doca: 'bg-sky-500/30 border-sky-500', vazio: 'bg-transparent border-edge/30',
};

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
}

function formatSavedAt(date: Date | null): string {
  if (!date) return '';
  return `Rascunho salvo às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function LayoutConfiguratorWizard({ companyId, userId, userEmail, open, onClose, onPublished }: LayoutConfiguratorWizardProps) {
  const [step, setStep] = useState<WizardStep>('planta');
  const [draft, setDraft] = useState<WarehouseLayout | null>(null);
  const [cells, setCells] = useState<WarehouseCell[]>([]);
  const [zones, setZones] = useState<WarehouseZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setStep('planta'); return; }
    let cancelled = false;
    setLoading(true);
    openLayoutDraft(companyId, userId, userEmail).then(async d => {
      if (cancelled) return;
      if (!d) { setLoading(false); return; }
      setDraft(d);
      const [c, z] = await Promise.all([getCells(d.id, companyId), getZones(d.id, companyId)]);
      if (cancelled) return;
      setCells(c);
      setZones(z);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, companyId, userId, userEmail]);

  const reloadCellsAndZones = useCallback(async () => {
    if (!draft) return;
    const [c, z] = await Promise.all([getCells(draft.id, companyId), getZones(draft.id, companyId)]);
    setCells(c);
    setZones(z);
    setSavedAt(new Date());
  }, [draft, companyId]);

  const validation = useMemo(() => {
    if (!draft) return null;
    return validateLayoutForPublish({ layout: draft, cells, zones });
  }, [draft, cells, zones]);

  async function handlePublish() {
    if (!draft || !validation?.canPublish) return;
    setPublishing(true);
    setPublishError(null);
    const ok = await publishLayoutDraft(companyId, draft.id, userId, userEmail);
    setPublishing(false);
    if (!ok) { setPublishError('Não foi possível publicar a planta agora.'); return; }
    onPublished();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Configurar planta"
      maxWidth="max-w-4xl"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <PhaseRail steps={STEPS} currentKey={step} label="Etapas de configuração da planta" className="flex-1" />
          <span className="text-xs text-fg-subtle whitespace-nowrap">{formatSavedAt(savedAt)}</span>
        </div>

        {loading || !draft ? (
          <p className="text-sm text-fg-subtle text-center py-8">Carregando rascunho...</p>
        ) : (
          <>
            {step === 'planta' && (
              <StepPlanta companyId={companyId} userId={userId} userEmail={userEmail} draft={draft} onChanged={setDraft} onSaved={() => setSavedAt(new Date())} />
            )}
            {step === 'escala' && (
              <StepEscala draft={draft} onChanged={setDraft} onSaved={() => setSavedAt(new Date())} />
            )}
            {step === 'estrutura' && (
              <StepEstrutura
                companyId={companyId} userId={userId} userEmail={userEmail} draft={draft} cells={cells} zones={zones}
                onSaved={reloadCellsAndZones}
              />
            )}
            {step === 'enderecos' && (
              <StepEnderecos
                companyId={companyId} userId={userId} userEmail={userEmail} draft={draft} cells={cells}
                onSaved={reloadCellsAndZones}
              />
            )}
            {step === 'validar' && validation && (
              <StepValidar validation={validation} publishing={publishing} publishError={publishError} onPublish={handlePublish} />
            )}

            <div className="flex items-center justify-between pt-2 border-t border-edge">
              <Button
                variant="secondary" size="sm"
                disabled={step === 'planta'}
                onClick={() => setStep(STEPS[Math.max(0, STEPS.findIndex(s => s.key === step) - 1)].key)}
              >
                Voltar
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onClose}>Sair da configuração</Button>
                {step !== 'validar' && (
                  <Button size="sm" onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex(s => s.key === step) + 1)].key)}>
                    Continuar
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Etapa 1 — Planta ─────────────────────────────────────────────────────────────────────

function StepPlanta({ companyId, userId, userEmail, draft, onChanged, onSaved }: {
  companyId: string; userId: string; userEmail: string; draft: WarehouseLayout;
  onChanged: (l: WarehouseLayout) => void; onSaved: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Envie uma imagem PNG ou JPEG. PDF: exporte a página como imagem antes de subir.');
      return;
    }
    setUploading(true);
    setError(null);
    const path = await uploadFloorPlanImage(companyId, draft.id, file, userId, userEmail);
    setUploading(false);
    if (!path) { setError('Não foi possível enviar a imagem.'); return; }
    onChanged({ ...draft, background_image_path: path });
    onSaved();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Envie a planta do armazém como imagem — ela fica atrás da grade nas próximas etapas.</p>
      <div className="flex items-center gap-3">
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <ImageUp size={15} /> {uploading ? 'Enviando...' : draft.background_image_path ? 'Trocar planta' : 'Enviar planta (PNG/JPG)'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {draft.background_image_path && (
        <div className="relative border border-edge rounded-container overflow-hidden" style={{ maxHeight: 320 }}>
          <FloorPlanPreview layout={draft} />
        </div>
      )}
    </div>
  );
}

function FloorPlanPreview({ layout }: { layout: WarehouseLayout }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (layout.background_image_path) getFloorPlanSignedUrl(layout.background_image_path).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [layout.background_image_path]);
  if (!url) return null;
  return <img src={url} alt="Planta enviada" className="w-full h-auto max-h-80 object-contain bg-surface-3" />;
}

// ── Etapa 2 — Escala ─────────────────────────────────────────────────────────────────────

function StepEscala({ draft, onChanged, onSaved }: { draft: WarehouseLayout; onChanged: (l: WarehouseLayout) => void; onSaved: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [realDistance, setRealDistance] = useState('');
  const [unit, setUnit] = useState<LengthUnit>('m');
  const [error, setError] = useState<string | null>(null);

  const gridWidthPx = draft.grid_width * CELL_PX;
  const gridHeightPx = draft.grid_height * CELL_PX;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setPoints(prev => (prev.length >= 2 ? [point] : [...prev, point]));
    setError(null);
  }

  async function handleConfirm() {
    const distance = Number(realDistance.replace(',', '.'));
    if (points.length !== 2) { setError('Marque dois pontos na planta.'); return; }
    if (!distance || distance <= 0) { setError('Informe a distância real entre os dois pontos.'); return; }

    const cellSizeMeters = computeCellSizeFromTwoPoints({ pointA: points[0], pointB: points[1], pixelsPerCell: CELL_PX, realDistance: distance, unit });
    if (cellSizeMeters == null) { setError('Não foi possível calcular a escala com esses pontos.'); return; }

    await confirmLayoutScale(draft.id, draft.company_id, cellSizeMeters);
    onChanged({ ...draft, cell_size_meters: cellSizeMeters, scale_confirmed: true });
    onSaved();
  }

  const rulerCells = draft.scale_confirmed ? Math.max(1, Math.round(1 / (draft.cell_size_meters || 1))) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Marque dois pontos na planta e informe a distância real entre eles — sem essa calibração, distâncias e
        tempos estimados aparecem como "Indisponível" em vez de um valor chutado.
      </p>

      <div
        ref={containerRef}
        onClick={handleClick}
        className="relative overflow-auto border border-edge rounded-container bg-surface cursor-crosshair"
        style={{ maxHeight: 340 }}
      >
        <div className="relative" style={{ width: gridWidthPx, height: gridHeightPx }}>
          <FloorPlanBackground layout={draft} cellPixelSize={CELL_PX} />
          <svg className="absolute inset-0 pointer-events-none" width={gridWidthPx} height={gridHeightPx}>
            {points.length === 2 && (
              <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="var(--accent, #2563eb)" strokeWidth={2} />
            )}
            {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={5} fill="var(--accent, #2563eb)" />)}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Distância real entre os pontos</label>
          <Input value={realDistance} onChange={e => setRealDistance(e.target.value)} placeholder="Ex.: 10" className="w-32" inputMode="decimal" />
        </div>
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Unidade</label>
          <Select value={unit} onChange={e => setUnit(e.target.value as LengthUnit)} className="w-28">
            <option value="m">Metros</option>
            <option value="cm">Centímetros</option>
          </Select>
        </div>
        <Button size="sm" onClick={handleConfirm}><Ruler size={14} /> Calcular e confirmar</Button>
        <span className="text-xs text-fg-subtle">{points.length}/2 pontos marcados</span>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {draft.scale_confirmed ? (
        <Notice tone="success">
          Escala calibrada: {draft.cell_size_meters.toFixed(2)}m por célula.
          {rulerCells && ` A régua abaixo mede aproximadamente 1 metro (${rulerCells} célula${rulerCells === 1 ? '' : 's'}).`}
        </Notice>
      ) : (
        <Notice tone="warning">Escala ainda não calibrada — distâncias e tempos ficam indisponíveis até aqui.</Notice>
      )}
    </div>
  );
}

// ── Etapa 3 — Estrutura ──────────────────────────────────────────────────────────────────

function StepEstrutura({ companyId, userId, userEmail, draft, cells, zones, onSaved }: {
  companyId: string; userId: string; userEmail: string; draft: WarehouseLayout;
  cells: WarehouseCell[]; zones: WarehouseZone[]; onSaved: () => Promise<void>;
}) {
  const [tool, setTool] = useState<PaintTool>('selecionar');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedCell, setSelectedCell] = useState<WarehouseCell | null>(null);
  const [zoneForm, setZoneForm] = useState<{ code: string; name: string } | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showCodes, setShowCodes] = useState(true);
  const [saving, setSaving] = useState(false);

  const cellByKey = useMemo(() => new Map(cells.map(c => [`${c.x},${c.y}`, c])), [cells]);
  const rect = dragStart && dragEnd ? rectFrom(dragStart, dragEnd) : null;

  function handleMouseDown(x: number, y: number) {
    if (tool === 'selecionar') {
      setSelectedCell(cellByKey.get(`${x},${y}`) ?? { id: '', layout_id: draft.id, company_id: companyId, x, y, cell_type: 'vazio', location_code: null, capacity: null });
      return;
    }
    setDragStart({ x, y });
    setDragEnd({ x, y });
  }
  function handleMouseEnter(x: number, y: number, buttons: number) {
    if (tool === 'selecionar' || !dragStart || buttons !== 1) return;
    setDragEnd({ x, y });
  }

  async function handleMouseUp() {
    if (tool === 'selecionar' || !rect) { setDragStart(null); setDragEnd(null); return; }

    if (tool === 'zona') {
      setZoneForm({ code: '', name: '' });
      return; // finaliza via handleSaveZone
    }

    setSaving(true);
    const cellType: WarehouseCellType = tool === 'apagar' ? 'vazio' : tool;
    const batch: { x: number; y: number; cellType: WarehouseCellType; locationCode: string | null }[] = [];
    for (let x = rect.minX; x <= rect.maxX; x++) {
      for (let y = rect.minY; y <= rect.maxY; y++) {
        batch.push({ x, y, cellType, locationCode: cellType === 'vazio' ? null : (cellByKey.get(`${x},${y}`)?.location_code ?? null) });
      }
    }
    await upsertCellsBatch(draft.id, companyId, batch, userId, userEmail);
    await onSaved();
    setSaving(false);
    setDragStart(null);
    setDragEnd(null);
  }

  async function handleSaveZone() {
    if (!rect || !zoneForm?.code.trim() || !zoneForm?.name.trim()) return;
    setSaving(true);
    await upsertZone(draft.id, companyId, {
      code: zoneForm.code.trim(), name: zoneForm.name.trim(), kind: 'zona',
      minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY,
    }, userId, userEmail);
    await onSaved();
    setSaving(false);
    setZoneForm(null);
    setDragStart(null);
    setDragEnd(null);
  }

  async function handleUpdateSelected(patch: Partial<{ cellType: WarehouseCellType; locationCode: string | null; capacity: number | null }>) {
    if (!selectedCell) return;
    const next = { ...selectedCell, cell_type: patch.cellType ?? selectedCell.cell_type, location_code: patch.locationCode !== undefined ? patch.locationCode : selectedCell.location_code, capacity: patch.capacity !== undefined ? patch.capacity : selectedCell.capacity };
    setSelectedCell(next);
    setSaving(true);
    await upsertCellsBatch(draft.id, companyId, [{ x: next.x, y: next.y, cellType: next.cell_type, locationCode: next.location_code, capacity: next.capacity }], userId, userEmail);
    await onSaved();
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {PAINT_TOOLS.map(({ tool: t, label, icon: Icon }) => (
          <Button key={t} size="sm" variant={tool === t ? 'primary' : 'secondary'} onClick={() => setTool(t)}>
            <Icon size={13} /> {label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-edge" />
        <label className="flex items-center gap-1.5 text-xs text-fg-muted"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grade</label>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted"><input type="checkbox" checked={showCodes} onChange={e => setShowCodes(e.target.checked)} /> Códigos</label>
        {saving && <span className="text-xs text-fg-subtle animate-pulse">Salvando...</span>}
      </div>
      <p className="text-xs text-fg-subtle">
        {tool === 'selecionar' ? 'Clique numa célula para editar tipo, código e capacidade.' : tool === 'zona' ? 'Arraste sobre a grade para desenhar o retângulo da zona.' : 'Arraste sobre a grade para pintar várias células de uma vez.'}
      </p>

      <div className="overflow-auto border border-edge rounded-container p-2 bg-surface select-none" style={{ maxHeight: 420 }} onMouseUp={handleMouseUp} onMouseLeave={() => { setDragStart(null); setDragEnd(null); }}>
        <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${draft.grid_width}, ${CELL_PX}px)` }}>
          <FloorPlanBackground layout={draft} cellPixelSize={CELL_PX + 0.5} />
          {Array.from({ length: draft.grid_height }).map((_, y) =>
            Array.from({ length: draft.grid_width }).map((_, x) => {
              const cell = cellByKey.get(`${x},${y}`);
              const type = cell?.cell_type ?? 'vazio';
              const inDrag = rect && x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
              const isSelected = selectedCell?.x === x && selectedCell?.y === y && tool === 'selecionar';
              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  onMouseDown={() => handleMouseDown(x, y)}
                  onMouseEnter={e => handleMouseEnter(x, y, e.buttons)}
                  title={cell?.location_code ?? `(${x},${y})`}
                  className={`relative flex items-center justify-center text-[7px] font-semibold text-fg-subtle ${showGrid ? 'border' : 'border-transparent'} ${CELL_COLOR[type]} ${isSelected ? 'ring-2 ring-accent' : ''} ${inDrag ? 'ring-2 ring-accent/70' : ''}`}
                  style={{ width: CELL_PX, height: CELL_PX }}
                >
                  {showCodes && cell?.location_code ? cell.location_code.split('-').slice(-1)[0] : ''}
                </button>
              );
            })
          )}
          {zones.map(z => (
            <div
              key={z.id}
              className="absolute border-2 border-dashed border-accent/60 pointer-events-none flex items-start justify-start"
              style={{ left: z.min_x * (CELL_PX + 2), top: z.min_y * (CELL_PX + 2), width: (z.max_x - z.min_x + 1) * (CELL_PX + 2) - 2, height: (z.max_y - z.min_y + 1) * (CELL_PX + 2) - 2 }}
            >
              <span className="bg-surface/90 text-[9px] font-semibold text-accent px-1 rounded-br">{z.name}</span>
            </div>
          ))}
        </div>
      </div>

      {tool === 'selecionar' && selectedCell && (
        <Panel>
          <PanelSection padding="sm" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Tipo</label>
              <Select value={selectedCell.cell_type} onChange={e => handleUpdateSelected({ cellType: e.target.value as WarehouseCellType })} className="w-32">
                {(['vazio', 'rua', 'modulo', 'posicao', 'expedicao', 'porta', 'doca'] as WarehouseCellType[]).map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            {selectedCell.cell_type === 'posicao' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-fg-muted mb-1">Código do endereço</label>
                  <Input value={selectedCell.location_code ?? ''} onChange={e => setSelectedCell({ ...selectedCell, location_code: e.target.value || null })} onBlur={() => handleUpdateSelected({ locationCode: selectedCell.location_code })} className="w-36" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-fg-muted mb-1">Capacidade</label>
                  <Input type="number" min={1} value={selectedCell.capacity ?? ''} onChange={e => setSelectedCell({ ...selectedCell, capacity: e.target.value ? Number(e.target.value) : null })} onBlur={() => handleUpdateSelected({ capacity: selectedCell.capacity })} className="w-24" />
                </div>
              </>
            )}
            <span className="text-xs text-fg-subtle">({selectedCell.x},{selectedCell.y})</span>
          </PanelSection>
        </Panel>
      )}

      <Modal open={!!zoneForm} onClose={() => { setZoneForm(null); setDragStart(null); setDragEnd(null); }} title="Nova zona">
        {zoneForm && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Código</label>
              <Input value={zoneForm.code} onChange={e => setZoneForm({ ...zoneForm, code: e.target.value })} placeholder="A" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg-muted mb-1">Nome</label>
              <Input value={zoneForm.name} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} placeholder="Zona A" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setZoneForm(null); setDragStart(null); setDragEnd(null); }}>Cancelar</Button>
              <Button size="sm" onClick={handleSaveZone} disabled={!zoneForm.code.trim() || !zoneForm.name.trim()}>Salvar zona</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Etapa 4 — Endereços ──────────────────────────────────────────────────────────────────

function StepEnderecos({ companyId, userId, userEmail, draft, cells, onSaved }: {
  companyId: string; userId: string; userEmail: string; draft: WarehouseLayout; cells: WarehouseCell[]; onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'manual' | 'prefixo' | 'csv'>('manual');
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<ClassifiedAddressRow[] | null>(null);
  const [csvTotals, setCsvTotals] = useState<{ total: number; linked: number; unmatched: number; duplicate: number; outOfBounds: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [prefixStart, setPrefixStart] = useState(1);
  const [selectedRect, setSelectedRect] = useState<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const positionCells = cells.filter(c => c.cell_type === 'posicao');
  const cellByKey = useMemo(() => new Map(cells.map(c => [`${c.x},${c.y}`, c])), [cells]);

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const rows = parseAddressCsv(text);
    const [known, bindings] = await Promise.all([getKnownAddressCodes(companyId), getExistingAddressBindings(companyId)]);
    const result = classifyAddressRows({ rows, gridWidth: draft.grid_width, gridHeight: draft.grid_height, knownAddressCodes: known, existingBindings: bindings });
    setCsvRows(result.rows);
    setCsvTotals(result.totals);
  }

  async function handleConfirmImport() {
    if (!csvRows) return;
    setImporting(true);
    await applyAddressImport(draft.id, companyId, csvRows, userId, userEmail);
    setImporting(false);
    setCsvRows(null);
    setCsvTotals(null);
    await onSaved();
  }

  async function handleApplyPrefix() {
    if (!selectedRect || !prefix.trim()) return;
    const targets = positionCells.filter(c => c.x >= selectedRect.minX && c.x <= selectedRect.maxX && c.y >= selectedRect.minY && c.y <= selectedRect.maxY);
    let seq = prefixStart;
    const batch = targets
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(c => ({ x: c.x, y: c.y, cellType: 'posicao' as const, locationCode: `${prefix.trim()}-${String(seq++).padStart(2, '0')}` }));
    await upsertCellsBatch(draft.id, companyId, batch, userId, userEmail);
    await onSaved();
    setSelectedRect(null);
  }

  function downloadTemplate() {
    downloadFile(`${ADDRESS_CSV_TEMPLATE_HEADER}\nA-01-01,A,01,01,1,1,,0,0,20\n`, 'template-enderecos-warehouse-twin.csv');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={mode === 'manual' ? 'primary' : 'secondary'} onClick={() => setMode('manual')}>Seleção manual</Button>
        <Button size="sm" variant={mode === 'prefixo' ? 'primary' : 'secondary'} onClick={() => setMode('prefixo')}>Regra por prefixo</Button>
        <Button size="sm" variant={mode === 'csv' ? 'primary' : 'secondary'} onClick={() => setMode('csv')}>Importar CSV</Button>
      </div>

      {mode === 'manual' && (
        <p className="text-sm text-fg-muted">Volte à Etapa "Estrutura" com a ferramenta "Selecionar" para editar o código de cada posição individualmente.</p>
      )}

      {mode === 'prefixo' && (
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">Arraste sobre as posições da grade abaixo para aplicar um código gerado por prefixo + sequência.</p>
          <div
            className="overflow-auto border border-edge rounded-container p-2 bg-surface select-none"
            style={{ maxHeight: 320 }}
            onMouseUp={() => setDragStart(null)}
            onMouseLeave={() => setDragStart(null)}
          >
            <div className="relative inline-grid gap-0.5" style={{ gridTemplateColumns: `repeat(${draft.grid_width}, ${CELL_PX}px)` }}>
              <FloorPlanBackground layout={draft} cellPixelSize={CELL_PX + 0.5} />
              {Array.from({ length: draft.grid_height }).map((_, y) =>
                Array.from({ length: draft.grid_width }).map((_, x) => {
                  const cell = cellByKey.get(`${x},${y}`);
                  const inRect = selectedRect && x >= selectedRect.minX && x <= selectedRect.maxX && y >= selectedRect.minY && y <= selectedRect.maxY;
                  return (
                    <button
                      key={`${x}-${y}`}
                      type="button"
                      disabled={cell?.cell_type !== 'posicao'}
                      onMouseDown={() => { setDragStart({ x, y }); setSelectedRect({ minX: x, maxX: x, minY: y, maxY: y }); }}
                      onMouseEnter={e => { if (dragStart && e.buttons === 1) setSelectedRect(rectFrom(dragStart, { x, y })); }}
                      title={cell?.location_code ?? `(${x},${y})`}
                      className={`${cell ? CELL_COLOR[cell.cell_type] : 'bg-transparent'} ${inRect ? 'ring-2 ring-accent' : ''} border border-edge/40`}
                      style={{ width: CELL_PX, height: CELL_PX }}
                    />
                  );
                })
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="block text-xs font-medium text-fg-muted mb-1">Prefixo</label><Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="A-01" className="w-28" /></div>
            <div><label className="block text-xs font-medium text-fg-muted mb-1">Começar em</label><Input type="number" min={1} value={prefixStart} onChange={e => setPrefixStart(Number(e.target.value) || 1)} className="w-20" /></div>
            <Button size="sm" onClick={handleApplyPrefix} disabled={!selectedRect || !prefix.trim()}>Aplicar aos selecionados</Button>
          </div>
        </div>
      )}

      {mode === 'csv' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Selecionar arquivo CSV</Button>
            <Button variant="secondary" size="sm" onClick={downloadTemplate}><Download size={14} /> Baixar template</Button>
          </div>

          {csvTotals && (
            <>
              <div className="flex flex-wrap gap-3 text-xs">
                <Badge variant="neutral">Total: {csvTotals.total}</Badge>
                <Badge variant="success">Vinculados: {csvTotals.linked}</Badge>
                <Badge variant="warning">Sem correspondência: {csvTotals.unmatched}</Badge>
                <Badge variant="danger">Duplicados: {csvTotals.duplicate}</Badge>
                <Badge variant="danger">Fora da planta: {csvTotals.outOfBounds}</Badge>
              </div>
              <div className="max-h-56 overflow-auto border border-edge rounded-container">
                <table className="w-full text-xs">
                  <thead className="bg-surface-3 sticky top-0"><tr><th className="text-left px-2 py-1">Endereço</th><th className="text-left px-2 py-1">X,Y</th><th className="text-left px-2 py-1">Status</th><th className="text-left px-2 py-1">Motivo</th></tr></thead>
                  <tbody>
                    {csvRows!.slice(0, 200).map((r, i) => (
                      <tr key={i} className="border-t border-edge/60">
                        <td className="px-2 py-1">{r.addressCode || '—'}</td>
                        <td className="px-2 py-1 tabular-nums">{r.x ?? '—'},{r.y ?? '—'}</td>
                        <td className="px-2 py-1">
                          {r.status === 'linked' && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> vinculado</span>}
                          {r.status === 'unmatched' && <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> sem correspondência</span>}
                          {(r.status === 'duplicate' || r.status === 'out_of_bounds') && <span className="text-red-600 dark:text-red-400 flex items-center gap-1"><XCircle size={12} /> {r.status === 'duplicate' ? 'duplicado' : 'fora da planta'}</span>}
                        </td>
                        <td className="px-2 py-1 text-fg-subtle">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button size="sm" onClick={handleConfirmImport} disabled={importing || csvTotals.linked === 0}>
                {importing ? 'Importando...' : `Importar ${csvTotals.linked} endereço(s) vinculado(s)`}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Etapa 5 — Validar ────────────────────────────────────────────────────────────────────

function StepValidar({ validation, publishing, publishError, onPublish }: {
  validation: ReturnType<typeof validateLayoutForPublish>; publishing: boolean; publishError: string | null; onPublish: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">Cobertura de endereços vinculados: <strong className="text-fg">{Math.round(validation.coveragePct)}%</strong></p>

      {validation.errors.length === 0 && validation.warnings.length === 0 && (
        <Notice tone="success">Nenhum problema encontrado — a planta está pronta para publicar.</Notice>
      )}
      {validation.errors.map(issue => (
        <Notice key={issue.code} tone="danger">{issue.message}</Notice>
      ))}
      {validation.warnings.map(issue => (
        <Notice key={issue.code} tone="warning">{issue.message}</Notice>
      ))}

      {publishError && <p className="text-xs text-red-600 dark:text-red-400">{publishError}</p>}

      <Button onClick={onPublish} disabled={!validation.canPublish || publishing}>
        {publishing ? 'Publicando...' : 'Publicar planta'}
      </Button>
    </div>
  );
}

export default LayoutConfiguratorWizard;
