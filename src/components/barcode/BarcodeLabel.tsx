import React from 'react';
import { BarcodeSymbology, BarcodeLabSettings, LabelLayoutVariant, BARCODE_SETTINGS_LIMITS } from '../../lib/barcode/barcodeTypes';
import { BarcodeRenderer } from './BarcodeRenderer';

export interface BarcodeLabelFields {
  name: string;
  sku: string;
  location: string;
  lot: string;
  expiry: string;
  quantity: string;
}

interface BarcodeLabelProps {
  widthMm: number;
  heightMm: number;
  layoutVariant: LabelLayoutVariant;
  symbology: BarcodeSymbology;
  /** Valor já validado/corrigido, pronto para gerar. */
  value: string;
  fields: BarcodeLabelFields;
  settings: BarcodeLabSettings;
}

const MM_TO_PX = 3.7795;
const FONT = 'Arial, Helvetica, sans-serif';

function clampScale(scale: number): number {
  return Math.min(BARCODE_SETTINGS_LIMITS.fontScale.max, Math.max(BARCODE_SETTINGS_LIMITS.fontScale.min, scale));
}

/**
 * Etiqueta física real (mm → px a 96dpi), um único código principal por
 * etiqueta. O layout varia por tamanho (compact/wide/tall) — mesmo componente,
 * arranjo interno diferente, igual ao padrão de ShelfLabel100x40/ExcessLabel100x150.
 */
export const BarcodeLabel = React.forwardRef<HTMLDivElement, BarcodeLabelProps>(
  ({ widthMm, heightMm, layoutVariant, symbology, value, fields, settings }, ref) => {
    const fontScale = clampScale(settings.fontScale);
    const widthPx = widthMm * MM_TO_PX;
    const heightPx = heightMm * MM_TO_PX;

    const metaLine = [
      settings.showName && fields.name,
      settings.showSku && fields.sku,
      settings.showLocation && fields.location,
    ].filter(Boolean).join(' · ');

    const humanReadable = settings.showHumanReadable ? (
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, color: '#000', letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    ) : null;

    const barcodeBlock = (
      <BarcodeRenderer
        symbology={symbology}
        value={value}
        showHumanReadable={settings.showHumanReadable}
        scale={settings.barcodeScale}
        eccLevel={settings.eccLevel}
        style={{ width: '100%', height: '100%' }}
      />
    );

    const containerStyle: React.CSSProperties = {
      width: `${widthPx}px`,
      height: `${heightPx}px`,
      border: '1.5px solid #222',
      backgroundColor: '#ffffff',
      fontFamily: FONT,
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      WebkitPrintColorAdjust: 'exact',
      printColorAdjust: 'exact',
    } as React.CSSProperties;

    // ── compact (40×25mm principal): código domina, número abaixo, meta opcional em 1 linha ──
    if (layoutVariant === 'compact') {
      return (
        <div ref={ref} style={containerStyle}>
          {metaLine && (
            <div style={{ flex: '0 0 auto', padding: '2px 4px', textAlign: 'center', fontSize: 8 * fontScale, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {metaLine}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, padding: '1px 4px' }}>{barcodeBlock}</div>
          {humanReadable && <div style={{ flex: '0 0 auto', fontSize: 10 * fontScale, padding: '0 2px 2px' }}>{humanReadable}</div>}
        </div>
      );
    }

    // ── wide (100×40mm — vão): nome, local em destaque, SKU, código, número ──
    if (layoutVariant === 'wide') {
      return (
        <div ref={ref} style={containerStyle}>
          {settings.showName && (
            <div style={{ flex: '0 0 22%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', borderBottom: '1px solid #333', overflow: 'hidden' }}>
              <span style={{ fontSize: 16 * fontScale, fontWeight: 900, textAlign: 'center', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fields.name || '—'}</span>
            </div>
          )}
          {settings.showLocation && (
            <div style={{ flex: '0 0 18%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #333' }}>
              <span style={{ fontSize: 18 * fontScale, fontWeight: 900, color: '#111', letterSpacing: 0.5 }}>{fields.location || '—'}</span>
            </div>
          )}
          {settings.showSku && (
            <div style={{ flex: '0 0 14%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #333' }}>
              <span style={{ fontSize: 12 * fontScale, fontWeight: 700, color: '#333' }}>{fields.sku || '—'}</span>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, padding: '2px 8px' }}>{barcodeBlock}</div>
          {humanReadable && <div style={{ flex: '0 0 auto', fontSize: 12 * fontScale, padding: '0 4px 3px' }}>{humanReadable}</div>}
        </div>
      );
    }

    // ── tall (100×150mm — grande): nome, sku, local, lote, validade, qtd, código em destaque, número ──
    const metaRows: Array<[string, string]> = [
      ...(settings.showName ? [['Nome', fields.name] as [string, string]] : []),
      ...(settings.showSku ? [['SKU', fields.sku] as [string, string]] : []),
      ...(settings.showLocation ? [['Local', fields.location] as [string, string]] : []),
      ...(settings.showLot ? [['Lote', fields.lot] as [string, string]] : []),
      ...(settings.showExpiry ? [['Validade', fields.expiry] as [string, string]] : []),
      ...(settings.showQuantity ? [['Qtd', fields.quantity] as [string, string]] : []),
    ];

    return (
      <div ref={ref} style={containerStyle}>
        {metaRows.length > 0 && (
          <div style={{ flex: '0 0 auto', padding: '8px 10px', borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {metaRows.map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11 * fontScale, fontWeight: 700, color: '#666', textTransform: 'uppercase' }}>{label}</span>
                <span style={{ fontSize: 13 * fontScale, fontWeight: 800, color: '#111', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val || '—'}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{barcodeBlock}</div>
        {humanReadable && <div style={{ flex: '0 0 auto', fontSize: 15 * fontScale, padding: '0 8px 10px' }}>{humanReadable}</div>}
      </div>
    );
  }
);

BarcodeLabel.displayName = 'BarcodeLabel';
export default BarcodeLabel;
