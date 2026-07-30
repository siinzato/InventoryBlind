/**
 * ShelfLabel100x40
 * Tamanho real: 100mm × 40mm (width: 100mm; height: 40mm via CSS)
 *
 * Aceita ShelfFontSettings para controle individual de cada campo.
 * Se não receber, usa SHELF_DEFAULTS.
 * Texto é cortado com ellipsis para não estourar a área — nunca overflow.
 */

import React from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LabelProduct {
  name: string;
  sku: string;
  ean: string;
  location: string;
}

export interface ShelfFontSettings {
  nameSize: number;     // default 18
  locationSize: number; // default 18
  skuSize: number;      // default 17
  eanSize: number;      // default 30
}

export const SHELF_FONT_DEFAULTS: ShelfFontSettings = {
  nameSize: 18,
  locationSize: 18,
  skuSize: 17,
  eanSize: 30,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const FONT = 'Arial, Helvetica, sans-serif';
const BORDER = '1px solid #333';

/** Clamp a font size to a safe max given available px height */
function clampFont(size: number, maxPx: number): number {
  return Math.min(size, maxPx);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ShelfLabelProps {
  product: LabelProduct;
  fonts?: Partial<ShelfFontSettings>;
}

const ShelfLabel100x40 = React.forwardRef<HTMLDivElement, ShelfLabelProps>(
  ({ product, fonts }, ref) => {
    const f: ShelfFontSettings = { ...SHELF_FONT_DEFAULTS, ...fonts };

    // At 96dpi, 100mm = 378px, 40mm = 151px
    // Name section = ~37% = 56px max usable height
    // When font is large, allow only 1 line to prevent overflow
    const nameLines = f.nameSize > 20 ? 1 : 2;
    const nameSafe = clampFont(f.nameSize, 26);
    const locationSafe = clampFont(f.locationSize, 20);
    const skuSafe = clampFont(f.skuSize, 19);
    const eanSafe = clampFont(f.eanSize, 36);

    const rowCenter: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 5px',
      overflow: 'hidden',
    };

    return (
      <div
        ref={ref}
        style={{
          width: '100mm',
          height: '40mm',
          border: '1.5px solid #222',
          backgroundColor: '#ffffff',
          fontFamily: FONT,
          boxSizing: 'border-box',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        } as React.CSSProperties}
      >
        {/* NAME — ~37% */}
        <div style={{ ...rowCenter, flex: '0 0 37%', padding: '2px 6px', borderBottom: BORDER }}>
          <span
            style={{
              fontSize: nameSafe,
              fontWeight: '900',
              textAlign: 'center',
              lineHeight: '1.2',
              color: '#111',
              wordBreak: 'break-word',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: nameLines,
            } as React.CSSProperties}
          >
            {product.name || '—'}
          </span>
        </div>

        {/* LOCATION — ~18% */}
        <div style={{ ...rowCenter, flex: '0 0 18%', borderBottom: BORDER }}>
          <span style={{
            fontSize: locationSafe, fontWeight: '800', color: '#111',
            letterSpacing: '0.4px', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {product.location || '—'}
          </span>
        </div>

        {/* SKU — ~18% */}
        <div style={{ ...rowCenter, flex: '0 0 18%', borderBottom: BORDER }}>
          <span style={{
            fontSize: skuSafe, fontWeight: '800', color: '#111',
            letterSpacing: '0.6px', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {product.sku || '—'}
          </span>
        </div>

        {/* EAN — remaining ~27% — BIGGEST */}
        <div style={{ ...rowCenter, flex: 1 }}>
          <span style={{
            fontSize: eanSafe, fontWeight: '900', color: '#000',
            letterSpacing: '1px', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {product.ean || '—'}
          </span>
        </div>
      </div>
    );
  }
);

ShelfLabel100x40.displayName = 'ShelfLabel100x40';
export default ShelfLabel100x40;
