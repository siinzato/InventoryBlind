import { Copy, GripVertical, RotateCw, Trash2 } from 'lucide-react';
import type { PdfCenterPage } from '../../lib/pdfCenter/types';

interface PageThumbnailCardProps {
  page: PdfCenterPage;
  displayIndex: number;
  sourceName: string;
  thumbnailUrl: string | null;
  isDragTarget: boolean;
  onToggleSelect: (id: string) => void;
  onRotate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOverCard: (id: string) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/** Um card de página no editor visual — miniatura + seleção + ações rápidas
 *  + arrastar-e-soltar nativo (HTML5 DnD, sem lib nova). A rotação NATIVA da
 *  página já vem certa na própria miniatura (pdfjs desenha respeitando
 *  `/Rotate`); a rotação extra do editor é só um `transform: rotate()` em
 *  cima — instantâneo, sem re-renderizar via pdfjs a cada clique. */
export function PageThumbnailCard({
  page, displayIndex, sourceName, thumbnailUrl, isDragTarget,
  onToggleSelect, onRotate, onDuplicate, onDelete,
  onDragStart, onDragOverCard, onDrop, onDragEnd,
}: PageThumbnailCardProps) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(page.id)}
      onDragOver={e => { e.preventDefault(); onDragOverCard(page.id); }}
      onDrop={e => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`group relative flex flex-col gap-2 rounded-container border p-2 transition-colors ${
        page.selected ? 'border-accent bg-accent/5' : 'border-edge bg-surface-2'
      } ${isDragTarget ? 'ring-2 ring-accent' : ''}`}
    >
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={page.selected} onChange={() => onToggleSelect(page.id)} className="h-4 w-4 accent-[var(--color-accent)]" />
          <span className="text-xs font-medium text-fg-muted">#{displayIndex}</span>
        </label>
        <GripVertical size={14} className="text-fg-subtle cursor-grab" />
      </div>

      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-surface-3">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Página ${displayIndex}`}
            className="max-h-full max-w-full object-contain transition-transform"
            style={{ transform: `rotate(${page.rotation}deg)` }}
          />
        ) : (
          <div className="h-6 w-6 animate-pulse rounded bg-surface" />
        )}
      </div>

      <span className="truncate text-[11px] text-fg-subtle" title={sourceName}>{sourceName}</span>

      <div className="flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <button onClick={() => onRotate(page.id)} title="Girar 90°" className="rounded p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg">
          <RotateCw size={14} />
        </button>
        <button onClick={() => onDuplicate(page.id)} title="Duplicar" className="rounded p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg">
          <Copy size={14} />
        </button>
        <button onClick={() => onDelete(page.id)} title="Excluir" className="rounded p-1.5 text-fg-muted hover:bg-red-500/10 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
