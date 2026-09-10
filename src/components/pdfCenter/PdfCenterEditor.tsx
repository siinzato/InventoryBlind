import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftToLine, ArrowRightToLine, Copy, FlipHorizontal2, Plus, Redo2, RotateCw, Trash2, Undo2,
} from 'lucide-react';
import { Button, SegmentedControl, type SegmentedOption } from '../ui';
import { DropZone } from './DropZone';
import { PageThumbnailCard } from './PageThumbnailCard';
import type { PdfCenterPrefs } from '../../lib/pdfCenter/pdfCenterPrefs';
import type { SourceBytes } from '../../lib/pdfCenter/pdfLibOps';
import {
  clearSelection, deletePages, duplicatePages, invertOrder, movePages, moveToEnd, moveToStart,
  rotatePages, selectAll, selectedIds, toggleSelect,
} from '../../lib/pdfCenter/pageModel';
import type { PdfCenterHistory } from '../../lib/pdfCenter/usePdfCenterHistory';
import type { PdfCenterPage, PdfCenterSource } from '../../lib/pdfCenter/types';
import type { PreviewOutput } from './ResultPreviewModal';
import { MergeExportPanel } from './panels/MergeExportPanel';
import { SplitPanel } from './panels/SplitPanel';
import { InterleavePanel } from './panels/InterleavePanel';
import { ThermalPanel } from './panels/ThermalPanel';
import { SheetAssemblyPanel } from './panels/SheetAssemblyPanel';
import { PdfToImagePanel } from './panels/PdfToImagePanel';
import { OptimizePanel } from './panels/OptimizePanel';

// "Imagens -> PDF" fica de fora do editor de propósito: imagem crua não é
// página de PDF (não dá pra `copyPages` nela), então essa direção vive em
// ConvertPage.tsx, com sua própria lista de arquivos. "PDF -> Imagem" já
// funciona só com pdfjs (sem pdf-lib), então essa entra aqui como ferramenta
// do editor mesmo — opera direto sobre as páginas já carregadas.
export type ToolKey = 'merge' | 'split' | 'interleave' | 'thermal' | 'nup' | 'toImage' | 'optimize';

const TOOL_OPTIONS: SegmentedOption<ToolKey>[] = [
  { value: 'merge', label: 'Unir/Exportar' },
  { value: 'split', label: 'Dividir' },
  { value: 'interleave', label: 'Intercalar' },
  { value: 'thermal', label: 'Térmico' },
  { value: 'nup', label: 'Montar folhas' },
  { value: 'toImage', label: 'PDF -> Imagem' },
  { value: 'optimize', label: 'Otimizar' },
];

export interface PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
  sourceBytes: SourceBytes[];
  prefs: PdfCenterPrefs;
  onPrefsChange: (patch: Partial<PdfCenterPrefs>) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onResult: (title: string, outputs: PreviewOutput[], warnings?: string[], sizeSummary?: string) => void;
  getPdfjsDocFor: (sourceId: string) => import('pdfjs-dist').PDFDocumentProxy | undefined;
}

interface PdfCenterEditorProps extends Omit<PanelBaseProps, 'pages'> {
  history: PdfCenterHistory;
  onAddFiles: (files: File[]) => void;
  getThumbnail: (page: PdfCenterPage) => string | null;
  initialTool?: ToolKey;
}

export function PdfCenterEditor(props: PdfCenterEditorProps) {
  const { history, onAddFiles, getThumbnail, sources, initialTool, ...panelRest } = props;
  const { pages } = history;
  const [tool, setTool] = useState<ToolKey>(initialTool ?? 'merge');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sourceNameById = new Map(sources.map(s => [s.id, s.name]));
  const selection = selectedIds(pages);
  const hasSelection = selection.length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo(); else history.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection && document.activeElement === document.body) {
        e.preventDefault();
        history.set(prev => deletePages(prev, selectedIds(prev)));
        history.commit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history, hasSelection]);

  const handleDrop = () => {
    if (dragId && dragOverId && dragId !== dragOverId) {
      const targetIndex = pages.findIndex(p => p.id === dragOverId);
      history.set(prev => movePages(prev, [dragId], targetIndex));
      history.commit();
    }
    setDragId(null);
    setDragOverId(null);
  };

  if (pages.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <DropZone
          accept="application/pdf"
          onFiles={onAddFiles}
          label="Arraste arquivos PDF aqui, ou clique para escolher"
          hint="Para converter imagens em PDF, use Converter na tela inicial — processado só no seu navegador"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-container border border-edge bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => history.undo()} disabled={!history.canUndo} title="Desfazer (Ctrl+Z)"><Undo2 size={15} /></Button>
          <Button size="sm" variant="ghost" onClick={() => history.redo()} disabled={!history.canRedo} title="Refazer (Ctrl+Shift+Z)"><Redo2 size={15} /></Button>
          <span className="mx-1 h-5 w-px bg-edge" />
          <Button size="sm" variant="ghost" onClick={() => history.set(selectAll)} title="Selecionar todas">Todas</Button>
          <Button size="sm" variant="ghost" onClick={() => history.set(clearSelection)} title="Limpar seleção">Nenhuma</Button>
          <span className="mx-1 h-5 w-px bg-edge" />
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={() => { history.set(prev => rotatePages(prev, selectedIds(prev), 90)); history.commit(); }} title="Girar selecionadas 90°"><RotateCw size={15} /></Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={() => { history.set(prev => duplicatePages(prev, selectedIds(prev))); history.commit(); }} title="Duplicar selecionadas"><Copy size={15} /></Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={() => { history.set(prev => moveToStart(prev, selectedIds(prev))); history.commit(); }} title="Mover para o início"><ArrowLeftToLine size={15} /></Button>
          <Button size="sm" variant="ghost" disabled={!hasSelection} onClick={() => { history.set(prev => moveToEnd(prev, selectedIds(prev))); history.commit(); }} title="Mover para o fim"><ArrowRightToLine size={15} /></Button>
          <Button size="sm" variant="ghost" onClick={() => { history.set(invertOrder); history.commit(); }} title="Inverter ordem de todas"><FlipHorizontal2 size={15} /></Button>
          <Button size="sm" variant="danger" disabled={!hasSelection} onClick={() => { history.set(prev => deletePages(prev, selectedIds(prev))); history.commit(); }} title="Excluir selecionadas"><Trash2 size={15} /></Button>
        </div>
        <label className="cursor-pointer">
          <span className="inline-flex min-h-[38px] items-center gap-2 rounded-control border border-edge bg-surface-3 px-3 text-sm font-medium text-fg hover:bg-edge">
            <Plus size={15} /> Adicionar arquivos
          </span>
          <input type="file" accept="application/pdf" multiple className="hidden" onChange={e => { if (e.target.files) onAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {pages.map((page, i) => (
          <PageThumbnailCard
            key={page.id}
            page={page}
            displayIndex={i + 1}
            sourceName={sourceNameById.get(page.sourceId) ?? '—'}
            thumbnailUrl={getThumbnail(page)}
            isDragTarget={dragOverId === page.id && dragId !== page.id}
            onToggleSelect={id => history.set(prev => toggleSelect(prev, id))}
            onRotate={id => { history.set(prev => rotatePages(prev, [id], 90)); history.commit(); }}
            onDuplicate={id => { history.set(prev => duplicatePages(prev, [id])); history.commit(); }}
            onDelete={id => { history.set(prev => deletePages(prev, [id])); history.commit(); }}
            onDragStart={setDragId}
            onDragOverCard={setDragOverId}
            onDrop={handleDrop}
            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          />
        ))}
      </div>

      <div className="space-y-3 rounded-container border border-edge bg-surface-2 p-4">
        <SegmentedControl options={TOOL_OPTIONS} value={tool} onChange={setTool} label="Ferramenta" />
        {tool === 'merge' && <MergeExportPanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'split' && <SplitPanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'interleave' && <InterleavePanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'thermal' && <ThermalPanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'nup' && <SheetAssemblyPanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'toImage' && <PdfToImagePanel pages={pages} sources={sources} {...panelRest} />}
        {tool === 'optimize' && <OptimizePanel pages={pages} sources={sources} {...panelRest} />}
      </div>
    </div>
  );
}
