import type { LucideIcon } from 'lucide-react';
import {
  FileImage, Gauge, LayoutGrid, Layers, Printer, Scissors, Shuffle, Combine,
} from 'lucide-react';
import { DropZone } from './DropZone';
import type { ToolKey } from './PdfCenterEditor';

export type HomeAction = ToolKey | 'convert' | 'batch';

interface Tile {
  action: HomeAction;
  icon: LucideIcon;
  label: string;
  description: string;
}

const TILES: Tile[] = [
  { action: 'merge', icon: Combine, label: 'Unir e organizar', description: 'Junte vários PDFs, reordene e gire páginas' },
  { action: 'split', icon: Scissors, label: 'Dividir/extrair', description: 'Separe páginas por intervalo, em lote ou pares/ímpares' },
  { action: 'interleave', icon: Shuffle, label: 'Intercalar documentos', description: 'Alterne páginas entre dois ou mais PDFs' },
  { action: 'thermal', icon: Printer, label: 'Preparar etiquetas', description: 'Ajuste PDFs para impressoras térmicas (40×25, 100×150...)' },
  { action: 'nup', icon: LayoutGrid, label: 'Montar folhas', description: 'Várias páginas por folha, em grade, com marcas de corte' },
  { action: 'convert', icon: FileImage, label: 'Converter PDF/imagens', description: 'Imagens em PDF, ou páginas de PDF em imagem' },
  { action: 'batch', icon: Layers, label: 'Processar em lote', description: 'Aplique a mesma operação em vários arquivos de uma vez' },
  { action: 'optimize', icon: Gauge, label: 'Otimizar PDF', description: 'Reduza o tamanho sem prometer o que não pode entregar' },
];

interface PdfCenterHomeProps {
  onSelectAction: (action: HomeAction) => void;
  onFiles: (files: File[]) => void;
}

export function PdfCenterHome({ onSelectAction, onFiles }: PdfCenterHomeProps) {
  return (
    <div className="space-y-6">
      <DropZone
        accept="application/pdf"
        onFiles={onFiles}
        label="Arraste um ou mais PDFs aqui para começar"
        hint="Nada é enviado a servidor nenhum — tudo roda no seu navegador"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map(tile => (
          <button
            key={tile.action}
            onClick={() => onSelectAction(tile.action)}
            className="flex flex-col items-start gap-2 rounded-container border border-edge bg-surface-2 p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-3"
          >
            <tile.icon size={22} className="text-accent" />
            <span className="text-sm font-semibold text-fg">{tile.label}</span>
            <span className="text-xs text-fg-subtle">{tile.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
