import React, { useMemo, useRef, useState } from 'react';
import { Upload, X, AlertTriangle, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { ComparatorBaseState, createEmptyBaseState, CellValue } from '../../lib/spreadsheet-comparator/types';
import { readSpreadsheetGrid, detectHeaderRowIndex, buildParsedSheet, validateFileBeforeParse } from '../../lib/spreadsheet-comparator/fileParser';
import { SheetPreview } from './SheetPreview';

interface FileUploadPanelProps {
  base: ComparatorBaseState;
  onChange: (patch: Partial<ComparatorBaseState>) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function rowPreviewText(row: CellValue[] | undefined): string {
  if (!row) return '';
  return row.filter(c => c !== undefined).slice(0, 4).join(' · ') || '(linha vazia)';
}

export const FileUploadPanel: React.FC<FileUploadPanelProps> = ({ base, onChange }) => {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => buildParsedSheet(base.grid, base.headerRowIndex, base.truncated), [base.grid, base.headerRowIndex, base.truncated]);

  const loadFile = async (file: File, sheetName?: string) => {
    const validationError = validateFileBeforeParse(file);
    if (validationError) { onChange({ error: validationError, file: null }); return; }

    onChange({ loading: true, error: null, file });
    try {
      const gridResult = await readSpreadsheetGrid(file, sheetName);
      if (gridResult.grid.length === 0) {
        onChange({ loading: false, error: 'O arquivo não contém nenhuma linha com dados.' });
        return;
      }
      const headerRowIndex = detectHeaderRowIndex(gridResult.grid);
      onChange({
        loading: false, error: null,
        sheetNames: gridResult.sheetNames, activeSheet: gridResult.activeSheet,
        grid: gridResult.grid, headerRowIndex, truncated: gridResult.truncated,
        meta: { name: file.name, sizeBytes: file.size, totalRows: gridResult.grid.length, totalColumns: gridResult.grid[0]?.length ?? 0 },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível ler o arquivo.';
      onChange({ loading: false, error: message });
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (base.file) loadFile(base.file, sheetName);
  };

  const handleRemove = () => {
    onChange(createEmptyBaseState(base.label));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const headerRowOptions = base.grid.slice(0, 15);

  return (
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-3 flex items-center gap-2">
        <FileSpreadsheet size={16} className="text-fg-subtle" />{base.label}
      </h2>

      {!base.meta ? (
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-edge hover:border-accent hover:bg-accent/5'}`}
        >
          {base.loading ? <RefreshCw size={24} className="animate-spin text-fg-subtle" /> : <Upload size={24} className="text-fg-subtle" />}
          <p className="text-sm text-fg-muted">{base.loading ? 'Lendo arquivo...' : 'Arraste ou clique para enviar XLSX, XLS ou CSV'}</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" disabled={base.loading} className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
        </label>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2 p-3 bg-surface-3 rounded-lg">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg truncate">{base.meta.name}</p>
              <p className="text-xs text-fg-subtle mt-0.5">
                {formatBytes(base.meta.sizeBytes)} · {parsed.rows.length} linha(s) · {parsed.headers.length} coluna(s)
                {base.truncated ? ' · arquivo cortado no limite de linhas' : ''}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={() => inputRef.current?.click()} title="Trocar arquivo" className="p-1.5 text-fg-subtle hover:text-fg hover:bg-surface rounded">
                <Upload size={14} />
              </button>
              <button onClick={handleRemove} title="Remover" className="p-1.5 text-fg-subtle hover:text-red-600 dark:hover:text-red-400 hover:bg-surface rounded">
                <X size={14} />
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
            </div>
          </div>

          {base.sheetNames.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Aba</label>
              <select value={base.activeSheet ?? ''} onChange={e => handleSheetChange(e.target.value)}
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
                {base.sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Linha de cabeçalho</label>
            <select value={base.headerRowIndex} onChange={e => onChange({ headerRowIndex: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
              {headerRowOptions.map((row, idx) => (
                <option key={idx} value={idx}>Linha {idx + 1}: {rowPreviewText(row)}</option>
              ))}
            </select>
          </div>

          <SheetPreview headers={parsed.headers} rows={parsed.rows} />
        </div>
      )}

      {base.error && (
        <div className="mt-3 flex items-center gap-2 p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
          <AlertTriangle size={16} className="flex-shrink-0" /><span>{base.error}</span>
        </div>
      )}
    </div>
  );
};

export default FileUploadPanel;
