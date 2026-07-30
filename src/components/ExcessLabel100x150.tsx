/**
 * ExcessLabel100x150
 * Tamanho real: 100mm × 150mm via CSS.
 *
 * Aceita ExcessFontSettings para controle individual de cada campo.
 */

import React from 'react';
import type { LabelProduct } from './ShelfLabel100x40';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExcessFontSettings {
  nameSize: number;     // default 17
  locationSize: number; // default 14
  skuSize: number;      // default 12
  eanSize: number;      // default 18
  qtySize: number;      // default 50 (the big number)
}

export const EXCESS_FONT_DEFAULTS: ExcessFontSettings = {
  nameSize: 17,
  locationSize: 14,
  skuSize: 12,
  eanSize: 18,
  qtySize: 50,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const FONT = 'Arial, Helvetica, sans-serif';

function clamp(n: number, max: number): number { return Math.min(n, max); }

const CELL_LABEL: React.CSSProperties = {
  fontSize: 8,
  fontWeight: '700',
  color: '#666',
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  lineHeight: 1,
  marginBottom: 2,
};

// ── Component ─────────────────────────────────────────────────────────────────

interface ExcessLabelProps {
  product: LabelProduct;
  excessQty: number | string;
  fonts?: Partial<ExcessFontSettings>;
}

const ExcessLabel100x150 = React.forwardRef<HTMLDivElement, ExcessLabelProps>(
  ({ product, excessQty, fonts }, ref) => {
    const f: ExcessFontSettings = { ...EXCESS_FONT_DEFAULTS, ...fonts };

    const qty = String(excessQty ?? '0');
    const digits = qty.replace(/\D/g, '').length || 1;

    // Auto-scale qty font when many digits
    const qtyActual = (() => {
      let s = clamp(f.qtySize, 80);
      if (digits >= 6) s = Math.round(s * 0.50);
      else if (digits >= 5) s = Math.round(s * 0.62);
      else if (digits >= 4) s = Math.round(s * 0.78);
      return s;
    })();

    const nameSafe = clamp(f.nameSize, 22);
    const nameLines = f.nameSize > 19 ? 2 : 3;
    const locSafe = clamp(f.locationSize, 18);
    const skuSafe = clamp(f.skuSize, 16);
    const eanSafe = clamp(f.eanSize, 24);

    const cellStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3px 6px',
      overflow: 'hidden',
    };

    return (
      <div
        ref={ref}
        style={{
          width: '100mm',
          height: '150mm',
          border: '2px solid #111',
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
        {/* HEADER */}
        <div style={{
          flex: '0 0 13%',
          backgroundColor: '#dc2626',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          borderBottom: '2px solid #111', padding: '3px 8px',
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: '0.4px', textAlign: 'center', lineHeight: 1.15 }}>
            ⚠ EXCESSO DE ESTOQUE
          </span>
          <span style={{ fontSize: 8, color: '#fca5a5', letterSpacing: '1px', marginTop: 2, textAlign: 'center' }}>
            ESTOQUE FISICO MAIOR QUE O SISTEMA
          </span>
        </div>

        {/* NAME */}
        <div style={{
          flex: '0 0 20%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '4px 10px', borderBottom: '1.5px solid #333',
          backgroundColor: '#fafafa', overflow: 'hidden',
        }}>
          <span style={{
            fontSize: nameSafe, fontWeight: '900', textAlign: 'center',
            color: '#111', lineHeight: '1.25', wordBreak: 'break-word',
            overflow: 'hidden', display: '-webkit-box',
            WebkitBoxOrient: 'vertical', WebkitLineClamp: nameLines,
          } as React.CSSProperties}>
            {product.name || '—'}
          </span>
        </div>

        {/* LOCATION + SKU */}
        <div style={{ flex: '0 0 15%', display: 'flex', borderBottom: '1px solid #555' }}>
          <div style={{ ...cellStyle, flex: 1, borderRight: '1px solid #555' }}>
            <span style={CELL_LABEL}>Localização</span>
            <span style={{ fontSize: locSafe, fontWeight: '900', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {product.location || '—'}
            </span>
          </div>
          <div style={{ ...cellStyle, flex: 1 }}>
            <span style={CELL_LABEL}>SKU</span>
            <span style={{ fontSize: skuSafe, fontWeight: '900', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', letterSpacing: '0.3px' }}>
              {product.sku || '—'}
            </span>
          </div>
        </div>

        {/* EAN */}
        <div style={{ flex: '0 0 14%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3px 8px', borderBottom: '1.5px solid #333', overflow: 'hidden' }}>
          <span style={CELL_LABEL}>EAN / GTIN</span>
          <span style={{ fontSize: eanSafe, fontWeight: '900', letterSpacing: '1.5px', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {product.ean || '—'}
          </span>
        </div>

        {/* QTY EXCESS */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff7ed', padding: '6px 8px', overflow: 'hidden' }}>
          <span style={{ fontSize: 10, fontWeight: '700', color: '#ea580c', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
            Quantidade em Excesso
          </span>
          <span style={{ fontSize: qtyActual, fontWeight: '900', color: '#dc2626', lineHeight: 1 }}>
            {qty}
          </span>
          <span style={{ fontSize: 9, fontWeight: '600', color: '#ea580c', marginTop: 4, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
            Unidades
          </span>
        </div>
      </div>
    );
  }
);

ExcessLabel100x150.displayName = 'ExcessLabel100x150';
export default ExcessLabel100x150;
