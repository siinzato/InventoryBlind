import React from 'react';
import { ComparisonSummary, ComparisonStatus } from '../../lib/spreadsheet-comparator/types';

interface ComparisonDashboardProps {
  summary: ComparisonSummary;
  activeFilter: ComparisonStatus | 'all' | 'duplicates-a' | 'duplicates-b';
  onFilterChange: (filter: ComparisonStatus | 'all' | 'duplicates-a' | 'duplicates-b') => void;
}

interface CardDef { key: ComparisonStatus | 'all' | 'duplicates-a' | 'duplicates-b'; label: string; value: number; tone?: string }

export const ComparisonDashboard: React.FC<ComparisonDashboardProps> = ({ summary, activeFilter, onFilterChange }) => {
  const cards: CardDef[] = [
    { key: 'all', label: 'Linhas Base A', value: summary.totalRowsA },
    { key: 'all', label: 'Linhas Base B', value: summary.totalRowsB },
    { key: 'all', label: 'Chaves únicas', value: summary.uniqueKeys },
    { key: 'equal', label: 'Iguais', value: summary.equalCount, tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'divergent', label: 'Divergentes', value: summary.divergentCount, tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'only-a', label: 'Somente na A', value: summary.onlyACount, tone: 'text-red-600 dark:text-red-400' },
    { key: 'only-b', label: 'Somente na B', value: summary.onlyBCount, tone: 'text-red-600 dark:text-red-400' },
    { key: 'duplicates-a', label: 'Duplicados na A', value: summary.duplicateACount, tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'duplicates-b', label: 'Duplicados na B', value: summary.duplicateBCount, tone: 'text-amber-600 dark:text-amber-400' },
    { key: 'invalid', label: 'Inválidos', value: summary.invalidCount, tone: 'text-red-600 dark:text-red-400' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card, idx) => (
          <button
            key={`${card.key}-${idx}`}
            onClick={() => onFilterChange(card.key)}
            className={`text-left bg-surface-2 rounded-xl border p-4 transition ${activeFilter === card.key ? 'border-accent' : 'border-edge hover:border-fg-subtle'}`}
          >
            <p className="text-xs text-fg-subtle uppercase font-semibold">{card.label}</p>
            <p className={`text-2xl font-bold mt-1 ${card.tone ?? 'text-fg'}`}>{card.value.toLocaleString('pt-BR')}</p>
          </button>
        ))}
      </div>

      {summary.fieldTotals.length > 0 && (
        <div className="bg-surface-2 rounded-xl border border-edge p-5">
          <h2 className="font-bold text-fg text-sm mb-3">Diferenças por campo numérico</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.fieldTotals.map(t => (
              <div key={t.fieldId} className="p-3 bg-surface-3 rounded-lg">
                <p className="text-xs font-semibold text-fg-subtle uppercase mb-1">{t.label}</p>
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Diferença líquida (B − A)</span>
                  <span className={`font-mono font-bold ${t.netDifference === 0 ? 'text-fg' : t.netDifference > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {t.netDifference.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-fg-muted">Diferença absoluta total</span>
                  <span className="font-mono font-bold text-fg">{t.absoluteDifference.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ComparisonDashboard;
