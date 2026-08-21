// Validação e dígito verificador do Laboratório de Códigos de Barras.
// EAN-13/EAN-8/UPC-A/ITF-14 usam o mesmo algoritmo GS1 Módulo 10 (só o
// comprimento muda) — uma única função pura cobre os quatro formatos.

import { BarcodeSymbology, symbologyInfo } from './barcodeTypes';

export interface BarcodeValidationResult {
  ok: boolean;
  /** Código final (com dígito verificador correto) pronto para gerar/copiar. Só quando ok. */
  correctedValue: string | null;
  /** Dígito verificador calculado — mostrado mesmo quando o código completo informado está errado. */
  checkDigit: number | null;
  error: string | null;
}

const ok = (correctedValue: string, checkDigit: number | null = null): BarcodeValidationResult =>
  ({ ok: true, correctedValue, checkDigit, error: null });

const fail = (error: string, checkDigit: number | null = null): BarcodeValidationResult =>
  ({ ok: false, correctedValue: null, checkDigit, error });

/** GS1 Módulo 10: peso 3 no dígito mais à direita, alternando 1/3 para a esquerda. */
export function computeGs1Mod10CheckDigit(digitsWithoutCheck: string): number {
  if (!/^\d+$/.test(digitsWithoutCheck)) {
    throw new Error('computeGs1Mod10CheckDigit espera apenas dígitos.');
  }
  let sum = 0;
  let weight = 3;
  for (let i = digitsWithoutCheck.length - 1; i >= 0; i--) {
    sum += Number(digitsWithoutCheck[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function appendGs1CheckDigit(digitsWithoutCheck: string): string {
  return `${digitsWithoutCheck}${computeGs1Mod10CheckDigit(digitsWithoutCheck)}`;
}

const NUMERIC_SYMBOLOGIES: BarcodeSymbology[] = ['ean13', 'ean8', 'upca', 'itf14'];

function validateNumericWithCheckDigit(symbology: BarcodeSymbology, rawInput: string): BarcodeValidationResult {
  const info = symbologyInfo(symbology);
  const fixedLength = info.fixedLength!;
  const trimmed = rawInput.trim();

  if (!trimmed) return fail('Informe o código.');
  if (!/^\d+$/.test(trimmed)) return fail('Permitido somente números.');

  if (trimmed.length === fixedLength.withoutCheck) {
    const checkDigit = computeGs1Mod10CheckDigit(trimmed);
    return ok(`${trimmed}${checkDigit}`, checkDigit);
  }

  if (trimmed.length === fixedLength.withCheck) {
    const body = trimmed.slice(0, -1);
    const provided = Number(trimmed.slice(-1));
    const expected = computeGs1Mod10CheckDigit(body);
    if (provided !== expected) {
      return fail(`Dígito verificador inválido — esperado ${expected}, informado ${provided}.`, expected);
    }
    return ok(trimmed, expected);
  }

  return fail(
    `${info.label} deve ter ${fixedLength.withoutCheck} dígitos (sem verificador) ou ${fixedLength.withCheck} (com verificador) — você digitou ${trimmed.length}.`
  );
}

export const CODE128_MAX_LENGTH = 48;

function validateCode128(rawInput: string): BarcodeValidationResult {
  const value = rawInput.trim();
  if (!value) return fail('Informe o conteúdo do código.');
  if (value.length > CODE128_MAX_LENGTH) return fail(`Máximo de ${CODE128_MAX_LENGTH} caracteres para Code 128.`);
  if (!/^[\x20-\x7E]+$/.test(value)) return fail('Use apenas caracteres ASCII imprimíveis (letras, números e símbolos comuns).');
  return ok(value);
}

export const QRCODE_MAX_LENGTH = 2000;
export const DATAMATRIX_MAX_LENGTH = 2000;

function validateFreeText2D(rawInput: string, maxLength: number, label: string): BarcodeValidationResult {
  const value = rawInput; // 2D aceita espaços/quebras — não faz trim agressivo, só rejeita vazio.
  if (!value.trim()) return fail('Informe o conteúdo do código.');
  if (value.length > maxLength) return fail(`Conteúdo muito grande para ${label} (máximo de ${maxLength} caracteres).`);
  return ok(value);
}

/** Ponto único de validação — usado no modo unitário e em cada linha do lote. */
export function validateBarcodeValue(symbology: BarcodeSymbology, rawInput: string): BarcodeValidationResult {
  if (NUMERIC_SYMBOLOGIES.includes(symbology)) return validateNumericWithCheckDigit(symbology, rawInput);
  if (symbology === 'code128') return validateCode128(rawInput);
  if (symbology === 'qrcode') return validateFreeText2D(rawInput, QRCODE_MAX_LENGTH, 'QR Code');
  if (symbology === 'datamatrix') return validateFreeText2D(rawInput, DATAMATRIX_MAX_LENGTH, 'Data Matrix');
  return fail('Tipo de código desconhecido.');
}

/**
 * Aviso não-bloqueante de legibilidade: conteúdo grande demais para a área física
 * disponível na etiqueta escolhida. Heurística simples (não substitui o próprio
 * bwip-js recusar o símbolo quando realmente não cabe).
 */
export function estimateReadabilityWarning(
  symbology: BarcodeSymbology,
  value: string,
  widthMm: number,
  heightMm: number,
  barcodeScale: number
): string | null {
  const info = symbologyInfo(symbology);
  const usableWidthMm = widthMm * 0.9 * barcodeScale;
  const usableHeightMm = heightMm * (info.kind === '2d' ? 0.7 : 0.5) * barcodeScale;

  // EAN-13/EAN-8/UPC-A/ITF-14 têm comprimento fixo e já validado — a largura do
  // símbolo não varia com o conteúdo, então não há "conteúdo grande demais" para
  // esses quatro. Só Code128 (comprimento variável, ~11 módulos/caractere) entra
  // nesta heurística do lado 1D.
  if (symbology === 'code128') {
    const estimatedModules = value.length * 11 + 35; // dados + start/stop/checksum/quiet zone
    const minModuleWidthMm = usableWidthMm / estimatedModules;
    if (minModuleWidthMm < 0.19) {
      return 'O conteúdo pode ficar difícil de escanear neste tamanho — considere um tamanho maior ou reduzir o conteúdo.';
    }
  } else if (info.kind === '2d') {
    // 2D: comprimento de texto vs. área quadrada disponível.
    const sideMm = Math.min(usableWidthMm, usableHeightMm);
    const estimatedModulesPerSide = Math.sqrt(value.length) * 4 + 21;
    const minModuleMm = sideMm / estimatedModulesPerSide;
    if (minModuleMm < 0.25) {
      return 'O conteúdo pode ficar difícil de escanear neste tamanho — considere um tamanho maior, reduzir o conteúdo ou diminuir o nível de correção de erro.';
    }
  }
  return null;
}
