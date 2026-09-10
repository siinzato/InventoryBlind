// Normalização de valores do Comparador de Planilhas — identificadores nunca
// viram número (preserva zero à esquerda), números aceitam formato BR/internacional
// com tolerância, datas aceitam serial do Excel e textos comuns sem adivinhar
// datas impossíveis.

import { CellValue } from './types';

// ── Identificadores (SKU, EAN, componentes de chave) ─────────────────────────

/** Sempre texto — nunca Number(). Remove só espaços nas pontas, preserva tudo mais (inclusive zeros à esquerda). */
export function normalizeIdentifier(raw: CellValue): { value: string; empty: boolean } {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  return { value, empty: value === '' };
}

const KEY_PART_SEPARATOR = '␟'; // separador de controle improvável em dado real — evita colisão "AB"+"C" vs "A"+"BC"

export function buildCompositeKey(parts: string[]): string {
  return parts.join(KEY_PART_SEPARATOR);
}

// ── Texto ─────────────────────────────────────────────────────────────────────

export function normalizeText(raw: CellValue, caseSensitive: boolean): string {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  return caseSensitive ? value : value.toLowerCase();
}

// ── Números (BR e internacional) ─────────────────────────────────────────────

export interface NumberParseResult {
  value: number | null;
  ok: boolean;
}

/**
 * Interpreta "1.234,56" (BR), "1,234.56" (internacional), "1234,56", "1234.56"
 * e números nativos. Caso ambíguo (só vírgula OU só ponto, com exatamente 3
 * dígitos depois): trata como separador de milhar (interpretação mais comum
 * em exports de sistemas), documentado aqui — o preview mostra o valor
 * interpretado para o usuário confirmar.
 */
export function parseFlexibleNumber(raw: CellValue): NumberParseResult {
  if (raw === undefined || raw === null) return { value: null, ok: false };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, ok: true } : { value: null, ok: false };

  let s = String(raw).trim().replace(/\s/g, '');
  if (s === '') return { value: null, ok: false };

  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^[-()]+|[()]+$/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.'); // BR: 1.234,56
    } else {
      s = s.replace(/,/g, ''); // internacional: 1,234.56
    }
  } else if (hasComma && !hasDot) {
    const afterComma = s.split(',').pop() ?? '';
    const isLikelyThousands = s.split(',').length === 2 && afterComma.length === 3;
    s = isLikelyThousands ? s.replace(',', '') : s.replace(',', '.');
  } else if (hasDot && !hasComma) {
    const afterDot = s.split('.').pop() ?? '';
    const dotCount = s.split('.').length - 1;
    const isLikelyThousands = dotCount === 1 && afterDot.length === 3 && s.split('.')[0].length <= 3;
    // "1.234" isolado é ambíguo; sem outro sinal, o mais comum em números
    // brutos de planilha é já ser decimal nativo (dotCount>1 => milhar BR: 1.234.567).
    if (dotCount > 1) s = s.replace(/\./g, '');
    else if (isLikelyThousands && afterDot !== '000') s = s.replace('.', '');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: negative ? -Math.abs(n) : n, ok: true };
}

export function numbersMatch(a: number, b: number, toleranceAbsolute: number, tolerancePercent: number): boolean {
  const diff = Math.abs(b - a);
  if (diff <= toleranceAbsolute) return true;
  if (tolerancePercent > 0) {
    const base = Math.abs(a);
    if (base === 0) return diff === 0;
    return (diff / base) * 100 <= tolerancePercent;
  }
  return false;
}

// ── Datas ─────────────────────────────────────────────────────────────────────

export interface DateParseResult {
  value: Date | null;
  ok: boolean;
}

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

function isRealCalendarDate(year: number, month1based: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month1based - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month1based - 1 && d.getUTCDate() === day;
}

/**
 * Aceita datas seriais do Excel, dd/mm/aaaa (padrão adotado — mesma convenção
 * pt-BR usada no resto do InventoryBlind) e aaaa-mm-dd (ISO). Rejeita datas
 * impossíveis (dia/mês fora do calendário) em vez de adivinhar.
 */
export function parseFlexibleDate(raw: CellValue): DateParseResult {
  if (raw === undefined || raw === null) return { value: null, ok: false };

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, ok: false };
    const d = new Date(EXCEL_EPOCH_UTC_MS + raw * MS_PER_DAY);
    return Number.isFinite(d.getTime()) ? { value: d, ok: true } : { value: null, ok: false };
  }

  const s = String(raw).trim();
  if (!s) return { value: null, ok: false };

  const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const day = Number(br[1]), month = Number(br[2]);
    const year = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    if (month < 1 || month > 12 || day < 1 || !isRealCalendarDate(year, month, day)) return { value: null, ok: false };
    return { value: new Date(Date.UTC(year, month - 1, day)), ok: true };
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]), month = Number(iso[2]), day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || !isRealCalendarDate(year, month, day)) return { value: null, ok: false };
    return { value: new Date(Date.UTC(year, month - 1, day)), ok: true };
  }

  return { value: null, ok: false };
}

export function datesMatch(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

// ── Auto-detecção de tipo (campo "Automático") ───────────────────────────────

export function inferFieldDataType(sampleA: CellValue, sampleB: CellValue): 'text' | 'number' | 'date' {
  if (parseFlexibleNumber(sampleA).ok && parseFlexibleNumber(sampleB).ok) return 'number';
  if (parseFlexibleDate(sampleA).ok && parseFlexibleDate(sampleB).ok) return 'date';
  return 'text';
}
