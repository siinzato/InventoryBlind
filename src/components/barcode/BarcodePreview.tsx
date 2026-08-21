import React from 'react';
import { Barcode as BarcodeIcon, AlertTriangle } from 'lucide-react';
import { BarcodeSymbology, BarcodeLabSettings, LabelLayoutVariant } from '../../lib/barcode/barcodeTypes';
import { BarcodeLabel, BarcodeLabelFields } from './BarcodeLabel';

interface BarcodePreviewProps {
  widthMm: number;
  heightMm: number;
  layoutVariant: LabelLayoutVariant;
  symbology: BarcodeSymbology;
  value: string | null;
  fields: BarcodeLabelFields;
  settings: BarcodeLabSettings;
  warning?: string | null;
  sizeLabel: string;
}

const MAX_PREVIEW_PX = 320;

/** Preview em tempo real, escalado para caber num card, fiel ao que sai na impressão/PDF. */
export const BarcodePreview: React.FC<BarcodePreviewProps> = ({
  widthMm, heightMm, layoutVariant, symbology, value, fields, settings, warning, sizeLabel,
}) => {
  const MM_TO_PX = 3.7795;
  const realWidthPx = widthMm * MM_TO_PX;
  const realHeightPx = heightMm * MM_TO_PX;
  const scale = Math.min(MAX_PREVIEW_PX / realWidthPx, MAX_PREVIEW_PX / realHeightPx, 3);

  return (
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-fg text-sm">Pré-visualização</h2>
        <span className="text-xs text-fg-subtle">{sizeLabel}</span>
      </div>

      {!value ? (
        <div className="flex flex-col items-center justify-center py-16 text-fg-subtle">
          <BarcodeIcon size={48} className="mb-3 opacity-20" />
          <p className="text-sm text-center">Informe um código para visualizar</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div style={{
            width: realWidthPx * scale, height: realHeightPx * scale,
            overflow: 'hidden', position: 'relative',
            borderRadius: 4, boxShadow: '0 4px 24px rgba(0,0,0,0.12)', flexShrink: 0,
          }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
              <BarcodeLabel
                widthMm={widthMm} heightMm={heightMm} layoutVariant={layoutVariant}
                symbology={symbology} value={value} fields={fields} settings={settings}
              />
            </div>
          </div>

          {warning && (
            <div className="flex items-start gap-2 p-2.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg text-xs max-w-xs">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          <p className="text-xs text-fg-subtle text-center">
            Visualização ampliada. Download e impressão saem no tamanho físico real ({widthMm} × {heightMm}mm).
          </p>
        </div>
      )}
    </div>
  );
};

export default BarcodePreview;
