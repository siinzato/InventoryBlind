import { useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface DropZoneProps {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label: string;
  hint?: string;
  compact?: boolean;
}

/** Mesmo padrão de drag-and-drop já usado em
 *  src/components/spreadsheet-comparator/FileUploadPanel.tsx: o próprio
 *  `<label>` é a área de soltar (clique-para-buscar sai de graça via
 *  semântica nativa do label). */
export function DropZone({ accept, multiple = true, onFiles, label, hint, compact = false }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    onFiles(Array.from(fileList));
  };

  return (
    <label
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      className={`flex flex-col items-center justify-center gap-2 rounded-container border-2 border-dashed text-center cursor-pointer transition-colors ${
        compact ? 'p-5' : 'p-10'
      } ${dragOver ? 'border-accent bg-accent/5' : 'border-edge hover:border-accent/60 hover:bg-surface-3'}`}
    >
      <UploadCloud size={compact ? 22 : 30} className={dragOver ? 'text-accent' : 'text-fg-subtle'} />
      <span className="text-sm font-medium text-fg">{label}</span>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
      />
    </label>
  );
}
