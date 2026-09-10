import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Shuffle } from 'lucide-react';
import { Button, Input, Select } from '../../ui';
import { computeInterleaveOrder } from '../../../lib/pdfCenter/interleave';
import { buildPdfFromPageRefs, type ResolvedPageRef } from '../../../lib/pdfCenter/pdfLibOps';
import { buildOutputFilename } from '../../../lib/pdfCenter/filenames';
import type { PanelBaseProps } from '../PdfCenterEditor';
import type { PdfCenterPage, PdfCenterSource, Rotation } from '../../../lib/pdfCenter/types';

interface Props extends PanelBaseProps {
  pages: PdfCenterPage[];
  sources: PdfCenterSource[];
}

/** Intercala DOCUMENTOS inteiros (spec §5) — cada fonte carregada no editor é
 *  um "A", "B", "C"... a ordem das páginas dentro de cada fonte é a ordem
 *  atual dela no editor (já reordenada/girada ali, se o usuário quis). */
export function InterleavePanel({ pages, sources, sourceBytes, busy, setBusy, toast, onResult }: Props) {
  const [order, setOrder] = useState<string[]>(() => sources.map(s => s.id));
  const [blockSizes, setBlockSizes] = useState<Record<string, number>>({});
  const [startDoc, setStartDoc] = useState<string>(sources[0]?.id ?? '');
  const [leftover, setLeftover] = useState<'keep' | 'stopAtShortest'>('keep');
  const [fileName, setFileName] = useState('documento-intercalado');

  const nameById = new Map(sources.map(s => [s.id, s.name]));
  const pagesBySource = useMemo(() => {
    const map = new Map<string, PdfCenterPage[]>();
    for (const p of pages) map.set(p.sourceId, [...(map.get(p.sourceId) ?? []), p]);
    return map;
  }, [pages]);

  const docs = order.filter(id => sources.some(s => s.id === id)).map(id => ({ key: id, pageCount: pagesBySource.get(id)?.length ?? 0 }));
  const result = useMemo(() => computeInterleaveOrder(docs, { order, blockSizes, startDoc, leftover }), [docs, order, blockSizes, startDoc, leftover]);

  const move = (id: string, dir: -1 | 1) => {
    setOrder(prev => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const previewText = result.sequence.slice(0, 24).map(e => `${nameById.get(e.docKey)?.slice(0, 8) ?? e.docKey}${e.pageIndex + 1}`).join(', ')
    + (result.sequence.length > 24 ? '...' : '');

  const handleGenerate = async () => {
    if (result.sequence.length === 0) {
      toast(result.warnings[0] ?? 'Nada para intercalar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const refs: ResolvedPageRef[] = result.sequence.map(e => {
        const sourcePages = pagesBySource.get(e.docKey) ?? [];
        const page = sourcePages[e.pageIndex];
        return { sourceId: e.docKey, sourcePageIndex: page.sourcePageIndex, rotationCw: page.rotation as Rotation };
      });
      const bytes = await buildPdfFromPageRefs(sourceBytes, refs);
      onResult('Intercalação concluída', [{ name: buildOutputFilename(fileName, { ext: 'pdf' }), bytes }], result.warnings);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao intercalar os documentos.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (sources.length < 2) {
    return <p className="text-sm text-fg-muted">Adicione pelo menos dois documentos para intercalar.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Ordem dos documentos e páginas por ciclo</label>
        <div className="space-y-1.5">
          {order.map((id, i) => (
            <div key={id} className="flex items-center gap-2 rounded-control border border-edge bg-surface-3 px-2 py-1.5">
              <span className="flex-1 truncate text-sm text-fg">{String.fromCharCode(65 + i)}. {nameById.get(id)}</span>
              <Input type="number" min={1} value={blockSizes[id] ?? 1} onChange={e => setBlockSizes(b => ({ ...b, [id]: Math.max(1, Number(e.target.value)) }))} className="w-16" aria-label={`Páginas por ciclo de ${nameById.get(id)}`} />
              <Button size="sm" variant="ghost" onClick={() => move(id, -1)} disabled={i === 0}><ArrowUp size={14} /></Button>
              <Button size="sm" variant="ghost" onClick={() => move(id, 1)} disabled={i === order.length - 1}><ArrowDown size={14} /></Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Documento inicial</label>
          <Select value={startDoc} onChange={e => setStartDoc(e.target.value)}>
            {order.map(id => <option key={id} value={id}>{nameById.get(id)}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-fg-muted">Se as quantidades forem diferentes</label>
          <Select value={leftover} onChange={e => setLeftover(e.target.value as typeof leftover)}>
            <option value="keep">Manter o excedente no final</option>
            <option value="stopAtShortest">Parar junto ao menor documento</option>
          </Select>
        </div>
      </div>

      <div className="rounded-container border border-edge bg-surface-3 p-3 text-xs text-fg-muted">
        <span className="font-medium text-fg">Prévia da ordem final: </span>{previewText || '—'}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-fg-muted">Nome do arquivo</label>
        <Input value={fileName} onChange={e => setFileName(e.target.value)} className="max-w-xs" />
      </div>

      <Button onClick={handleGenerate} disabled={busy}>
        <Shuffle size={16} /> Intercalar
      </Button>
    </div>
  );
}
