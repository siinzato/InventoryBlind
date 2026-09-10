import { Panel, useReactFlow } from '@xyflow/react';
import { LayoutGrid, Map, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
}

const buttonClass = 'flex h-8 w-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40';

/** Barra de ferramentas do canvas — zoom, ajustar à tela, auto-organizar,
 *  desfazer/refazer, minimapa (§7/§17/§20). Vive DENTRO do <ReactFlow>
 *  (Panel), não como prop-drilling de um ref imperativo até um componente
 *  irmão — é o próprio padrão do React Flow para controles com acesso à
 *  instância (`useReactFlow`). */
export function FlowToolbar({ canUndo, canRedo, onUndo, onRedo, onAutoLayout, showMiniMap, onToggleMiniMap }: Props) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="top-right">
      <div className="flex items-center gap-0.5 rounded-container border border-edge bg-surface-2 p-1 shadow-panel">
        <button type="button" className={buttonClass} onClick={onUndo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
          <Undo2 size={15} />
        </button>
        <button type="button" className={buttonClass} onClick={onRedo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
          <Redo2 size={15} />
        </button>
        <div className="mx-0.5 h-5 w-px bg-edge" />
        <button type="button" className={buttonClass} onClick={() => zoomOut()} title="Diminuir zoom" aria-label="Diminuir zoom">
          <ZoomOut size={15} />
        </button>
        <button type="button" className={buttonClass} onClick={() => zoomIn()} title="Aumentar zoom" aria-label="Aumentar zoom">
          <ZoomIn size={15} />
        </button>
        <div className="mx-0.5 h-5 w-px bg-edge" />
        <button type="button" className={buttonClass} onClick={() => fitView({ duration: 200 })} title="Ajustar à tela (F)" aria-label="Ajustar à tela">
          <LayoutGrid size={15} className="rotate-45" />
        </button>
        <button type="button" className={buttonClass} onClick={onAutoLayout} title="Auto-organizar" aria-label="Auto-organizar o fluxo">
          <LayoutGrid size={15} />
        </button>
        <button
          type="button"
          className={`${buttonClass} ${showMiniMap ? 'bg-surface-3 text-fg' : ''}`}
          onClick={onToggleMiniMap}
          title={showMiniMap ? 'Ocultar minimapa' : 'Mostrar minimapa'}
          aria-label="Alternar minimapa"
        >
          <Map size={15} />
        </button>
      </div>
    </Panel>
  );
}
