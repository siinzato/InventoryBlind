import React from 'react';
import { PlayCircle } from 'lucide-react';
import { Button } from '../ui';
import { ComparatorBaseState, KeyPartMapping, FieldMapping, ComparisonSettings } from '../../lib/spreadsheet-comparator/types';

interface ComparisonReviewProps {
  baseA: ComparatorBaseState;
  baseB: ComparatorBaseState;
  rowsCountA: number;
  rowsCountB: number;
  keyParts: KeyPartMapping[];
  fields: FieldMapping[];
  settings: ComparisonSettings;
  onProcess: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 py-2 border-b border-edge/60 last:border-0">
    <span className="text-xs font-semibold text-fg-subtle uppercase flex-shrink-0">{label}</span>
    <span className="text-sm text-fg text-right">{value}</span>
  </div>
);

export const ComparisonReview: React.FC<ComparisonReviewProps> = ({ baseA, baseB, rowsCountA, rowsCountB, keyParts, fields, settings, onProcess }) => {
  const validKeyParts = keyParts.filter(p => p.columnA && p.columnB);
  const canProcess = validKeyParts.length > 0 && validKeyParts.length === keyParts.length;

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 rounded-xl border border-edge p-5">
        <h2 className="font-bold text-fg text-sm mb-3">Resumo da configuração</h2>
        <Row label="Planilha A" value={`${baseA.label} — ${baseA.meta?.name ?? '—'} ${baseA.activeSheet ? `(${baseA.activeSheet})` : ''}`} />
        <Row label="Planilha B" value={`${baseB.label} — ${baseB.meta?.name ?? '—'} ${baseB.activeSheet ? `(${baseB.activeSheet})` : ''}`} />
        <Row label="Linhas" value={`A: ${rowsCountA} · B: ${rowsCountB}`} />
        <Row label="Chave" value={keyParts.map(k => k.label).join(' + ') || '—'} />
        <Row label="Campos comparados" value={fields.length > 0 ? fields.map(f => f.label).join(', ') : 'Nenhum — só existência das chaves'} />
        <Row label="Duplicados" value={settings.duplicateStrategy === 'aggregate' ? 'Agrupar e somar' : 'Linha a linha'} />
        <Row label="Texto" value={settings.defaultCaseSensitive ? 'Exata' : 'Ignora maiúsculas/minúsculas'} />
        <Row label="Tolerância padrão" value={`${settings.defaultToleranceAbsolute} (absoluta) · ${settings.defaultTolerancePercent}% (percentual)`} />
        <Row label="Estimativa de registros processados" value={`até ${rowsCountA + rowsCountB} linha(s)`} />
      </div>

      {!canProcess && (
        <div className="p-3 bg-red-500/10 text-red-700 dark:text-red-400 rounded-lg text-sm">
          Mapeie todas as partes da chave (coluna A e coluna B) antes de processar.
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onProcess} disabled={!canProcess}><PlayCircle size={16} />Processar comparação</Button>
      </div>
    </div>
  );
};

export default ComparisonReview;
