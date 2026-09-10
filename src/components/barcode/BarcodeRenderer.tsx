import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BarcodeSymbology } from '../../lib/barcode/barcodeTypes';
import { renderBarcodeSVG } from '../../lib/barcode/barcodeExport';

interface BarcodeRendererProps {
  symbology: BarcodeSymbology;
  /** Valor JÁ validado/corrigido — este componente não valida, só renderiza. */
  value: string;
  showHumanReadable: boolean;
  scale: number;
  eccLevel?: 'L' | 'M' | 'Q' | 'H';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renderiza o símbolo via bwip-js (SVG vetorial) dentro de uma div.
 * A própria div é o alvo de html2canvas (PNG/PDF/impressão) e de exportação
 * SVG (basta ler o innerHTML do nó de código, sem os campos de texto ao redor).
 */
export const BarcodeRenderer = React.forwardRef<HTMLDivElement, BarcodeRendererProps>(
  ({ symbology, value, showHumanReadable, scale, eccLevel, className, style }, ref) => {
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      setSvg(null);
      setError(null);
      renderBarcodeSVG(symbology, value, { showHumanReadable, scale, eccLevel })
        .then(markup => { if (!cancelled) setSvg(markup); })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Não foi possível gerar o código: ${msg}`);
        });
      return () => { cancelled = true; };
    }, [symbology, value, showHumanReadable, scale, eccLevel]);

    if (error) {
      return (
        <div className={className} style={style}>
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs p-2">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={className}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}
        data-barcode-symbology={symbology}
        // bwip-js devolve markup SVG confiável (não é HTML de terceiros/usuário) —
        // é o mesmo mecanismo que a própria lib recomenda para uso em browser.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    );
  }
);

BarcodeRenderer.displayName = 'BarcodeRenderer';
export default BarcodeRenderer;
