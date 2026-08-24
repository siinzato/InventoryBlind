import React, { useMemo, useState } from 'react';
import { Search, Eye, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { Table, Thead, Tr, Th, Td, Badge, Select, Input } from '../ui';
import { ComparisonRecord, ComparisonStatus, FieldMapping } from '../../lib/spreadsheet-comparator/types';

type TableFilter = ComparisonStatus | 'all' | 'duplicates-a' | 'duplicates-b';

interface ComparisonTableProps {
  records: ComparisonRecord[];
  fields: FieldMapping[];
  filter: TableFilter;
  onFilterChange: (filter: TableFilter) => void;
  onOpenDetails: (record: ComparisonRecord) => void;
}

interface FlatRow {
  record: ComparisonRecord;
  fieldId: string | null;
  fieldLabel: string;
  valueA: string;
  valueB: string;
  difference: number | null;
  differencePercent: number | null;
  isFieldDivergent: boolean;
}

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  equal: 'Igual', divergent: 'Divergente', 'only-a': 'Somente A', 'only-b': 'Somente B',
  'duplicate-a': 'Duplicado A', 'duplicate-b': 'Duplicado B', invalid: 'Inválido',
};
const STATUS_BADGE: Record<ComparisonStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  equal: 'success', divergent: 'warning', 'only-a': 'danger', 'only-b': 'danger',
  'duplicate-a': 'warning', 'duplicate-b': 'warning', invalid: 'danger',
};

const PAGE_SIZE = 25;
const ALL_COLUMNS = ['status', 'key', 'field', 'valueA', 'valueB', 'diff', 'diffPercent', 'sourceRows'] as const;
type ColumnKey = typeof ALL_COLUMNS[number];
const COLUMN_LABEL: Record<ColumnKey, string> = {
  status: 'Status', key: 'Chave', field: 'Campo', valueA: 'Valor A', valueB: 'Valor B',
  diff: 'Diferença', diffPercent: 'Diferença %', sourceRows: 'Linhas de origem',
};

function flattenRecord(record: ComparisonRecord): FlatRow[] {
  if (record.fields.length === 0) {
    return [{ record, fieldId: null, fieldLabel: '—', valueA: '', valueB: '', difference: null, differencePercent: null, isFieldDivergent: false }];
  }
  return record.fields.map(f => ({
    record, fieldId: f.fieldId, fieldLabel: f.label,
    valueA: f.rawA === undefined ? '—' : String(f.rawA),
    valueB: f.rawB === undefined ? '—' : String(f.rawB),
    difference: f.difference, differencePercent: f.differencePercent, isFieldDivergent: !f.match,
  }));
}

export const ComparisonTable: React.FC<ComparisonTableProps> = ({ records, fields, filter, onFilterChange, onOpenDetails }) => {
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'key' | 'diff'>('key');
  const [page, setPage] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(new Set(ALL_COLUMNS));
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filter === 'all') return true;
      if (filter === 'duplicates-a') return r.duplicateGroupSizeA > 1;
      if (filter === 'duplicates-b') return r.duplicateGroupSizeB > 1;
      return r.status === filter;
    });
  }, [records, filter]);

  const flatRows = useMemo(() => {
    let rows = filteredRecords.flatMap(flattenRecord);
    if (fieldFilter !== 'all') rows = rows.filter(r => r.fieldId === fieldFilter && r.isFieldDivergent);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        r.record.keyDisplay.toLowerCase().includes(q) ||
        r.valueA.toLowerCase().includes(q) ||
        r.valueB.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'diff') {
        const da = a.difference !== null ? Math.abs(a.difference) : -1;
        const db = b.difference !== null ? Math.abs(b.difference) : -1;
        return db - da;
      }
      return a.record.keyDisplay.localeCompare(b.record.keyDisplay);
    });
    return rows;
  }, [filteredRecords, fieldFilter, search, sortBy]);

  const totalPages = Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = flatRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const toggleColumn = (col: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const col = (key: ColumnKey) => visibleColumns.has(key);

  return (
    <div className="bg-surface-2 rounded-xl border border-edge overflow-hidden">
      <div className="p-4 border-b border-edge flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Buscar</label>
          <Input icon={<Search size={16} />} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Chave ou valor..." />
        </div>
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Status</label>
          <Select value={filter} onChange={e => { onFilterChange(e.target.value as TableFilter); setPage(0); }}>
            <option value="all">Todos</option>
            {(Object.keys(STATUS_LABEL) as ComparisonStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="duplicates-a">Duplicados na A</option>
            <option value="duplicates-b">Duplicados na B</option>
          </Select>
        </div>
        {fields.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Campo divergente</label>
            <Select value={fieldFilter} onChange={e => { setFieldFilter(e.target.value); setPage(0); }}>
              <option value="all">Todos os campos</option>
              {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1">Ordenar por</label>
          <Select value={sortBy} onChange={e => setSortBy(e.target.value as 'key' | 'diff')}>
            <option value="key">Chave</option>
            <option value="diff">Maior diferença</option>
          </Select>
        </div>
        <div className="relative">
          <button onClick={() => setShowColumnMenu(v => !v)} className="p-2.5 border border-edge rounded-lg text-fg-muted hover:bg-surface-3" title="Mostrar/ocultar colunas">
            <SlidersHorizontal size={16} />
          </button>
          {showColumnMenu && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-surface border border-edge rounded-lg shadow-panel p-2 w-48">
              {ALL_COLUMNS.map(c => (
                <label key={c} className="flex items-center gap-2 py-1 text-xs text-fg-muted cursor-pointer">
                  <input type="checkbox" checked={col(c)} onChange={() => toggleColumn(c)} className="accent-accent" />
                  {COLUMN_LABEL[c]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              {col('status') && <Th>Status</Th>}
              {col('key') && <Th>Chave</Th>}
              {col('field') && <Th>Campo</Th>}
              {col('valueA') && <Th>Valor A</Th>}
              {col('valueB') && <Th>Valor B</Th>}
              {col('diff') && <Th>Diferença</Th>}
              {col('diffPercent') && <Th>Diferença %</Th>}
              {col('sourceRows') && <Th>Linhas</Th>}
              <Th></Th>
            </Tr>
          </Thead>
          <tbody>
            {pageRows.length === 0 ? (
              <Tr><Td colSpan={9} className="text-center py-8 text-fg-subtle text-sm">Nenhum resultado para os filtros aplicados.</Td></Tr>
            ) : pageRows.map((row, idx) => (
              <Tr key={`${row.record.id}-${row.fieldId ?? 'none'}-${idx}`} className={row.isFieldDivergent ? 'bg-amber-500/5' : ''}>
                {col('status') && <Td><Badge variant={STATUS_BADGE[row.record.status]}>{STATUS_LABEL[row.record.status]}</Badge></Td>}
                {col('key') && <Td className="font-mono text-xs max-w-[220px] truncate">{row.record.keyDisplay}</Td>}
                {col('field') && <Td className="text-xs text-fg-muted">{row.fieldLabel}</Td>}
                {col('valueA') && <Td className="text-xs font-mono">{row.valueA}</Td>}
                {col('valueB') && <Td className="text-xs font-mono">{row.valueB}</Td>}
                {col('diff') && <Td className="text-xs font-mono">{row.difference !== null ? row.difference.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</Td>}
                {col('diffPercent') && <Td className="text-xs font-mono">{row.differencePercent !== null ? `${row.differencePercent.toFixed(1)}%` : '—'}</Td>}
                {col('sourceRows') && <Td className="text-xs text-fg-subtle">A: {row.record.sourceRowsA.join(', ') || '—'} · B: {row.record.sourceRowsB.join(', ') || '—'}</Td>}
                <Td>
                  <button onClick={() => onOpenDetails(row.record)} className="p-1.5 text-fg-subtle hover:text-accent" title="Ver detalhes">
                    <Eye size={14} />
                  </button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="p-3 border-t border-edge flex items-center justify-between text-xs text-fg-subtle">
        <span>{flatRows.length} linha(s) · página {currentPage + 1} de {totalPages}</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0} className="p-1.5 border border-edge rounded disabled:opacity-40">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1} className="p-1.5 border border-edge rounded disabled:opacity-40">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComparisonTable;
