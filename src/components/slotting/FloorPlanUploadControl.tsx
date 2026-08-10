import { useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { Button } from '../ui';
import { uploadFloorPlanImage, updateBackgroundCalibration } from '../../lib/slottingLayoutService';
import type { WarehouseLayout } from '../../lib/supabase';

interface FloorPlanUploadControlProps {
  companyId: string;
  userId: string;
  userEmail: string;
  layout: WarehouseLayout;
  onChanged: () => void;
}

/** Upload da planta como imagem (PNG/JPG/SVG) + calibração manual (posição/escala/
 *  opacidade) para alinhar a foto real com a grade desenhada. PDF/DWG com parsing
 *  automático de geometria continua fora de escopo — sem lib de renderização de PDF no
 *  projeto; se um dia for pedido, pdfjs-dist é o caminho natural para rasterizar a 1ª
 *  página antes do upload. */
export function FloorPlanUploadControl({ companyId, userId, userEmail, layout, onChanged }: FloorPlanUploadControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [offsetX, setOffsetX] = useState(layout.background_offset_x);
  const [offsetY, setOffsetY] = useState(layout.background_offset_y);
  const [scale, setScale] = useState(layout.background_scale);
  const [opacity, setOpacity] = useState(layout.background_opacity);
  const [saving, setSaving] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await uploadFloorPlanImage(companyId, layout.id, file, userId, userEmail);
    setUploading(false);
    onChanged();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveCalibration = async () => {
    setSaving(true);
    await updateBackgroundCalibration(layout.id, companyId, { offsetX, offsetY, scale, opacity });
    setSaving(false);
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={handleFileChange} className="hidden" id="floorplan-upload-input" />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <ImageUp size={15} /> {uploading ? 'Enviando...' : layout.background_image_path ? 'Trocar planta' : 'Subir planta (imagem)'}
        </Button>
        <span className="text-xs text-fg-subtle">PNG, JPG ou SVG. PDF: exporte a página como imagem antes de subir.</span>
      </div>

      {layout.background_image_path && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Posição X</label>
            <input type="number" value={offsetX} onChange={e => setOffsetX(Number(e.target.value))} className="w-full p-2 border border-edge rounded-lg bg-surface text-sm text-fg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Posição Y</label>
            <input type="number" value={offsetY} onChange={e => setOffsetY(Number(e.target.value))} className="w-full p-2 border border-edge rounded-lg bg-surface text-sm text-fg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Escala</label>
            <input type="number" step={0.05} min={0.1} max={5} value={scale} onChange={e => setScale(Number(e.target.value))} className="w-full p-2 border border-edge rounded-lg bg-surface text-sm text-fg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-1">Opacidade</label>
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-full" />
          </div>
          <div className="col-span-2 md:col-span-4">
            <Button size="sm" onClick={handleSaveCalibration} disabled={saving}>{saving ? 'Salvando...' : 'Salvar calibração'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
