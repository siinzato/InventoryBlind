import { useState } from 'react';
import { Scissors } from 'lucide-react';
import { Button, Input, Select } from '../../ui';
import { formatPageRanges, parsePageRanges } from '../../../lib/pdfCenter/pageRanges';
import { computeSplitGroups, type SplitMode } from '../../../lib/pdfCenter/splitGroups';
import { resolvePageRefs } from '../../../lib/pdfCenter/pageModel';
import { buildPdfFromPageRefs } from '../../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

const MODE_LABELS: Record<SplitMode, string> = {
  extract: 'Extrair páginas selecionadas',
  removeSelection: 'Remover selecionadas e salvar o restante',
  onePerFile: 'Uma página por arquivo',
  everyN: 'Dividir a cada N páginas',
  oddEven: 'Separar ímpares e pares',
};

export function SplitPanel({ pages, sourceBytes, busy, setBusy, toast, onResult }: Props) {
  const [mode, setMode] = useState<SplitMode>('extract');
  const [rangeText, setRangeText] = useState('');
  const [everyN, setEveryN] = useState(1);
  const [fileName, setFileName] = useState('documento');

  const needsRange = mode === 'extract' || mode === 'removeSelection';

  const handleUseSelection = () => {
    const indices = pages.reduce<number[]>((acc, p, i) => (p.selected ? [...acc, i] : acc), []);
    setRangeText(formatPageRanges(indices));
  };

  const handleGenerate = async () => {
    let selectedIndices: number[] | undefined;
    if (needsRange) {
      const parsed = parsePageRanges(rangeText, pages.length);
      if (!parsed.ok) {
        toast(parsed.errors[0], 'error');
        return;
      }
      selectedIndices = parsed.indices;
    }

    const { groups, warnings } = computeSplitGroups(pages.length, mode, { selectedIndices, everyN });
    if (groups.length === 0) {
      toast(warnings[0] ?? 'Nada para gerar.', 'error');
      return;
    }

    setBusy(true);
    try {
      const outputs = await Promise.all(groups.map(async (group, i) => {
        const groupPages = group.map(idx => pages[idx]);
        const bytes = await buildPdfFromPageRefs(sourceBytes, resolvePageRefs(groupPages));
        return { name: buildOutputFilename(fileName, { index: groups.length > 1 ? i + 1 : undefined, ext: 'pdf' }), bytes };
      }));
      onResult('Divisão concluída', outputs, warnings);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao dividir o documento.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Modo de divisão</label>
        <Select value={mode} onChange={e => setMode(e.target.value as SplitMode)} className="max-w-xs">
          {(Object.keys(MODE_LABELS) as SplitMode[]).map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </Select>
      </div>

      {needsRange && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Páginas (ex.: 1-3,5,8-10)</label>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={rangeText} onChange={e => setRangeText(e.target.value)} placeholder="1-3,5,8-10" className="max-w-xs" />
            <Button size="sm" variant="secondary" onClick={handleUseSelection}>Usar seleção atual</Button>
          </div>
        </div>
      )}

      {mode === 'everyN' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Páginas por arquivo</label>
          <Input type="number" min={1} value={everyN} onChange={e => setEveryN(Math.max(1, Number(e.target.value)))} className="w-24" />
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome base do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <Button onClick={handleGenerate} disabled={busy || pages.length === 0}>
        <Scissors size={16} /> Dividir
      </Button>
    </div>
  );
}
