import { useEffect, useState } from 'react';
import { getFloorPlanSignedUrl } from '../../lib/slottingLayoutService';
import type { WarehouseLayout } from '../../lib/supabase';

interface FloorPlanBackgroundProps {
  layout: WarehouseLayout;
  cellPixelSize: number;
}

/** Camada de imagem posicionada atrás da grade (rua/módulo/posição/etc.), alinhada pela
 *  calibração manual salva no layout (offset/escala/opacidade) — o bucket é privado, então
 *  a URL assinada é buscada sob demanda e expira, não é guardada junto com o path. */
export function FloorPlanBackground({ layout, cellPixelSize }: FloorPlanBackgroundProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (layout.background_image_path) {
      getFloorPlanSignedUrl(layout.background_image_path).then(url => { if (!cancelled) setSignedUrl(url); });
    } else {
      setSignedUrl(null);
    }
    return () => { cancelled = true; };
  }, [layout.background_image_path]);

  if (!signedUrl) return null;

  const gridWidthPx = layout.grid_width * cellPixelSize;
  const gridHeightPx = layout.grid_height * cellPixelSize;

  return (
    <img
      src={signedUrl}
      alt="Planta do armazém"
      className="absolute pointer-events-none select-none"
      style={{
        left: layout.background_offset_x,
        top: layout.background_offset_y,
        width: gridWidthPx * layout.background_scale,
        height: gridHeightPx * layout.background_scale,
        opacity: layout.background_opacity,
        objectFit: 'fill',
      }}
    />
  );
}
