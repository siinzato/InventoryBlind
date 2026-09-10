import { useState } from 'react';
import { ImageDown } from 'lucide-react';
import { Button, Input, Select } from '../../ui';
import { exportPagesToImages, type PdfToImageFormat } from '../../../lib/pdfCenter/pdfRenderOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

/** PDF -> Imagem (spec §8) — só pdfjs, sem pdf-lib, por isso cabe como
 *  ferramenta do próprio editor (opera direto sobre as páginas carregadas). */
export function PdfToImagePanel({ pages, getPdfjsDocFor, busy, setBusy, toast, onResult }: Props) {
  const [scope, setScope] = useState<'selection' | 'all'>('all');
  const [format, setFormat] = useState<PdfToImageFormat>('png');
  const [dpi, setDpi] = useState(150);
  const [jpegQuality, setJpegQuality] = useState(85);
  const [whiteBackground, setWhiteBackground] = useState(true);
  const [fileName, setFileName] = useState('pagina');

  const selectedCount = pages.filter(p => p.selected).length;
  const targetPages = scope === 'selection' ? pages.filter(p => p.selected) : pages;

  const handleGenerate = async () => {
    if (targetPages.length === 0) {
      toast('Nenhuma página para converter.', 'error');
      return;
    }
    setBusy(true);
    try {
      const bySource = new Map<string, { page: PdfCenterPage; displayIndex: number }[]>();
      targetPages.forEach((page, i) => {
        const list = bySource.get(page.sourceId) ?? [];
        list.push({ page, displayIndex: i + 1 });
        bySource.set(page.sourceId, list);
      });

      const outputs: { name: string; bytes: Uint8Array }[] = [];
      for (const [sourceId, entries] of bySource) {
        const pdfjsDoc = getPdfjsDocFor(sourceId);
        if (!pdfjsDoc) continue;
        const images = await exportPagesToImages(pdfjsDoc, entries.map(e => e.page.sourcePageIndex + 1), { format, dpi, jpegQuality: jpegQuality / 100, whiteBackground });
        for (let i = 0; i < images.length; i++) {
          const bytes = new Uint8Array(await images[i].blob.arrayBuffer());
          outputs.push({ name: buildOutputFilename(fileName, { index: entries[i].displayIndex, ext: format }), bytes });
        }
      }

      if (outputs.length === 0) {
        toast('Não foi possível gerar as imagens.', 'error');
        return;
      }
      onResult('Conversão para imagem concluída', outputs);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao converter páginas em imagem.', 'error');
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

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Formato</label>
          <Select value={format} onChange={e => setFormat(e.target.value as PdfToImageFormat)}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">DPI</label>
          <Input type="number" min={36} max={600} value={dpi} onChange={e => setDpi(Number(e.target.value))} className="w-24" />
        </div>
        {format === 'jpeg' && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-fg-muted">Qualidade JPEG (%)</label>
            <Input type="number" min={10} max={100} value={jpegQuality} onChange={e => setJpegQuality(Number(e.target.value))} className="w-24" />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={whiteBackground} onChange={e => setWhiteBackground(e.target.checked)} />
        Fundo branco (evita manchas em áreas transparentes)
      </label>

      <p className="text-xs text-fg-subtle">Aumentar o DPI não recupera detalhes que o PDF original não tinha.</p>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome base do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <Button onClick={handleGenerate} disabled={busy || targetPages.length === 0}>
        <ImageDown size={16} /> Converter para imagem
      </Button>
    </div>
  );
}
