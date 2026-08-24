import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileArchive, Printer } from 'lucide-react';
import { Badge, Button, Modal } from '../ui';
import { downloadBytes } from '../../lib/pdfCenter/downloadFile';
import { printPdfBlob } from '../../lib/pdfCenter/printPdf';
import { buildZip } from '../../lib/pdfCenter/zipExport';
import { getPdfjs } from '../../lib/pdfCenter/pdfLoader';

export interface PreviewOutput {
  name: string;
  bytes: Uint8Array;
}

interface ResultPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  outputs: PreviewOutput[];
  warnings?: string[];
  /** Ex.: "312 KB -> 198 KB (-37%)" — só quem chama sabe calcular isso (otimização). */
  sizeSummary?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResultPreviewModal({ open, onClose, title, outputs, warnings = [], sizeSummary }: ResultPreviewModalProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setThumbnail(null);
    if (!open || outputs.length === 0) return;

    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ data: outputs[0].bytes.slice() }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = 320 / Math.max(viewport.width, viewport.height);
        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(scaledViewport.width);
        canvas.height = Math.round(scaledViewport.height);
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvas, canvasContext: ctx, viewport: scaledViewport }).promise;
        if (!cancelled) setThumbnail(canvas.toDataURL('image/png'));
      } catch {
        if (!cancelled) setThumbnail(null);
      }
    })();

    return () => { cancelled = true; };
  }, [open, outputs]);

  if (!open) return null;

  const totalBytes = outputs.reduce((sum, o) => sum + o.bytes.byteLength, 0);
  const isMultiple = outputs.length > 1;

  const handleDownload = () => {
    if (isMultiple) return;
    downloadBytes(outputs[0].bytes, outputs[0].name, 'application/pdf');
  };

  const handleDownloadZip = async () => {
    const zip = await buildZip(outputs.map(o => ({ name: o.name, data: o.bytes })));
    downloadBytes(new Uint8Array(await zip.arrayBuffer()), 'central-de-pdfs.zip', 'application/zip');
  };

  const handlePrint = () => {
    if (outputs.length === 0) return;
    printPdfBlob(new Blob([outputs[0].bytes], { type: 'application/pdf' }));
  };

  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-4">
        {thumbnail ? (
          <div className="flex justify-center rounded-container border border-edge bg-surface-3 p-3">
            <img src={thumbnail} alt="Prévia da primeira página do resultado" className="max-h-72 rounded shadow-control" />
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-container border border-edge bg-surface-3 text-xs text-fg-subtle">
            {outputs.length === 0 ? 'Nada para pré-visualizar.' : 'Gerando prévia...'}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {isMultiple ? (
            <Badge variant="accent">{outputs.length} arquivos · {formatSize(totalBytes)}</Badge>
          ) : (
            <Badge variant="accent">{outputs[0] ? formatSize(outputs[0].bytes.byteLength) : ''}</Badge>
          )}
          {sizeSummary && <span>{sizeSummary}</span>}
        </div>

        {warnings.length > 0 && (
          <div className="space-y-1 rounded-container border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {isMultiple ? (
            <Button variant="primary" onClick={handleDownloadZip}>
              <FileArchive size={16} /> Baixar ZIP ({outputs.length})
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={handleDownload}>
                <Download size={16} /> Baixar PDF
              </Button>
              <Button variant="secondary" onClick={handlePrint}>
                <Printer size={16} /> Imprimir
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>

        {!isMultiple && (
          <p className="text-xs text-fg-subtle">
            Ao imprimir, use escala 100% / tamanho real e desative o ajuste automático da impressora quando o tamanho físico importar (etiquetas, folhas montadas).
          </p>
        )}
      </div>
    </Modal>
  );
}
