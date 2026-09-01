// Warehouse Digital Twin — importação CSV de vínculo de endereço (Etapa "Endereços").
// Não existe uma tabela de "endereços" separada no InventoryBlind: um endereço é o campo
// texto products.location, e warehouse_cells.location_code é só a cópia usada para colocar
// esse texto num ponto (x,y) da grade. Por isso "vincular endereço existente" nunca cria um
// endereço novo — só aponta um código já em uso (por um produto ou por outra célula) para
// uma posição da planta. Decisão pura: classifica cada linha do CSV, nada é gravado aqui.

import type { FieldDef } from './abcCurve/abcCurveParsing';
import { detectColumns, suggestMapping, applyMapping, type RawRow } from './abcCurve/abcCurveParsing';
import { parseCSV } from './productImportUtils';

export const ADDRESS_CSV_FIELDS: FieldDef[] = [
  { key: 'addressCode', label: 'Código do endereço', required: true, aliases: ['addresscode', 'codigo', 'code'] },
  { key: 'zone', label: 'Zona', required: false, aliases: ['zone', 'zona'] },
  { key: 'aisle', label: 'Corredor', required: false, aliases: ['aisle', 'corredor', 'rua'] },
  { key: 'rack', label: 'Rack', required: false, aliases: ['rack', 'modulo'] },
  { key: 'level', label: 'Nível', required: false, aliases: ['level', 'nivel'] },
  { key: 'bin', label: 'Posição', required: false, aliases: ['bin', 'posicao'] },
  { key: 'spatialEntityCode', label: 'Código da estrutura', required: false, aliases: ['spatialentitycode', 'estrutura'] },
  { key: 'x', label: 'X', required: true, aliases: ['x'] },
  { key: 'y', label: 'Y', required: true, aliases: ['y'] },
  { key: 'capacity', label: 'Capacidade', required: false, aliases: ['capacity', 'capacidade'] },
];

export const ADDRESS_CSV_TEMPLATE_HEADER =
  'address_code,zone,aisle,rack,level,bin,spatial_entity_code,x,y,capacity';

export interface AddressCsvRow {
  addressCode: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  level: string | null;
  bin: string | null;
  spatialEntityCode: string | null;
  x: number | null;
  y: number | null;
  capacity: number | null;
}

export type AddressRowStatus = 'linked' | 'unmatched' | 'duplicate' | 'out_of_bounds';

export interface ClassifiedAddressRow extends AddressCsvRow {
  status: AddressRowStatus;
  reason: string;
}

export interface ClassifyAddressRowsInput {
  rows: AddressCsvRow[];
  gridWidth: number;
  gridHeight: number;
  /** Endereços já reais no InventoryBlind (products.location + location_code já usados em
   *  outras células) — só esses podem ser vinculados; um código desconhecido nunca é
   *  criado, só reportado como "sem correspondência". */
  knownAddressCodes: Set<string>;
  /** location_code → (x,y) já vinculado em OUTRA célula do próprio rascunho — usado para
   *  detectar duplicidade de vínculo (o mesmo endereço apontando para dois lugares). */
  existingBindings: Map<string, { x: number; y: number }>;
}

export interface ClassifyAddressRowsResult {
  rows: ClassifiedAddressRow[];
  totals: { total: number; linked: number; unmatched: number; duplicate: number; outOfBounds: number };
}

/** Classifica cada linha do CSV — nunca grava, nunca inventa um endereço novo. */
export function classifyAddressRows(input: ClassifyAddressRowsInput): ClassifyAddressRowsResult {
  const { rows, gridWidth, gridHeight, knownAddressCodes, existingBindings } = input;
  const seenInFile = new Set<string>();
  const classified: ClassifiedAddressRow[] = [];

  for (const row of rows) {
    const outOfBounds =
      row.x == null || row.y == null || row.x < 0 || row.y < 0 || row.x >= gridWidth || row.y >= gridHeight;
    if (outOfBounds) {
      classified.push({ ...row, status: 'out_of_bounds', reason: 'Posição X/Y fora dos limites da planta.' });
      continue;
    }

    const duplicateInFile = seenInFile.has(row.addressCode);
    seenInFile.add(row.addressCode);

    const existing = existingBindings.get(row.addressCode);
    const conflictsWithExisting = !!existing && (existing.x !== row.x || existing.y !== row.y);

    if (duplicateInFile || conflictsWithExisting) {
      classified.push({
        ...row,
        status: 'duplicate',
        reason: duplicateInFile
          ? 'Código de endereço repetido dentro do próprio arquivo.'
          : `Já vinculado a outra posição (${existing!.x},${existing!.y}).`,
      });
      continue;
    }

    if (!knownAddressCodes.has(row.addressCode)) {
      classified.push({ ...row, status: 'unmatched', reason: 'Endereço não encontrado no InventoryBlind — nada foi criado.' });
      continue;
    }

    classified.push({ ...row, status: 'linked', reason: '' });
  }

  const totals = {
    total: classified.length,
    linked: classified.filter(r => r.status === 'linked').length,
    unmatched: classified.filter(r => r.status === 'unmatched').length,
    duplicate: classified.filter(r => r.status === 'duplicate').length,
    outOfBounds: classified.filter(r => r.status === 'out_of_bounds').length,
  };

  return { rows: classified, totals };
}

function toNullableNumber(value: string | number | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toNullableString(value: string | number | undefined): string | null {
  const trimmed = value != null ? String(value).trim() : '';
  return trimmed ? trimmed : null;
}

/** Lê o CSV bruto e mapeia colunas por alias/aproximação — mesmo pipeline já usado pela
 *  Curva ABC (`parseCSV` + `detectColumns`/`suggestMapping`/`applyMapping`), não um parser
 *  novo. A classificação em si (vinculado/sem correspondência/duplicado/fora da planta)
 *  fica em `classifyAddressRows`. */
export function parseAddressCsv(fileContent: string): AddressCsvRow[] {
  const { headers, rows: rawRows } = parseCSV(fileContent);
  const mapping = suggestMapping(detectColumns(headers, ADDRESS_CSV_FIELDS), ADDRESS_CSV_FIELDS);
  const mapped: RawRow[] = applyMapping(rawRows as unknown as RawRow[], mapping);

  return mapped.map(r => ({
    addressCode: toNullableString(r.addressCode) ?? '',
    zone: toNullableString(r.zone),
    aisle: toNullableString(r.aisle),
    rack: toNullableString(r.rack),
    level: toNullableString(r.level),
    bin: toNullableString(r.bin),
    spatialEntityCode: toNullableString(r.spatialEntityCode),
    x: toNullableNumber(r.x),
    y: toNullableNumber(r.y),
    capacity: toNullableNumber(r.capacity),
  }));
}
