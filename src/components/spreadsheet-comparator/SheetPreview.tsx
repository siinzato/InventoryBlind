import React from 'react';
import { Table, Thead, Tr, Th, Td } from '../ui';
import { SpreadsheetDataRow } from '../../lib/spreadsheet-comparator/types';

interface SheetPreviewProps {
  headers: string[];
  rows: SpreadsheetDataRow[];
  maxRows?: number;
}

export const SheetPreview: React.FC<SheetPreviewProps> = ({ headers, rows, maxRows = 6 }) => {
  if (headers.length === 0) return null;
  const preview = rows.slice(0, maxRows);

  return (
    <div className="border border-edge rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>#</Th>
            {headers.map(h => <Th key={h}>{h}</Th>)}
          </Tr>
        </Thead>
        <tbody>
          {preview.map(r => (
            <Tr key={r.sourceRowNumber}>
              <Td className="text-fg-subtle text-xs">{r.sourceRowNumber}</Td>
              {headers.map(h => <Td key={h} className="text-xs font-mono">{r.data[h] ?? '—'}</Td>)}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

export default SheetPreview;
