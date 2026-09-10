import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Input } from '../../ui';
import { SizePresetField } from '../SizeMarginFields';
import { CUSTOM_SIZE_ID, findSizePreset } from '../../../lib/pdfCenter/sizePresets';
import { mmToPt } from '../../../lib/pdfCenter/units';
import { resolvePageRefs, selectedIds } from '../../../lib/pdfCenter/pageModel';
import { buildPdfFromPageRefs, buildThermalPdf } from '../../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

/** "Unir e organizar" (spec §5) — o editor já cuidou de ordenar/selecionar/
 *  girar; aqui só decide QUAIS páginas entram e se o tamanho é padronizado. */
export function MergeExportPanel({ pages, sourceBytes, prefs, onPrefsChange, busy, setBusy, toast, onResult }: Props) {
  const [onlySelected, setOnlySelected] = useState(false);
  const [standardize, setStandardize] = useState(false);
  const [sizePresetId, setSizePresetId] = useState(prefs.lastSizePresetId ?? 'a4');
  const [customW, setCustomW] = useState(prefs.lastCustomWidthMm ?? 100);
  const [customH, setCustomH] = useState(prefs.lastCustomHeightMm ?? 150);
  const [fileName, setFileName] = useState('documento-unido');

  const selection = selectedIds(pages);
  const targetPages = onlySelected ? pages.filter(p => p.selected) : pages;
  const preset = findSizePreset(sizePresetId);
  const totalOriginalBytes = sourceBytes.reduce((sum, s) => sum + s.bytes.byteLength, 0);

  const handleGenerate = async () => {
    if (targetPages.length === 0) {
      toast(onlySelected ? 'Nenhuma página selecionada.' : 'Não há páginas para unir.', 'error');
      return;
    }
    setBusy(true);
    try {
      const refs = resolvePageRefs(targetPages);
      onPrefsChange({ lastSizePresetId: sizePresetId, lastCustomWidthMm: customW, lastCustomHeightMm: customH });

      if (!standardize) {
        const bytes = await buildPdfFromPageRefs(sourceBytes, refs);
        onResult('União concluída', [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes }]);
        return;
      }

      const widthMm = sizePresetId === CUSTOM_SIZE_ID ? customW : preset?.widthMm ?? 210;
      const heightMm = sizePresetId === CUSTOM_SIZE_ID ? customH : preset?.heightMm ?? 297;
      const result = await buildThermalPdf(sourceBytes, refs, {
        targetWidthPt: mmToPt(widthMm), targetHeightPt: mmToPt(heightMm),
        fitMode: 'contain', orientation: 'auto', alignX: 'center', alignY: 'center',
        marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, offsetXPt: 0, offsetYPt: 0,
        backgroundWhite: true,
      });
      onResult('União concluída', [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes: result.bytes }], result.warnings);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao unir os arquivos.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-fg-subtle">
        {pages.length} página(s) de origem · {(totalOriginalBytes / 1024).toFixed(0)} KB no total
        {selection.length > 0 && ` · ${selection.length} selecionada(s)`}
      </p>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)} disabled={selection.length === 0} />
        Incluir apenas as páginas selecionadas
      </label>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={standardize} onChange={e => setStandardize(e.target.checked)} />
        Padronizar o tamanho de todas as páginas (por padrão, mantém o tamanho original de cada uma)
      </label>

      {standardize && (
        <SizePresetField presetId={sizePresetId} customWidthMm={customW} customHeightMm={customH} onPresetChange={setSizePresetId} onCustomChange={(w, h) => { setCustomW(w); setCustomH(h); }} />
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <Button onClick={handleGenerate} disabled={busy || targetPages.length === 0}>
        <Download size={16} /> Gerar PDF unido
      </Button>
    </div>
  );
}
