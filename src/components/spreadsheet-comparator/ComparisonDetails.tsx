import React from 'react';
import { Modal, Badge } from '../ui';
import { ComparisonRecord, ComparisonStatus } from '../../lib/spreadsheet-comparator/types';

interface ComparisonDetailsProps {
  record: ComparisonRecord | null;
  labelA: string;
  labelB: string;
  onClose: () => void;
}

const STATUS_LABEL: Record<ComparisonStatus, string> = {
  equal: 'Igual', divergent: 'Divergente', 'only-a': 'Somente A', 'only-b': 'Somente B',
  'duplicate-a': 'Duplicado A', 'duplicate-b': 'Duplicado B', invalid: 'Inválido',
};
const STATUS_BADGE: Record<ComparisonStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  equal: 'success', divergent: 'warning', 'only-a': 'danger', 'only-b': 'danger',
  'duplicate-a': 'warning', 'duplicate-b': 'warning', invalid: 'danger',
};

function explainStatus(record: ComparisonRecord, labelA: string, labelB: string): string {
  switch (record.status) {
    case 'equal': return 'Todos os campos comparados coincidem entre as duas bases.';
    case 'divergent': return `Um ou mais campos têm valores diferentes entre ${labelA} e ${labelB}, fora da tolerância configurada.`;
    case 'only-a': return `Esta chave existe em ${labelA} e não foi encontrada em ${labelB}.`;
    case 'only-b': return `Esta chave existe em ${labelB} e não foi encontrada em ${labelA}.`;
    case 'duplicate-a': return `No modo linha a linha, ${labelA} tem mais ocorrências desta chave do que ${labelB} — esta linha não teve par.`;
    case 'duplicate-b': return `No modo linha a linha, ${labelB} tem mais ocorrências desta chave do que ${labelA} — esta linha não teve par.`;
    case 'invalid': return record.invalidReason ?? 'Não foi possível processar esta linha.';
    default: return '';
  }
}

export const ComparisonDetails: React.FC<ComparisonDetailsProps> = ({ record, labelA, labelB, onClose }) => {
  if (!record) return null;

  return (
    <Modal open={!!record} onClose={onClose} title="Detalhes do registro" maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={STATUS_BADGE[record.status]}>{STATUS_LABEL[record.status]}</Badge>
          {(record.duplicateGroupSizeA > 1 || record.duplicateGroupSizeB > 1) && (
            <span className="text-xs text-fg-subtle">
              {record.duplicateGroupSizeA > 1 && `${record.duplicateGroupSizeA} linha(s) em ${labelA}`}
              {record.duplicateGroupSizeA > 1 && record.duplicateGroupSizeB > 1 && ' · '}
              {record.duplicateGroupSizeB > 1 && `${record.duplicateGroupSizeB} linha(s) em ${labelB}`}
            </span>
          )}
        </div>

        <p className="text-sm text-fg-muted">{explainStatus(record, labelA, labelB)}</p>

        <div>
          <p className="text-xs font-semibold text-fg-subtle uppercase mb-1.5">Componentes da chave</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(record.keyValues).map(([label, value]) => (
              <div key={label} className="p-2 bg-surface-3 rounded-lg">
                <p className="text-xs text-fg-subtle">{label}</p>
                <p className="text-sm font-mono text-fg">{String(value ?? '—')}</p>
              </div>
            ))}
          </div>
        </div>

        {record.fields.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-fg-subtle uppercase mb-1.5">Campos comparados</p>
            <div className="border border-edge rounded-lg divide-y divide-edge">
              {record.fields.map(f => (
                <div key={f.fieldId} className={`p-3 ${!f.match ? 'bg-amber-500/5' : ''}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-fg">{f.label}</p>
                    <Badge variant={f.match ? 'success' : 'danger'}>{f.match ? 'Igual' : 'Divergente'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div><span className="text-fg-subtle">Valor original {labelA}:</span> <span className="font-mono">{String(f.rawA ?? '—')}</span></div>
                    <div><span className="text-fg-subtle">Valor original {labelB}:</span> <span className="font-mono">{String(f.rawB ?? '—')}</span></div>
                    <div><span className="text-fg-subtle">Normalizado {labelA}:</span> <span className="font-mono">{String(f.normalizedA ?? '—')}</span></div>
                    <div><span className="text-fg-subtle">Normalizado {labelB}:</span> <span className="font-mono">{String(f.normalizedB ?? '—')}</span></div>
                    {f.difference !== null && <div><span className="text-fg-subtle">Diferença:</span> <span className="font-mono">{f.difference.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span></div>}
                    {f.differencePercent !== null && <div><span className="text-fg-subtle">Diferença %:</span> <span className="font-mono">{f.differencePercent.toFixed(2)}%</span></div>}
                    {(f.toleranceAbsolute !== null || f.tolerancePercent !== null) && (
                      <div className="col-span-2"><span className="text-fg-subtle">Tolerância aplicada:</span> <span className="font-mono">{f.toleranceAbsolute ?? 0} abs. / {f.tolerancePercent ?? 0}%</span></div>
                    )}
                    {f.note && <div className="col-span-2 text-red-600 dark:text-red-400">{f.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-fg-subtle uppercase mb-1.5">Linhas de origem</p>
          <p className="text-sm text-fg">
            {labelA}: {record.sourceRowsA.length > 0 ? record.sourceRowsA.join(', ') : '—'} · {labelB}: {record.sourceRowsB.length > 0 ? record.sourceRowsB.join(', ') : '—'}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default ComparisonDetails;
