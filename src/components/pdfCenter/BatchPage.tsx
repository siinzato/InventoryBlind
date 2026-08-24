import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Layers, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { Button, Input, Select } from '../ui';
import { DropZone } from './DropZone';
import { SizePresetField, MarginField } from './SizeMarginFields';
import { CUSTOM_SIZE_ID, findSizePreset } from '../../lib/pdfCenter/sizePresets';
import { mmToPt } from '../../lib/pdfCenter/units';
import { uniformInsets, type FitMode } from '../../lib/pdfCenter/types';
import { parsePageRanges } from '../../lib/pdfCenter/pageRanges';
import { computeSplitGroups } from '../../lib/pdfCenter/splitGroups';
import { loadPdfFile } from '../../lib/pdfCenter/pdfLoader';
import { buildPdfFromPageRefs, buildThermalPdf, optimizeConservative, getPdfLibPageCount, type ResolvedPageRef, type SourceBytes } from '../../lib/pdfCenter/pdfLibOps';
import { exportPagesToImages } from '../../lib/pdfCenter/pdfRenderOps';
import { runBatch, type BatchItemResult } from '../../lib/pdfCenter/batchRunner';
import { buildOutputFilename } from '../../lib/pdfCenter/filenames';
import { buildZip } from '../../lib/pdfCenter/zipExport';
import { downloadBytes } from '../../lib/pdfCenter/downloadFile';
import { ToastStack } from './ToastStack';
import { useToasts } from './useToasts';

type BatchOp = 'rotate' | 'thermal' | 'extract' | 'toImage' | 'optimize';
type OutputMode = 'zip' | 'individual' | 'merged';

interface BatchPageProps {
  onBack: () => void;
}

/** Página standalone (spec §9), sem chrome compartilhado — por isso tem seu
 *  próprio toast, igual ConvertPage.tsx. */
export function BatchPage({ onBack }: BatchPageProps) {
  const { toasts, toast } = useToasts();
  const [files, setFiles] = useState<File[]>([]);
  const [op, setOp] = useState<BatchOp>('optimize');
  const [outputMode, setOutputMode] = useState<OutputMode>('zip');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('lote');
  const [rotateDeg, setRotateDeg] = useState<90 | 180 | 270>(90);
  const [rangeText, setRangeText] = useState('1');
  const [extractMode, setExtractMode] = useState<'extract' | 'removeSelection'>('removeSelection');
  const [sizePresetId, setSizePresetId] = useState('100x150');
  const [customW, setCustomW] = useState(100);
  const [customH, setCustomH] = useState(150);
  const [marginMm, setMarginMm] = useState(0);
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const preset = findSizePreset(sizePresetId);

  const processOne = async (item: { input: File }): Promise<{ outputName: string; outputBytes: Uint8Array }> => {
    const file = item.input;
    const loaded = await loadPdfFile(file);
    try {
      return await processLoaded(file, loaded);
    } finally {
      await loaded.destroy();
    }
  };

  const processLoaded = async (file: File, loaded: Awaited<ReturnType<typeof loadPdfFile>>): Promise<{ outputName: string; outputBytes: Uint8Array }> => {
    const source: SourceBytes = { sourceId: 'x', bytes: loaded.bytes };
    const allRefs: ResolvedPageRef[] = Array.from({ length: loaded.numPages }, (_, i) => ({ sourceId: 'x', sourcePageIndex: i, rotationCw: 0 }));
    const namePart = { prefix: prefix || undefined, suffix: suffix || undefined };

    if (op === 'rotate') {
      const bytes = await buildPdfFromPageRefs([source], allRefs.map(r => ({ ...r, rotationCw: rotateDeg })));
      return { outputName: buildOutputFilename(file.name, { ...namePart, ext: 'pdf' }), outputBytes: bytes };
    }

    if (op === 'optimize') {
      const merged = await buildPdfFromPageRefs([source], allRefs);
      const result = await optimizeConservative(merged, true);
      return { outputName: buildOutputFilename(file.name, { ...namePart, ext: 'pdf' }), outputBytes: result.bytes };
    }

    if (op === 'extract') {
      const parsed = parsePageRanges(rangeText, loaded.numPages);
      if (!parsed.ok) throw new Error(parsed.errors[0]);
      const { groups } = computeSplitGroups(loaded.numPages, extractMode, { selectedIndices: parsed.indices });
      if (groups.length === 0 || groups[0].length === 0) throw new Error('Nenhuma página resultante.');
      const bytes = await buildPdfFromPageRefs([source], groups[0].map(i => ({ sourceId: 'x', sourcePageIndex: i, rotationCw: 0 })));
      return { outputName: buildOutputFilename(file.name, { ...namePart, ext: 'pdf' }), outputBytes: bytes };
    }

    if (op === 'thermal') {
      const widthMm = sizePresetId === CUSTOM_SIZE_ID ? customW : preset?.widthMm ?? 100;
      const heightMm = sizePresetId === CUSTOM_SIZE_ID ? customH : preset?.heightMm ?? 150;
      const result = await buildThermalPdf([source], allRefs, {
        targetWidthPt: mmToPt(widthMm), targetHeightPt: mmToPt(heightMm),
        fitMode, orientation: 'auto', alignX: 'center', alignY: 'center',
        marginPt: uniformInsets(mmToPt(marginMm)), scale: 1, offsetXPt: 0, offsetYPt: 0, backgroundWhite: true,
      });
      return { outputName: buildOutputFilename(file.name, { ...namePart, ext: 'pdf' }), outputBytes: result.bytes };
    }

    // toImage: só a primeira página vira o "resultado" para caber no contrato
    // 1-arquivo-de-entrada -> 1-arquivo-de-saída do runBatch; múltiplas
    // páginas de origem geram outputs extras fora do runBatch (ver handleRun).
    const images = await exportPagesToImages(loaded.pdfjsDoc, [1], { format: 'png', dpi: 150, jpegQuality: 0.9, whiteBackground: true });
    const bytes = new Uint8Array(await images[0].blob.arrayBuffer());
    return { outputName: buildOutputFilename(file.name, { ...namePart, ext: 'png' }), outputBytes: bytes };
  };

  const handleRun = async () => {
    if (files.length === 0) {
      toast('Adicione arquivos ao lote.', 'error');
      return;
    }
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: files.length });

    const items = files.map((f, i) => ({ id: `${i}-${f.name}`, input: f, label: f.name }));
    const runResults = await runBatch(items, {
      process: processOne,
      onProgress: (_r, done, total) => setProgress({ done, total }),
    });
    setResults(runResults);
    setRunning(false);

    const succeeded = runResults.filter(r => r.status === 'done' && r.outputBytes);
    if (succeeded.length === 0) {
      toast('Nenhum arquivo foi processado com sucesso.', 'error');
      return;
    }

    if (outputMode === 'individual') {
      succeeded.forEach(r => downloadBytes(r.outputBytes!, r.outputName!, r.outputName!.endsWith('.png') ? 'image/png' : 'application/pdf'));
    } else if (outputMode === 'zip') {
      const zip = await buildZip(succeeded.map(r => ({ name: r.outputName!, data: r.outputBytes! })));
      downloadBytes(new Uint8Array(await zip.arrayBuffer()), 'lote-central-de-pdfs.zip', 'application/zip');
    } else {
      const pdfResults = succeeded.filter(r => r.outputName!.endsWith('.pdf'));
      if (pdfResults.length === 0) {
        toast('Nenhum resultado é PDF — use "ZIP" ou "individual" para imagens.', 'error');
        return;
      }
      const sources: SourceBytes[] = pdfResults.map((r, i) => ({ sourceId: `r${i}`, bytes: r.outputBytes! }));
      const refs: ResolvedPageRef[] = [];
      for (let i = 0; i < pdfResults.length; i++) {
        const count = await getPdfLibPageCount(pdfResults[i].outputBytes!);
        for (let p = 0; p < count; p++) refs.push({ sourceId: `r${i}`, sourcePageIndex: p, rotationCw: 0 });
      }
      const merged = await buildPdfFromPageRefs(sources, refs);
      downloadBytes(merged, 'lote-unido.pdf', 'application/pdf');
    }

    toast(`Lote concluído: ${succeeded.length}/${files.length} processado(s).`, succeeded.length === files.length ? 'success' : 'info');
  };

  const handleRetryFailed = () => {
    const failedNames = new Set(results.filter(r => r.status === 'error').map(r => r.label));
    setFiles(prev => prev.filter(f => failedNames.has(f.name)));
    setResults([]);
  };

  const failedCount = results.filter(r => r.status === 'error').length;

  return (
    <div className="min-h-screen bg-surface-3">
      <ToastStack toasts={toasts} />
      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
            <ArrowLeft size={16} /><span className="hidden sm:inline">Voltar</span>
          </button>
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-accent" />
            <h1 className="text-title leading-tight">Processar em lote</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <DropZone
          accept="application/pdf"
          onFiles={fs => setFiles(prev => [...prev, ...fs])}
          label="Arraste vários arquivos PDF aqui, ou clique para escolher"
          compact
        />

        {files.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-container border border-edge bg-surface-2 p-2 text-sm">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="truncate text-fg-muted">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-red-500">×</button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-4 rounded-container border border-edge bg-surface-2 p-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-fg-muted">Operação</label>
            <Select value={op} onChange={e => setOp(e.target.value as BatchOp)} className="max-w-sm">
              <option value="optimize">Otimizar (conservador)</option>
              <option value="rotate">Rotacionar todas as páginas</option>
              <option value="thermal">Recorte/redimensionamento térmico</option>
              <option value="extract">Extrair/remover páginas</option>
              <option value="toImage">Converter 1ª página em imagem</option>
            </Select>
          </div>

          {op === 'rotate' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg-muted">Girar (graus, sentido horário)</label>
              <Select value={rotateDeg} onChange={e => setRotateDeg(Number(e.target.value) as 90 | 180 | 270)} className="w-32">
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </Select>
            </div>
          )}

          {op === 'extract' && (
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg-muted">Ação</label>
                <Select value={extractMode} onChange={e => setExtractMode(e.target.value as typeof extractMode)}>
                  <option value="removeSelection">Remover estas páginas</option>
                  <option value="extract">Manter só estas páginas</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-fg-muted">Páginas (ex.: 1-3,5)</label>
                <Input value={rangeText} onChange={e => setRangeText(e.target.value)} className="w-40" />
              </div>
            </div>
          )}

          {op === 'thermal' && (
            <>
              <SizePresetField presetId={sizePresetId} customWidthMm={customW} customHeightMm={customH} onPresetChange={setSizePresetId} onCustomChange={(w, h) => { setCustomW(w); setCustomH(h); }} />
              <div className="flex flex-wrap gap-4">
                <MarginField marginMm={marginMm} onChange={setMarginMm} />
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-fg-muted">Encaixe</label>
                  <Select value={fitMode} onChange={e => setFitMode(e.target.value as FitMode)}>
                    <option value="contain">Conter</option>
                    <option value="fill">Preencher</option>
                    <option value="original">Original</option>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg-muted">Prefixo no nome</label>
              <Input value={prefix} onChange={e => setPrefix(e.target.value)} className="w-32" />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg-muted">Sufixo no nome</label>
              <Input value={suffix} onChange={e => setSuffix(e.target.value)} className="w-32" />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-fg-muted">Saída</label>
              <Select value={outputMode} onChange={e => setOutputMode(e.target.value as OutputMode)}>
                <option value="zip">Um ZIP com tudo</option>
                <option value="individual">Um download por arquivo</option>
                <option value="merged">Unir tudo em um único PDF</option>
              </Select>
            </div>
          </div>

          <Button onClick={handleRun} disabled={running || files.length === 0}>
            {running ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
            {running ? `Processando ${progress.done}/${progress.total}...` : 'Processar lote'}
          </Button>
        </div>

        {results.length > 0 && (
          <div className="space-y-2 rounded-container border border-edge bg-surface-2 p-4">
            <h2 className="text-sm font-semibold text-fg">Resultado do lote</h2>
            <ul className="space-y-1 text-sm">
              {results.map(r => (
                <li key={r.id} className="flex items-center gap-2">
                  {r.status === 'done' ? <CheckCircle2 size={15} className="text-emerald-500" /> : <XCircle size={15} className="text-red-500" />}
                  <span className="text-fg-muted">{r.label}</span>
                  {r.error && <span className="text-xs text-red-500">— {r.error}</span>}
                </li>
              ))}
            </ul>
            {failedCount > 0 && (
              <Button size="sm" variant="secondary" onClick={handleRetryFailed}>
                <RotateCcw size={14} /> Repetir só as {failedCount} que falharam
              </Button>
            )}
          </div>
        )}

        <p className="text-xs text-fg-subtle">Um arquivo inválido não interrompe o lote — ele aparece marcado com o motivo da falha, e o restante continua.</p>
      </div>
    </div>
  );
}
