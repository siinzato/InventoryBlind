import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button, Input, Select } from '../../ui';
import { SizePresetField } from '../SizeMarginFields';
import { CUSTOM_SIZE_ID, findSizePreset } from '../../../lib/pdfCenter/sizePresets';
import { mmToPt } from '../../../lib/pdfCenter/units';
import { uniformInsets, type FitMode } from '../../../lib/pdfCenter/types';
import { resolvePageRefs } from '../../../lib/pdfCenter/pageModel';
import { buildThermalPdf } from '../../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { ThermalLayoutInput } from '../../../lib/pdfCenter/thermalLayout';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

export function ThermalPanel({ pages, sourceBytes, prefs, onPrefsChange, busy, setBusy, toast, onResult }: Props) {
  const [scope, setScope] = useState<'selection' | 'all'>('all');
  const [sizePresetId, setSizePresetId] = useState(prefs.lastSizePresetId ?? '100x150');
  const [customW, setCustomW] = useState(prefs.lastCustomWidthMm ?? 100);
  const [customH, setCustomH] = useState(prefs.lastCustomHeightMm ?? 150);
  const [fitMode, setFitMode] = useState<FitMode>(prefs.lastFitMode ?? 'contain');
  const [orientation, setOrientation] = useState<ThermalLayoutInput['orientation']>('auto');
  const [marginMm, setMarginMm] = useState(prefs.lastMarginMm ?? 0);
  const [scalePct, setScalePct] = useState(100);
  const [offsetXMm, setOffsetXMm] = useState(0);
  const [offsetYMm, setOffsetYMm] = useState(0);
  const [backgroundWhite, setBackgroundWhite] = useState(true);
  const [fileName, setFileName] = useState('etiquetas');

  const selectedCount = pages.filter(p => p.selected).length;
  const targetPages = scope === 'selection' ? pages.filter(p => p.selected) : pages;
  const preset = findSizePreset(sizePresetId);

  const handleGenerate = async () => {
    if (targetPages.length === 0) {
      toast('Nenhuma página para preparar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const widthMm = sizePresetId === CUSTOM_SIZE_ID ? customW : preset?.widthMm ?? 100;
      const heightMm = sizePresetId === CUSTOM_SIZE_ID ? customH : preset?.heightMm ?? 150;
      onPrefsChange({ lastSizePresetId: sizePresetId, lastCustomWidthMm: customW, lastCustomHeightMm: customH, lastFitMode: fitMode, lastMarginMm: marginMm });

      const result = await buildThermalPdf(sourceBytes, resolvePageRefs(targetPages), {
        targetWidthPt: mmToPt(widthMm),
        targetHeightPt: mmToPt(heightMm),
        fitMode, orientation,
        alignX: 'center', alignY: 'center',
        marginPt: uniformInsets(mmToPt(marginMm)),
        scale: scalePct / 100,
        offsetXPt: mmToPt(offsetXMm),
        offsetYPt: mmToPt(offsetYMm),
        backgroundWhite,
      });
      onResult('Preparo térmico concluído', [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes: result.bytes }], result.warnings);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao preparar as páginas.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Aplicar em</label>
        <Select value={scope} onChange={e => setScope(e.target.value as typeof scope)} className="max-w-xs">
          <option value="all">Todas as páginas ({pages.length})</option>
          <option value="selection" disabled={selectedCount === 0}>Somente selecionadas ({selectedCount})</option>
        </Select>
      </div>

      <SizePresetField presetId={sizePresetId} customWidthMm={customW} customHeightMm={customH} onPresetChange={setSizePresetId} onCustomChange={(w, h) => { setCustomW(w); setCustomH(h); }} />

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Encaixe</label>
          <Select value={fitMode} onChange={e => setFitMode(e.target.value as FitMode)}>
            <option value="contain">Conter (mostra tudo, pode sobrar margem)</option>
            <option value="fill">Preencher (pode recortar)</option>
            <option value="original">Original (só posiciona)</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Orientação</label>
          <Select value={orientation} onChange={e => setOrientation(e.target.value as typeof orientation)}>
            <option value="auto">Automática</option>
            <option value="retrato">Retrato</option>
            <option value="paisagem">Paisagem</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Margem (mm)</label>
          <Input type="number" min={0} step={0.5} value={marginMm} onChange={e => setMarginMm(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Escala (%)</label>
          <Input type="number" min={1} step={1} value={scalePct} onChange={e => setScalePct(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Deslocamento X (mm)</label>
          <Input type="number" step={0.5} value={offsetXMm} onChange={e => setOffsetXMm(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Deslocamento Y (mm)</label>
          <Input type="number" step={0.5} value={offsetYMm} onChange={e => setOffsetYMm(Number(e.target.value))} className="w-24" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={backgroundWhite} onChange={e => setBackgroundWhite(e.target.checked)} />
        Fundo branco
      </label>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <p className="text-xs text-fg-subtle">A rotação de cada página é a que já está definida no editor acima (botão de girar em cada card).</p>

      <Button onClick={handleGenerate} disabled={busy || targetPages.length === 0}>
        <Printer size={16} /> Gerar para impressão térmica
      </Button>
    </div>
  );
}
