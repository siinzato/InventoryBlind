/**
 * PdfCenterPage — Central de PDFs
 *
 * Ferramenta separada em Ferramentas, mas do mesmo repositório/frontend —
 * mesmo padrão de BarcodeLabPage.tsx (sem Supabase, sem cadastro prévio,
 * preferências próprias em localStorage). Todo processamento é local: os
 * arquivos nunca saem do navegador (pdf-lib para estrutura, pdfjs-dist para
 * renderização, ambos rodando client-side).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileStack } from 'lucide-react';
import { PdfCenterHome, type HomeAction } from './PdfCenterHome';
import { PdfCenterEditor, type ToolKey } from './PdfCenterEditor';
import { ConvertPage } from './ConvertPage';
import { BatchPage } from './BatchPage';
import { ResultPreviewModal, type PreviewOutput } from './ResultPreviewModal';
import { ToastStack, useToasts } from '../ui';
import { loadPdfFile } from '../../lib/pdfCenter/pdfLoader';
import { renderPageThumbnail } from '../../lib/pdfCenter/pdfRenderOps';
import { addPagesFromSource } from '../../lib/pdfCenter/pageModel';
import { usePdfCenterHistory } from '../../lib/pdfCenter/usePdfCenterHistory';
import { loadPdfCenterPrefs, savePdfCenterPrefs, type PdfCenterPrefs } from '../../lib/pdfCenter/pdfCenterPrefs';
import { PdfCenterError, type PdfCenterPage as PdfCenterPageModel, type PdfCenterSource } from '../../lib/pdfCenter/types';
import type { SourceBytes } from '../../lib/pdfCenter/pdfLibOps';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type Mode = 'home' | 'editor' | 'convert' | 'batch';

interface SourceRuntime {
  bytes: Uint8Array;
  pdfjsDoc: PDFDocumentProxy;
  destroy: () => Promise<void>;
}

let _sid = 0;

function thumbKey(page: PdfCenterPageModel): string {
  return `${page.sourceId}:${page.sourcePageIndex}`;
}

interface PdfCenterPageProps {
  onBack: () => void;
}

export function PdfCenterPage({ onBack }: PdfCenterPageProps) {
  const [mode, setMode] = useState<Mode>('home');
  const [initialTool, setInitialTool] = useState<ToolKey>('merge');
  const [sources, setSources] = useState<PdfCenterSource[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, SourceRuntime>>({});
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const { toasts, toast } = useToasts();
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<PdfCenterPrefs>({});
  const [preview, setPreview] = useState<{ title: string; outputs: PreviewOutput[]; warnings: string[]; sizeSummary?: string } | null>(null);

  const history = usePdfCenterHistory([]);
  const runtimesRef = useRef(runtimes);
  runtimesRef.current = runtimes;

  useEffect(() => {
    const saved = loadPdfCenterPrefs();
    if (saved) setPrefs(saved);
  }, []);

  useEffect(() => {
    return () => { Object.values(runtimesRef.current).forEach(r => r.destroy()); };
  }, []);

  const handlePrefsChange = useCallback((patch: Partial<PdfCenterPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      savePdfCenterPrefs(next);
      return next;
    });
  }, []);

  const handleAddFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      try {
        const loaded = await loadPdfFile(file);
        const source: PdfCenterSource = {
          id: `src-${++_sid}`, name: file.name, kind: 'pdf', mimeType: 'application/pdf',
          sizeBytes: file.size, pageCount: loaded.numPages, file,
        };
        setSources(prev => [...prev, source]);
        setRuntimes(prev => ({ ...prev, [source.id]: { bytes: loaded.bytes, pdfjsDoc: loaded.pdfjsDoc, destroy: loaded.destroy } }));
        history.set(prev => addPagesFromSource(prev, source));
        history.commit();
      } catch (err) {
        toast(err instanceof PdfCenterError ? err.message : `Não foi possível abrir "${file.name}".`, 'error');
      }
    }
  }, [history, toast]);

  // Miniaturas progressivas: só renderiza o que ainda não tem cache (chave por
  // fonte+índice original, não por id da página — assim duplicar uma página
  // reaproveita a miniatura em vez de renderizar de novo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const page of history.pages) {
        if (cancelled) return;
        const key = thumbKey(page);
        if (thumbnails[key]) continue;
        const runtime = runtimes[page.sourceId];
        if (!runtime) continue;
        try {
          const url = await renderPageThumbnail(runtime.pdfjsDoc, page.sourcePageIndex + 1, 280);
          if (!cancelled) setThumbnails(prev => (prev[key] ? prev : { ...prev, [key]: url }));
        } catch {
          // Falha de render numa miniatura não trava as demais.
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.pages, runtimes]);

  const getThumbnail = useCallback((page: PdfCenterPageModel) => thumbnails[thumbKey(page)] ?? null, [thumbnails]);
  const getPdfjsDocFor = useCallback((sourceId: string) => runtimes[sourceId]?.pdfjsDoc, [runtimes]);

  const sourceBytes: SourceBytes[] = sources.map(s => ({ sourceId: s.id, bytes: runtimes[s.id]?.bytes ?? new Uint8Array() }));

  const handleResult = useCallback((title: string, outputs: PreviewOutput[], warnings: string[] = [], sizeSummary?: string) => {
    setPreview({ title, outputs, warnings, sizeSummary });
  }, []);

  const handleSelectHomeAction = (action: HomeAction) => {
    if (action === 'convert') { setMode('convert'); return; }
    if (action === 'batch') { setMode('batch'); return; }
    setInitialTool(action);
    setMode('editor');
  };

  const hasWork = history.pages.length > 0;

  const handleBack = () => {
    if (hasWork && !window.confirm('Sair sem baixar o resultado? Nada é salvo automaticamente — o trabalho será perdido.')) return;
    onBack();
  };

  const handleHomeFromEditor = () => {
    if (hasWork && !window.confirm('Voltar ao início descarta os arquivos carregados. Continuar?')) return;
    Object.values(runtimesRef.current).forEach(r => r.destroy());
    setSources([]);
    setRuntimes({});
    setThumbnails({});
    history.reset([]);
    setMode('home');
  };

  if (mode === 'convert') {
    return <ConvertPage onBack={() => setMode('home')} prefs={prefs} onPrefsChange={handlePrefsChange} />;
  }
  if (mode === 'batch') {
    return <BatchPage onBack={() => setMode('home')} />;
  }

  return (
    <div className="min-h-screen bg-surface-3">
      <ToastStack toasts={toasts} />

      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={mode === 'home' ? handleBack : handleHomeFromEditor} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
              <ArrowLeft size={16} /><span className="hidden sm:inline">{mode === 'home' ? 'Voltar' : 'Início'}</span>
            </button>
            <div className="flex items-center gap-2">
              <FileStack size={22} className="text-accent" />
              <div>
                <h1 className="text-title leading-tight">Central de PDFs</h1>
                <p className="text-xs text-fg-subtle hidden sm:block">Unir · dividir · intercalar · etiquetas · folhas · conversão · lote · otimização</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {mode === 'home' && <PdfCenterHome onSelectAction={handleSelectHomeAction} onFiles={files => { handleAddFiles(files); setMode('editor'); }} />}
        {mode === 'editor' && (
          <PdfCenterEditor
            key={initialTool}
            initialTool={initialTool}
            history={history}
            sources={sources}
            sourceBytes={sourceBytes}
            prefs={prefs}
            onPrefsChange={handlePrefsChange}
            busy={busy}
            setBusy={setBusy}
            toast={toast}
            onResult={handleResult}
            getPdfjsDocFor={getPdfjsDocFor}
            onAddFiles={handleAddFiles}
            getThumbnail={getThumbnail}
          />
        )}
      </div>

      <ResultPreviewModal
        open={preview != null}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ''}
        outputs={preview?.outputs ?? []}
        warnings={preview?.warnings}
        sizeSummary={preview?.sizeSummary}
      />
    </div>
  );
}
