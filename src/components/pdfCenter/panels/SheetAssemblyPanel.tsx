import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Button, Input, Select } from '../../ui';
import { SizePresetField } from '../SizeMarginFields';
import { CUSTOM_SIZE_ID, findSizePreset } from '../../../lib/pdfCenter/sizePresets';
import { mmToPt } from '../../../lib/pdfCenter/units';
import { uniformInsets, type FitMode } from '../../../lib/pdfCenter/types';
import { resolvePageRefs } from '../../../lib/pdfCenter/pageModel';
import { buildNupPdf, type ResolvedPageRef } from '../../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

type RepeatMode = 'sequence' | 'repeatOne' | 'repeatEach';

export function SheetAssemblyPanel({ pages, sourceBytes, prefs, onPrefsChange, busy, setBusy, toast, onResult }: Props) {
  const [sizePresetId, setSizePresetId] = useState(prefs.lastSizePresetId ?? 'a4');
  const [customW, setCustomW] = useState(prefs.lastCustomWidthMm ?? 210);
  const [customH, setCustomH] = useState(prefs.lastCustomHeightMm ?? 297);
  const [rows, setRows] = useState(prefs.lastNupRows ?? 2);
  const [cols, setCols] = useState(prefs.lastNupCols ?? 2);
  const [marginMm, setMarginMm] = useState(prefs.lastMarginMm ?? 10);
  const [spacingMm, setSpacingMm] = useState(5);
  const [fillOrder, setFillOrder] = useState<'linhas' | 'colunas'>('linhas');
  const [cellFit, setCellFit] = useState<FitMode>('contain');
  const [showCutMarks, setShowCutMarks] = useState(true);
  const [showBorder, setShowBorder] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('sequence');
  const [repeatOnePageIndex, setRepeatOnePageIndex] = useState(0);
  const [repeatOneTotal, setRepeatOneTotal] = useState(rows * cols);
  const [repeatEachCount, setRepeatEachCount] = useState(2);
  const [fileName, setFileName] = useState('folha-montada');

  const preset = findSizePreset(sizePresetId);
  const selectedPages = pages.filter(p => p.selected);
  const scopePages = selectedPages.length > 0 ? selectedPages : pages;

  const buildRefs = (): ResolvedPageRef[] => {
    if (repeatMode === 'repeatOne') {
      const page = pages[repeatOnePageIndex];
      if (!page) return [];
      const single = resolvePageRefs([page])[0];
      return Array.from({ length: Math.max(1, repeatOneTotal) }, () => single);
    }
    if (repeatMode === 'repeatEach') {
      return resolvePageRefs(scopePages).flatMap(ref => Array.from({ length: Math.max(1, repeatEachCount) }, () => ref));
    }
    return resolvePageRefs(scopePages);
  };

  const handleGenerate = async () => {
    const refs = buildRefs();
    if (refs.length === 0) {
      toast('Nenhuma página para montar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const widthMm = sizePresetId === CUSTOM_SIZE_ID ? customW : preset?.widthMm ?? 210;
      const heightMm = sizePresetId === CUSTOM_SIZE_ID ? customH : preset?.heightMm ?? 297;
      onPrefsChange({ lastSizePresetId: sizePresetId, lastCustomWidthMm: customW, lastCustomHeightMm: customH, lastNupRows: rows, lastNupCols: cols, lastMarginMm: marginMm });

      const result = await buildNupPdf(sourceBytes, refs, {
        pageWidthPt: mmToPt(widthMm), pageHeightPt: mmToPt(heightMm),
        rows, cols,
        marginPt: uniformInsets(mmToPt(marginMm)),
        spacingPt: { row: mmToPt(spacingMm), col: mmToPt(spacingMm) },
        fillOrder, cellFit, showCutMarks, showBorder,
      });
      if (result.bytes.byteLength === 0) {
        toast(result.warnings[0] ?? 'A grade não coube na folha.', 'error');
        return;
      }
      onResult('Montagem de folhas concluída', [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes: result.bytes }], result.warnings);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao montar as folhas.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SizePresetField presetId={sizePresetId} customWidthMm={customW} customHeightMm={customH} onPresetChange={setSizePresetId} onCustomChange={(w, h) => { setCustomW(w); setCustomH(h); }} />

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Linhas × colunas</label>
          <div className="flex items-center gap-2">
            <Input type="number" min={1} value={rows} onChange={e => setRows(Math.max(1, Number(e.target.value)))} className="w-16" />
            <span className="text-fg-subtle">×</span>
            <Input type="number" min={1} value={cols} onChange={e => setCols(Math.max(1, Number(e.target.value)))} className="w-16" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Margem (mm)</label>
          <Input type="number" min={0} step={0.5} value={marginMm} onChange={e => setMarginMm(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Espaçamento (mm)</label>
          <Input type="number" min={0} step={0.5} value={spacingMm} onChange={e => setSpacingMm(Number(e.target.value))} className="w-24" />
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Ordem de preenchimento</label>
          <Select value={fillOrder} onChange={e => setFillOrder(e.target.value as typeof fillOrder)}>
            <option value="linhas">Por linhas</option>
            <option value="colunas">Por colunas</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Encaixe em cada célula</label>
          <Select value={cellFit} onChange={e => setCellFit(e.target.value as FitMode)}>
            <option value="contain">Conter</option>
            <option value="fill">Preencher</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-fg">
        <label className="flex items-center gap-2"><input type="checkbox" checked={showCutMarks} onChange={e => setShowCutMarks(e.target.checked)} /> Marcas de corte</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showBorder} onChange={e => setShowBorder(e.target.checked)} /> Borda</label>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Conteúdo das células</label>
        <Select value={repeatMode} onChange={e => setRepeatMode(e.target.value as RepeatMode)} className="max-w-sm">
          <option value="sequence">Páginas diferentes, em sequência ({selectedPages.length > 0 ? `${selectedPages.length} selecionadas` : `${pages.length} páginas`})</option>
          <option value="repeatOne">Repetir uma única página</option>
          <option value="repeatEach">Repetir cada página {selectedPages.length > 0 ? 'selecionada' : ''} N vezes</option>
        </Select>
      </div>

      {repeatMode === 'repeatOne' && (
        <div className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-fg-muted">Página a repetir</label>
            <Select value={repeatOnePageIndex} onChange={e => setRepeatOnePageIndex(Number(e.target.value))}>
              {pages.map((_, i) => <option key={i} value={i}>Página {i + 1}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-fg-muted">Quantidade total</label>
            <Input type="number" min={1} value={repeatOneTotal} onChange={e => setRepeatOneTotal(Math.max(1, Number(e.target.value)))} className="w-24" />
          </div>
        </div>
      )}

      {repeatMode === 'repeatEach' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Repetições por página</label>
          <Input type="number" min={1} value={repeatEachCount} onChange={e => setRepeatEachCount(Math.max(1, Number(e.target.value)))} className="w-24" />
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <Button onClick={handleGenerate} disabled={busy}>
        <LayoutGrid size={16} /> Montar folhas
      </Button>
    </div>
  );
}
