import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileImage, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '../ui';
import { DropZone } from './DropZone';
import { SizePresetField, MarginField } from './SizeMarginFields';
import { CUSTOM_SIZE_ID, findSizePreset } from '../../lib/pdfCenter/sizePresets';
import { mmToPt } from '../../lib/pdfCenter/units';
import type { FitMode } from '../../lib/pdfCenter/types';
import { uniformInsets } from '../../lib/pdfCenter/types';
import { loadImageFile, type LoadedImageFile } from '../../lib/pdfCenter/imageFileOps';
import { buildPdfFromImages } from '../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../lib/pdfCenter/filenames';
import { PdfCenterError } from '../../lib/pdfCenter/types';
import type { PdfCenterPrefs } from '../../lib/pdfCenter/pdfCenterPrefs';
import { ResultPreviewModal, type PreviewOutput } from './ResultPreviewModal';
import { ToastStack } from './ToastStack';
import { useToasts } from './useToasts';

interface QueuedImage {
  id: string;
  file: File;
  loaded: LoadedImageFile;
  previewUrl: string;
}

interface ConvertPageProps {
  onBack: () => void;
  prefs: PdfCenterPrefs;
  onPrefsChange: (patch: Partial<PdfCenterPrefs>) => void;
}

let idCounter = 0;

/** Imagens -> PDF (spec §8) — self-contained: lista própria de imagens, não
 *  mistura com o editor de PDFs (imagem crua não é página de PDF). Página
 *  standalone (sem chrome compartilhado) — por isso tem seus PRÓPRIOS toasts
 *  e modal de prévia, em vez de depender dos da tela de origem. */
export function ConvertPage({ onBack, prefs, onPrefsChange }: ConvertPageProps) {
  const { toasts, toast } = useToasts();
  const [preview, setPreview] = useState<{ title: string; outputs: PreviewOutput[] } | null>(null);
  const [queue, setQueue] = useState<QueuedImage[]>([]);
  const [onePerPage, setOnePerPage] = useState(true);
  const [gridRows, setGridRows] = useState(2);
  const [gridCols, setGridCols] = useState(2);
  const [fitToPage, setFitToPage] = useState(true);
  const [sizePresetId, setSizePresetId] = useState(prefs.lastSizePresetId ?? 'a4');
  const [customW, setCustomW] = useState(prefs.lastCustomWidthMm ?? 210);
  const [customH, setCustomH] = useState(prefs.lastCustomHeightMm ?? 297);
  const [marginMm, setMarginMm] = useState(prefs.lastMarginMm ?? 10);
  const [fitMode, setFitMode] = useState<FitMode>(prefs.lastFitMode ?? 'contain');
  const [fileName, setFileName] = useState('imagens-convertidas');
  const [busy, setBusy] = useState(false);

  const preset = findSizePreset(sizePresetId);

  // Revoga todas as URLs de objeto ao desmontar a página — nenhuma sobra
  // depois que o usuário sai da tela (spec §12).
  const queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => () => { queueRef.current.forEach(q => URL.revokeObjectURL(q.previewUrl)); }, []);

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        const loaded = await loadImageFile(file);
        setQueue(prev => [...prev, { id: `img-${++idCounter}`, file, loaded, previewUrl: URL.createObjectURL(file) }]);
      } catch (err) {
        toast(err instanceof PdfCenterError ? err.message : `Não foi possível ler "${file.name}".`, 'error');
      }
    }
  };

  const handleRemove = (id: string) => {
    setQueue(prev => {
      const target = prev.find(q => q.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(q => q.id !== id);
    });
  };

  const handleGenerate = async () => {
    if (queue.length === 0) {
      toast('Adicione ao menos uma imagem.', 'error');
      return;
    }
    setBusy(true);
    try {
      const widthMm = sizePresetId === CUSTOM_SIZE_ID ? customW : preset?.widthMm ?? 210;
      const heightMm = sizePresetId === CUSTOM_SIZE_ID ? customH : preset?.heightMm ?? 297;
      onPrefsChange({ lastSizePresetId: sizePresetId, lastCustomWidthMm: customW, lastCustomHeightMm: customH, lastMarginMm: marginMm, lastFitMode: fitMode });

      const bytes = await buildPdfFromImages(
        queue.map(q => ({ bytes: q.loaded.bytes, mime: q.loaded.mime, widthPt: q.loaded.widthPt, heightPt: q.loaded.heightPt })),
        {
          onePerPage, gridRows, gridCols,
          pageWidthPt: mmToPt(widthMm), pageHeightPt: mmToPt(heightMm),
          marginPt: uniformInsets(mmToPt(marginMm)), fitMode, fitToPage,
        }
      );
      setPreview({ title: 'Conversão para PDF concluída', outputs: [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes }] });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao converter as imagens.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-3">
      <ToastStack toasts={toasts} />
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
            <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
          </button>
          <div className="flex items-center gap-2">
            <FileImage size={20} className="text-accent" />
            <h1 className="text-title leading-tight">Converter imagens em PDF</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <DropZone accept="image/png,image/jpeg,image/webp" onFiles={handleFiles} label="Arraste PNG, JPG ou WebP aqui, ou clique para escolher" compact />

        {queue.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {queue.map((q, i) => (
              <div key={q.id} className="relative rounded-container border border-edge bg-surface-2 p-2">
                <span className="absolute left-2 top-2 rounded bg-surface/80 px-1.5 text-[11px] font-medium text-fg-muted">{i + 1}</span>
                <img src={q.previewUrl} alt={q.file.name} className="aspect-square w-full rounded object-cover" />
                <button onClick={() => handleRemove(q.id)} className="absolute right-2 top-2 rounded bg-surface/80 p-1 text-fg-muted hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-4 rounded-container border border-edge bg-surface-2 p-4">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={onePerPage} onChange={e => setOnePerPage(e.target.checked)} />
            Uma imagem por página
          </label>

          {!onePerPage && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-fg-muted">Grade por folha:</label>
              <Input type="number" min={1} value={gridRows} onChange={e => setGridRows(Math.max(1, Number(e.target.value)))} className="w-16" />
              <span className="text-fg-subtle">×</span>
              <Input type="number" min={1} value={gridCols} onChange={e => setGridCols(Math.max(1, Number(e.target.value)))} className="w-16" />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={fitToPage} onChange={e => setFitToPage(e.target.checked)} />
            Ajustar ao tamanho da folha (desmarcado usa o tamanho original de cada imagem)
          </label>

          {fitToPage && (
            <>
              <SizePresetField presetId={sizePresetId} customWidthMm={customW} customHeightMm={customH} onPresetChange={setSizePresetId} onCustomChange={(w, h) => { setCustomW(w); setCustomH(h); }} />
              <div className="flex flex-wrap gap-4">
                <MarginField marginMm={marginMm} onChange={setMarginMm} />
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-fg-muted">Encaixe</label>
                  <Select value={fitMode} onChange={e => setFitMode(e.target.value as FitMode)}>
                    <option value="contain">Conter</option>
                    <option value="fill">Preencher</option>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-medium text-fg-muted">Nome do arquivo</label>
            <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
          </div>

          <Button onClick={handleGenerate} disabled={busy || queue.length === 0}>Gerar PDF</Button>
        </div>
      </div>

      <ResultPreviewModal
        open={preview != null}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ''}
        outputs={preview?.outputs ?? []}
      />
    </div>
  );
}
