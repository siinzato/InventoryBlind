// Product Import Summary Component

import React from 'react';
import {
  CheckCircle2,
  Package,
  PlusCircle,
  RefreshCw,
  XCircle,
  FileSpreadsheet,
  BarChart3,
  ArrowRight,
} from 'lucide-react';
import type { ImportSummary } from '../lib/productImportTypes';
import { Panel, PanelSection, Button } from './ui';

interface ProductImportSummaryProps {
  summary: ImportSummary;
  onViewProducts: () => void;
  onNewImport: () => void;
}

export const ProductImportSummary: React.FC<ProductImportSummaryProps> = ({
  summary,
  onViewProducts,
  onNewImport,
}) => {
  return (
    <Panel>
      <PanelSection padding="lg">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="p-4 bg-emerald-500/10 rounded-full">
                <CheckCircle2 size={56} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="absolute -top-1 -right-1 p-2 bg-accent rounded-full">
                <FileSpreadsheet size={16} className="text-white" />
              </div>
            </div>
          </div>

          <h2 className="text-title mb-2">
            Importação Concluída com Sucesso!
          </h2>
          <p className="text-fg-muted">
            Todos os produtos válidos foram processados e salvos no banco de dados.
          </p>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y divide-edge md:divide-y-0 md:divide-x mb-8">
          <div className="text-center px-2 py-3 md:py-0">
            <div className="flex justify-center mb-2">
              <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-display text-emerald-600 dark:text-emerald-400">{summary.importedCount}</p>
            <p className="text-caption mt-1">Total Importados</p>
          </div>

          <div className="text-center px-2 py-3 md:py-0">
            <div className="flex justify-center mb-2">
              <PlusCircle size={20} className="text-fg-subtle" />
            </div>
            <p className="text-display">{summary.newProducts}</p>
            <p className="text-caption mt-1">Novos Produtos</p>
          </div>

          <div className="text-center px-2 py-3 md:py-0">
            <div className="flex justify-center mb-2">
              <RefreshCw size={20} className="text-fg-subtle" />
            </div>
            <p className="text-display">{summary.updateProducts}</p>
            <p className="text-caption mt-1">Atualizados</p>
          </div>

          <div className="text-center px-2 py-3 md:py-0">
            <div className="flex justify-center mb-2">
              <XCircle size={20} className={summary.invalidProducts > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'} />
            </div>
            <p className={`text-display ${summary.invalidProducts > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{summary.invalidProducts}</p>
            <p className="text-caption mt-1">Linhas Ignoradas</p>
          </div>
        </div>

        {/* Details */}
        <div className="bg-surface-3 rounded-xl p-4 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-fg-subtle" />
            <h4 className="text-section">Detalhes da Importação</h4>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-muted">Total de linhas na planilha:</span>
              <span className="font-medium text-fg">{summary.totalRows}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Produtos válidos:</span>
              <span className="font-medium text-fg">{summary.validProducts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Produtos com erro:</span>
              <span className="font-medium text-red-600 dark:text-red-400">{summary.invalidProducts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Linhas vazias ignoradas:</span>
              <span className="font-medium text-fg">{summary.skippedRows}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button variant="secondary" onClick={onViewProducts}>
            <Package size={18} />
            Ver Produtos
            <ArrowRight size={16} />
          </Button>
          <Button onClick={onNewImport}>
            <FileSpreadsheet size={18} />
            Nova Importação
          </Button>
        </div>
      </PanelSection>
    </Panel>
  );
};
