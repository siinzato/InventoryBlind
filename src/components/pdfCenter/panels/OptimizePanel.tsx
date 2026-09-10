import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { Button, Select } from '../../ui';
import { resolvePageRefs } from '../../../lib/pdfCenter/pageModel';
import { buildPdfFromPageRefs, buildPdfFromImages, optimizeConservative } from '../../../lib/pdfCenter/pdfLibOps';
import { rasterizePdfPages, type RasterizeQuality } from '../../../lib/pdfCenter/pdfRenderOps';
import { getPdfjs } from '../../../lib/pdfCenter/pdfLoader';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Otimização (spec §10) — sempre opera sobre o documento atual do editor
 *  (todas as páginas, na ordem/rotação de agora), unido primeiro se vier de
 *  mais de uma fonte. NUNCA promete redução — o resumo mostra os dois
 *  tamanhos reais e deixa claro quando o resultado veio maior. */
export function OptimizePanel({ pages, sourceBytes, busy, setBusy, toast, onResult }: Props) {
  const [mode, setMode] = useState<'conservative' | 'rasterize'>('conservative');
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [rasterizeQuality, setRasterizeQuality] = useState<RasterizeQuality>('media');

  const handleGenerate = async () => {
    if (pages.length === 0) {
      toast('Não há páginas para otimizar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const merged = await buildPdfFromPageRefs(sourceBytes, resolvePageRefs(pages));

      if (mode === 'conservative') {
        const result = await optimizeConservative(merged, removeMetadata);
        const diff = result.optimizedSizeBytes - result.originalSizeBytes;
        const pct = result.originalSizeBytes > 0 ? Math.round((diff / result.originalSizeBytes) * 100) : 0;
        const summary = diff <= 0
          ? `${formatSize(result.originalSizeBytes)} -> ${formatSize(result.optimizedSizeBytes)} (${pct}%)`
          : `${formatSize(result.originalSizeBytes)} -> ${formatSize(result.optimizedSizeBytes)} — ficou maior; considere manter o original.`;
        onResult('Otimização concluída', [{ name: buildOutputFilename('documento-otimizado', { ext: 'pdf' }), bytes: result.bytes }], [], summary);
        return;
      }

      const pdfjs = await getPdfjs();
      const doc = await pdfjs.getDocument({ data: merged.slice() }).promise;
      const rasterized = await rasterizePdfPages(doc, rasterizeQuality);
      const bytes = await buildPdfFromImages(
        rasterized.map(r => ({ bytes: r.bytes, mime: r.mime, widthPt: r.widthPt, heightPt: r.heightPt })),
        { onePerPage: true, gridRows: 1, gridCols: 1, pageWidthPt: 0, pageHeightPt: 0, marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, fitMode: 'contain', fitToPage: false }
      );
      const pct = merged.byteLength > 0 ? Math.round(((bytes.byteLength - merged.byteLength) / merged.byteLength) * 100) : 0;
      onResult(
        'Otimização concluída',
        [{ name: buildOutputFilename('documento-otimizado', { ext: 'pdf' }), bytes }],
        ['Modo rasterização: texto pesquisável, links e vetores foram perdidos — o conteúdo virou imagem.'],
        `${formatSize(merged.byteLength)} -> ${formatSize(bytes.byteLength)} (${pct}%)`
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao otimizar o documento.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Modo</label>
        <Select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="max-w-sm">
          <option value="conservative">Conservador — preserva texto e vetores, sem garantia de redução</option>
          <option value="rasterize">Rasterização — converte páginas em imagem, perde texto pesquisável</option>
        </Select>
      </div>

      {mode === 'conservative' && (
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={removeMetadata} onChange={e => setRemoveMetadata(e.target.checked)} />
          Remover metadados (título, autor, etc.)
        </label>
      )}

      {mode === 'rasterize' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Qualidade</label>
          <Select value={rasterizeQuality} onChange={e => setRasterizeQuality(e.target.value as RasterizeQuality)} className="max-w-xs">
            <option value="alta">Alta (200 DPI)</option>
            <option value="media">Média (150 DPI)</option>
            <option value="compacta">Compacta (96 DPI)</option>
          </Select>
          <p className="text-xs text-fg-subtle">Texto pesquisável, links e vetores serão perdidos — as páginas viram imagem.</p>
        </div>
      )}

      <Button onClick={handleGenerate} disabled={busy}>
        <Gauge size={16} /> Otimizar
      </Button>
    </div>
  );
}
