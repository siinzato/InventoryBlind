// Motor de comparação — puro, sem I/O. Recebe as duas bases já carregadas
// (SpreadsheetDataRow[]) e a configuração (chave, campos, regras) e devolve os
// registros classificados + o resumo do dashboard. Processado em chunks
// assíncronos para não travar a UI em bases grandes (mesmo padrão de
// processRawProducts em productImportUtils.ts).

import {
  CellValue, SpreadsheetDataRow, KeyPartMapping, FieldMapping, ComparisonSettings,
  ComparisonRecord, ComparisonResult, ComparisonStatus, ComparisonSummary, FieldComparisonResult, FieldTotals,
} from './types';
import {
  normalizeIdentifier, buildCompositeKey, normalizeText, parseFlexibleNumber, numbersMatch,
  parseFlexibleDate, datesMatch, inferFieldDataType,
} from './normalization';

const CHUNK_SIZE = 1000;

interface KeyedRow {
  key: string;
  keyValues: Record<string, CellValue>;
  row: SpreadsheetDataRow;
}

interface InvalidRow {
  side: 'a' | 'b';
  row: SpreadsheetDataRow;
  reason: string;
  partialKeyValues: Record<string, CellValue>;
}

function computeRowKey(
  row: SpreadsheetDataRow, keyParts: KeyPartMapping[], side: 'a' | 'b'
): { key: string; keyValues: Record<string, CellValue> } | { invalidReason: string; partialKeyValues: Record<string, CellValue> } {
  const parts: string[] = [];
  const keyValues: Record<string, CellValue> = {};
  for (const part of keyParts) {
    const column = side === 'a' ? part.columnA : part.columnB;
    const raw = column ? row.data[column] : undefined;
    const { value, empty } = normalizeIdentifier(raw);
    keyValues[part.label] = raw;
    if (empty) {
      return { invalidReason: `Chave incompleta — "${part.label}" está vazio.`, partialKeyValues: keyValues };
    }
    parts.push(value);
  }
  if (parts.length === 0) {
    return { invalidReason: 'Nenhuma coluna de chave mapeada.', partialKeyValues: keyValues };
  }
  return { key: buildCompositeKey(parts), keyValues };
}

function compareField(field: FieldMapping, rawA: CellValue, rawB: CellValue, settings: ComparisonSettings): FieldComparisonResult {
  const effectiveType = field.dataType === 'auto' ? inferFieldDataType(rawA, rawB) : field.dataType;
  const toleranceAbsolute = field.toleranceAbsolute ?? settings.defaultToleranceAbsolute;
  const tolerancePercent = field.tolerancePercent ?? settings.defaultTolerancePercent;

  if (effectiveType === 'number') {
    const pa = parseFlexibleNumber(rawA);
    const pb = parseFlexibleNumber(rawB);
    if (!pa.ok || !pb.ok) {
      return {
        fieldId: field.id, label: field.label, dataType: 'number', rawA, rawB,
        normalizedA: pa.value, normalizedB: pb.value, match: false,
        difference: null, differencePercent: null, toleranceAbsolute, tolerancePercent,
        note: 'Valor numérico não interpretável.',
      };
    }
    const difference = pb.value! - pa.value!;
    const differencePercent = pa.value !== 0 ? (difference / Math.abs(pa.value!)) * 100 : (pb.value === 0 ? 0 : null);
    const match = numbersMatch(pa.value!, pb.value!, toleranceAbsolute, tolerancePercent);
    return {
      fieldId: field.id, label: field.label, dataType: 'number', rawA, rawB,
      normalizedA: pa.value, normalizedB: pb.value, match, difference, differencePercent,
      toleranceAbsolute, tolerancePercent, note: null,
    };
  }

  if (effectiveType === 'date') {
    const pa = parseFlexibleDate(rawA);
    const pb = parseFlexibleDate(rawB);
    if (!pa.ok || !pb.ok) {
      return {
        fieldId: field.id, label: field.label, dataType: 'date', rawA, rawB,
        normalizedA: pa.value?.toISOString() ?? null, normalizedB: pb.value?.toISOString() ?? null,
        match: false, difference: null, differencePercent: null, toleranceAbsolute: null, tolerancePercent: null,
        note: 'Data inválida ou não reconhecida.',
      };
    }
    return {
      fieldId: field.id, label: field.label, dataType: 'date', rawA, rawB,
      normalizedA: pa.value.toISOString(), normalizedB: pb.value.toISOString(),
      match: datesMatch(pa.value, pb.value), difference: null, differencePercent: null,
      toleranceAbsolute: null, tolerancePercent: null, note: null,
    };
  }

  // texto
  const na = normalizeText(rawA, field.caseSensitive ?? settings.defaultCaseSensitive);
  const nb = normalizeText(rawB, field.caseSensitive ?? settings.defaultCaseSensitive);
  return {
    fieldId: field.id, label: field.label, dataType: 'text', rawA, rawB,
    normalizedA: na, normalizedB: nb, match: na === nb,
    difference: null, differencePercent: null, toleranceAbsolute: null, tolerancePercent: null, note: null,
  };
}

function compareFieldSet(fields: FieldMapping[], rowA: SpreadsheetDataRow | null, rowB: SpreadsheetDataRow | null, settings: ComparisonSettings): FieldComparisonResult[] {
  return fields.map(f => {
    const rawA = rowA && f.columnA ? rowA.data[f.columnA] : undefined;
    const rawB = rowB && f.columnB ? rowB.data[f.columnB] : undefined;
    return compareField(f, rawA, rawB, settings);
  });
}

function statusFromFields(fields: FieldComparisonResult[]): 'equal' | 'divergent' | 'invalid' {
  if (fields.some(f => f.note)) return 'invalid';
  return fields.every(f => f.match) ? 'equal' : 'divergent';
}

let _recordId = 0;
const nextId = () => `cmp-${++_recordId}`;

function buildRecord(partial: Omit<ComparisonRecord, 'id'>): ComparisonRecord {
  return { id: nextId(), ...partial };
}

function sumNumericField(field: FieldMapping, rows: SpreadsheetDataRow[], column: string | null): number | null {
  if (!column) return null;
  let sum = 0;
  let anyOk = false;
  for (const r of rows) {
    const parsed = parseFlexibleNumber(r.data[column]);
    if (parsed.ok) { sum += parsed.value!; anyOk = true; }
  }
  return anyOk ? sum : null;
}

export interface RunComparisonOptions {
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export async function runComparison(
  rowsA: SpreadsheetDataRow[],
  rowsB: SpreadsheetDataRow[],
  keyParts: KeyPartMapping[],
  fields: FieldMapping[],
  settings: ComparisonSettings,
  options: RunComparisonOptions = {}
): Promise<ComparisonResult> {
  _recordId = 0;
  const keyedA: KeyedRow[] = [];
  const keyedB: KeyedRow[] = [];
  const invalidRows: InvalidRow[] = [];

  const classifyRows = (rows: SpreadsheetDataRow[], side: 'a' | 'b', out: KeyedRow[]) => {
    for (const row of rows) {
      const result = computeRowKey(row, keyParts, side);
      if ('invalidReason' in result) {
        invalidRows.push({ side, row, reason: result.invalidReason, partialKeyValues: result.partialKeyValues });
      } else {
        out.push({ key: result.key, keyValues: result.keyValues, row });
      }
    }
  };
  classifyRows(rowsA, 'a', keyedA);
  classifyRows(rowsB, 'b', keyedB);

  const groupsA = new Map<string, KeyedRow[]>();
  const groupsB = new Map<string, KeyedRow[]>();
  keyedA.forEach(kr => { const g = groupsA.get(kr.key) ?? []; g.push(kr); groupsA.set(kr.key, g); });
  keyedB.forEach(kr => { const g = groupsB.get(kr.key) ?? []; g.push(kr); groupsB.set(kr.key, g); });

  const allKeys = Array.from(new Set([...groupsA.keys(), ...groupsB.keys()]));
  const records: ComparisonRecord[] = [];

  for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
    if (options.isCancelled?.()) throw new Error('CANCELLED');
    const chunk = allKeys.slice(i, i + CHUNK_SIZE);

    for (const key of chunk) {
      const groupA = groupsA.get(key) ?? [];
      const groupB = groupsB.get(key) ?? [];
      const keyValues = (groupA[0] ?? groupB[0]).keyValues;

      if (settings.duplicateStrategy === 'aggregate') {
        records.push(buildAggregateRecord(key, keyValues, groupA, groupB, fields, settings));
      } else {
        records.push(...buildRowByRowRecords(key, keyValues, groupA, groupB, fields, settings));
      }
    }

    options.onProgress?.(Math.min(i + CHUNK_SIZE, allKeys.length), allKeys.length);
    if (i + CHUNK_SIZE < allKeys.length) await new Promise(resolve => setTimeout(resolve, 0));
  }

  invalidRows.forEach(inv => {
    records.push(buildRecord({
      keyValues: inv.partialKeyValues,
      keyDisplay: Object.values(inv.partialKeyValues).map(v => v ?? '').join(' / ') || '(vazio)',
      status: 'invalid',
      fields: [],
      sourceRowsA: inv.side === 'a' ? [inv.row.sourceRowNumber] : [],
      sourceRowsB: inv.side === 'b' ? [inv.row.sourceRowNumber] : [],
      duplicateGroupSizeA: 0,
      duplicateGroupSizeB: 0,
      invalidReason: inv.reason,
    }));
  });

  return { records, summary: summarize(records, rowsA.length, rowsB.length, fields) };
}

function buildAggregateRecord(
  key: string, keyValues: Record<string, CellValue>,
  groupA: KeyedRow[], groupB: KeyedRow[], fields: FieldMapping[], settings: ComparisonSettings
): ComparisonRecord {
  const keyDisplay = Object.values(keyValues).map(v => v ?? '').join(' / ');
  const sourceRowsA = groupA.map(g => g.row.sourceRowNumber);
  const sourceRowsB = groupB.map(g => g.row.sourceRowNumber);

  if (groupA.length === 0 || groupB.length === 0) {
    const status: ComparisonStatus = groupA.length === 0 ? 'only-b' : 'only-a';
    return buildRecord({
      keyValues, keyDisplay, status, fields: [], sourceRowsA, sourceRowsB,
      duplicateGroupSizeA: groupA.length, duplicateGroupSizeB: groupB.length, invalidReason: null,
    });
  }

  // Campos numéricos: soma do grupo. Texto/data: primeiro valor de cada grupo
  // (duplicatas não numéricas divergentes só geram nota informativa, não bloqueiam).
  const syntheticA: Record<string, CellValue> = {};
  const syntheticB: Record<string, CellValue> = {};
  fields.forEach(f => {
    const effectiveType = f.dataType === 'auto'
      ? inferFieldDataType(f.columnA ? groupA[0].row.data[f.columnA] : undefined, f.columnB ? groupB[0].row.data[f.columnB] : undefined)
      : f.dataType;
    if (effectiveType === 'number') {
      if (f.columnA) { const s = sumNumericField(f, groupA.map(g => g.row), f.columnA); if (s !== null) syntheticA[f.columnA] = s; }
      if (f.columnB) { const s = sumNumericField(f, groupB.map(g => g.row), f.columnB); if (s !== null) syntheticB[f.columnB] = s; }
    } else {
      if (f.columnA) syntheticA[f.columnA] = groupA[0].row.data[f.columnA];
      if (f.columnB) syntheticB[f.columnB] = groupB[0].row.data[f.columnB];
    }
  });

  const fieldResults = compareFieldSet(fields, { sourceRowNumber: 0, data: syntheticA }, { sourceRowNumber: 0, data: syntheticB }, settings);
  const status = statusFromFields(fieldResults) as ComparisonStatus;

  return buildRecord({
    keyValues, keyDisplay, status, fields: fieldResults, sourceRowsA, sourceRowsB,
    duplicateGroupSizeA: groupA.length, duplicateGroupSizeB: groupB.length,
    invalidReason: status === 'invalid' ? 'Um ou mais campos não puderam ser interpretados.' : null,
  });
}

function buildRowByRowRecords(
  key: string, keyValues: Record<string, CellValue>,
  groupA: KeyedRow[], groupB: KeyedRow[], fields: FieldMapping[], settings: ComparisonSettings
): ComparisonRecord[] {
  const keyDisplay = Object.values(keyValues).map(v => v ?? '').join(' / ');
  const pairs = Math.min(groupA.length, groupB.length);
  const out: ComparisonRecord[] = [];

  for (let i = 0; i < pairs; i++) {
    const fieldResults = compareFieldSet(fields, groupA[i].row, groupB[i].row, settings);
    const status = statusFromFields(fieldResults) as ComparisonStatus;
    out.push(buildRecord({
      keyValues, keyDisplay, status, fields: fieldResults,
      sourceRowsA: [groupA[i].row.sourceRowNumber], sourceRowsB: [groupB[i].row.sourceRowNumber],
      duplicateGroupSizeA: groupA.length, duplicateGroupSizeB: groupB.length,
      invalidReason: status === 'invalid' ? 'Um ou mais campos não puderam ser interpretados.' : null,
    }));
  }

  // Sobras: se o outro lado tem pelo menos 1 ocorrência da chave, a sobra é
  // "duplicado" (não pareado); se o outro lado não tem a chave, é "somente".
  for (let i = pairs; i < groupA.length; i++) {
    out.push(buildRecord({
      keyValues, keyDisplay, status: groupB.length > 0 ? 'duplicate-a' : 'only-a', fields: [],
      sourceRowsA: [groupA[i].row.sourceRowNumber], sourceRowsB: [],
      duplicateGroupSizeA: groupA.length, duplicateGroupSizeB: groupB.length, invalidReason: null,
    }));
  }
  for (let i = pairs; i < groupB.length; i++) {
    out.push(buildRecord({
      keyValues, keyDisplay, status: groupA.length > 0 ? 'duplicate-b' : 'only-b', fields: [],
      sourceRowsA: [], sourceRowsB: [groupB[i].row.sourceRowNumber],
      duplicateGroupSizeA: groupA.length, duplicateGroupSizeB: groupB.length, invalidReason: null,
    }));
  }

  return out;
}

function summarize(records: ComparisonRecord[], totalRowsA: number, totalRowsB: number, fields: FieldMapping[]): ComparisonSummary {
  const uniqueKeys = new Set(records.filter(r => r.status !== 'invalid').map(r => r.keyDisplay + '|' + JSON.stringify(r.keyValues))).size;

  const fieldTotals: FieldTotals[] = fields
    .filter(f => f.dataType === 'number' || f.dataType === 'auto')
    .map(f => {
      let net = 0, abs = 0;
      records.forEach(r => {
        const fr = r.fields.find(x => x.fieldId === f.id);
        if (fr && fr.dataType === 'number' && fr.difference !== null) {
          net += fr.difference;
          abs += Math.abs(fr.difference);
        }
      });
      return { fieldId: f.id, label: f.label, netDifference: net, absoluteDifference: abs };
    });

  return {
    totalRowsA, totalRowsB, uniqueKeys,
    equalCount: records.filter(r => r.status === 'equal').length,
    divergentCount: records.filter(r => r.status === 'divergent').length,
    onlyACount: records.filter(r => r.status === 'only-a').length,
    onlyBCount: records.filter(r => r.status === 'only-b').length,
    duplicateACount: new Set(records.filter(r => r.duplicateGroupSizeA > 1).map(r => r.keyDisplay)).size,
    duplicateBCount: new Set(records.filter(r => r.duplicateGroupSizeB > 1).map(r => r.keyDisplay)).size,
    invalidCount: records.filter(r => r.status === 'invalid').length,
    fieldTotals,
  };
}
