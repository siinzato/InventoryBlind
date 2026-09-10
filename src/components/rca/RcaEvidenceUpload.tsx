import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';

interface RcaEvidenceUploadProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/** Anexo opcional de fotos/evidências dentro do RcaClassificationModal — multi-arquivo,
 *  local até o "Concluir Classificação" ser confirmado (o upload de fato acontece só
 *  depois que o rca_record correspondente existe, via rcaService.uploadEvidence). */
export function RcaEvidenceUpload({ files, onChange }: RcaEvidenceUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    onChange([...files, ...selected]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (index: number) => onChange(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
      >
        <Paperclip size={12} /> Anexar evidência (foto/arquivo)
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,.pdf" multiple className="hidden" onChange={handleSelect} />
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-fg-muted bg-surface-3 rounded-lg px-2.5 py-1.5">
              <span className="truncate">{f.name}</span>
              <button type="button" onClick={() => removeAt(i)} className="text-fg-subtle hover:text-red-500 flex-shrink-0">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
