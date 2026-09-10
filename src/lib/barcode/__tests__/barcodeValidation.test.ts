import { describe, expect, it } from 'vitest';
import {
  computeGs1Mod10CheckDigit, appendGs1CheckDigit, validateBarcodeValue, estimateReadabilityWarning,
  CODE128_MAX_LENGTH, QRCODE_MAX_LENGTH,
} from '../barcodeValidation';

describe('computeGs1Mod10CheckDigit / appendGs1CheckDigit — vetores do enunciado', () => {
  it('EAN-13: 400638133393 -> 4006381333931', () => {
    expect(computeGs1Mod10CheckDigit('400638133393')).toBe(1);
    expect(appendGs1CheckDigit('400638133393')).toBe('4006381333931');
  });

  it('EAN-8: 9638507 -> 96385074', () => {
    expect(computeGs1Mod10CheckDigit('9638507')).toBe(4);
    expect(appendGs1CheckDigit('9638507')).toBe('96385074');
  });

  it('UPC-A: 03600029145 -> 036000291452', () => {
    expect(computeGs1Mod10CheckDigit('03600029145')).toBe(2);
    expect(appendGs1CheckDigit('03600029145')).toBe('036000291452');
  });

  it('ITF-14: 1001234500001 -> 10012345000017', () => {
    expect(computeGs1Mod10CheckDigit('1001234500001')).toBe(7);
    expect(appendGs1CheckDigit('1001234500001')).toBe('10012345000017');
  });

  it('rejeita entrada não-numérica', () => {
    expect(() => computeGs1Mod10CheckDigit('12a4')).toThrow();
  });
});

describe('validateBarcodeValue — EAN-13/EAN-8/UPC-A/ITF-14', () => {
  it('aceita 12 dígitos e calcula o 13º automaticamente (EAN-13)', () => {
    const result = validateBarcodeValue('ean13', '400638133393');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('4006381333931');
    expect(result.checkDigit).toBe(1);
  });

  it('aceita código completo válido (EAN-13)', () => {
    const result = validateBarcodeValue('ean13', '4006381333931');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('4006381333931');
  });

  it('rejeita código completo com dígito verificador incorreto (EAN-13)', () => {
    const result = validateBarcodeValue('ean13', '4006381333939');
    expect(result.ok).toBe(false);
    expect(result.correctedValue).toBeNull();
    expect(result.checkDigit).toBe(1); // mostra o dígito correto calculado
    expect(result.error).toMatch(/dígito verificador inválido/i);
  });

  it('rejeita letras em formato exclusivamente numérico', () => {
    const result = validateBarcodeValue('ean13', '40063813339A');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/somente números/i);
  });

  it('informa comprimento incorreto claramente', () => {
    const result = validateBarcodeValue('ean13', '123');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/12 dígitos.*13/);
  });

  it('EAN-8: aceita 7 dígitos e calcula o 8º', () => {
    const result = validateBarcodeValue('ean8', '9638507');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('96385074');
  });

  it('EAN-8: código completo com dígito errado é rejeitado', () => {
    const result = validateBarcodeValue('ean8', '96385070');
    expect(result.ok).toBe(false);
  });

  it('UPC-A: aceita 11 dígitos e calcula o 12º', () => {
    const result = validateBarcodeValue('upca', '03600029145');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('036000291452');
  });

  it('ITF-14: aceita 13 dígitos e calcula o 14º', () => {
    const result = validateBarcodeValue('itf14', '1001234500001');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('10012345000017');
  });

  it('ITF-14: código completo com dígito errado é rejeitado', () => {
    const result = validateBarcodeValue('itf14', '10012345000010');
    expect(result.ok).toBe(false);
    expect(result.checkDigit).toBe(7);
  });
});

describe('validateBarcodeValue — Code 128', () => {
  it('aceita conteúdo alfanumérico', () => {
    const result = validateBarcodeValue('code128', 'ABC-123-xyz');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('ABC-123-xyz');
  });

  it('rejeita conteúdo vazio', () => {
    expect(validateBarcodeValue('code128', '').ok).toBe(false);
    expect(validateBarcodeValue('code128', '   ').ok).toBe(false);
  });

  it('rejeita conteúdo acima do limite seguro', () => {
    const result = validateBarcodeValue('code128', 'A'.repeat(CODE128_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/máximo/i);
  });
});

describe('validateBarcodeValue — QR Code e Data Matrix', () => {
  it('QR Code aceita texto livre', () => {
    expect(validateBarcodeValue('qrcode', 'Olá, InventoryBlind!').ok).toBe(true);
  });

  it('QR Code aceita URL', () => {
    const result = validateBarcodeValue('qrcode', 'https://inventoryblind.example.com/produto/123');
    expect(result.ok).toBe(true);
    expect(result.correctedValue).toBe('https://inventoryblind.example.com/produto/123');
  });

  it('QR Code rejeita conteúdo vazio', () => {
    expect(validateBarcodeValue('qrcode', '').ok).toBe(false);
  });

  it('QR Code rejeita conteúdo acima do limite', () => {
    expect(validateBarcodeValue('qrcode', 'x'.repeat(QRCODE_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('Data Matrix aceita conteúdo UTF-8 (acentos, emoji)', () => {
    const result = validateBarcodeValue('datamatrix', 'Lote nº 42 — validade 31/12/2026 ✅');
    expect(result.ok).toBe(true);
  });

  it('Data Matrix rejeita conteúdo vazio', () => {
    expect(validateBarcodeValue('datamatrix', '').ok).toBe(false);
  });
});

describe('estimateReadabilityWarning', () => {
  it('não alerta para um EAN-13 numa etiqueta grande (100x150)', () => {
    expect(estimateReadabilityWarning('ean13', '4006381333931', 100, 150, 1)).toBeNull();
  });

  it('alerta para Code128 muito longo numa etiqueta pequena (40x25)', () => {
    const longValue = 'X'.repeat(45);
    expect(estimateReadabilityWarning('code128', longValue, 40, 25, 1)).not.toBeNull();
  });

  it('alerta para Data Matrix com muito conteúdo numa etiqueta pequena', () => {
    const longValue = 'y'.repeat(500);
    expect(estimateReadabilityWarning('datamatrix', longValue, 40, 25, 1)).not.toBeNull();
  });
});
