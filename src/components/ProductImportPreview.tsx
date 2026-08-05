// Product Import Preview Component

import React, { useState } from 'react';
import {
  Table,
  CheckCircle,
  XCircle,
  RefreshCw,
  PlusCircle,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Package,
  BarChart3,
} from 'lucide-react';
import type { ProductValidated, ImportSummary } from '../lib/productImportTypes';
import { formatPrice, exportErrorsToCSV, downloadFile } from '../lib/productImportUtils';
import type { ImportError } from '../lib/productImportTypes';
import { Panel, PanelSection, Button } from './ui';

interface ProductImportPreviewProps {
  products: ProductValidated[];
  summary: ImportSummary;
  onConfirm: () => void;
  onCancel: () => void;
  isImporting: boolean;
  errors: ImportError[];
}

type FilterType = 'all' | 'new' | 'update' | 'error';

export const ProductImportPreview: React.FC<ProductImportPreviewProps> = ({
  products,
  summary,
  onConfirm,
  onCancel,
  isImporting,
  errors,
}) => {
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredProducts = products.filter(p => {
    if (filter === 'all') return true;
    return p.status === filter;
  });

  const hasErrors = summary.invalidProducts > 0;
  const canImport = summary.validProducts > 0;

  const handleDownloadErrors = () => {
    if (errors.length === 0) return;
    const csv = exportErrorsToCSV(errors);
    downloadFile(csv, `erros-importacao-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const statusConfig = {
    new: { label: 'Novo', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icon: PlusCircle },
    update: { label: 'Atualizar', color: 'bg-accent/10 text-accent', icon: RefreshCw },
    error: { label: 'Erro', color: 'bg-red-500/10 text-red-700 dark:text-red-400', icon: XCircle },
    skip: { label: 'Ignorado', color: 'bg-surface-3 text-fg-muted', icon: AlertTriangle },
  };

  return (
    <div className="space-y-6">
      {/* Summary Strip */}
      <Panel>
        <PanelSection>
          <div className="grid grid-cols-2 md:grid-cols-6 divide-y divide-edge md:divide-y-0 md:divide-x">
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><BarChart3 size={16} className="text-fg-subtle" /></div>
              <p className="text-display">{summary.totalRows}</p>
              <p className="text-caption mt-1">Total de linhas</p>
            </div>
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400" /></div>
              <p className="text-display text-emerald-600 dark:text-emerald-400">{summary.validProducts}</p>
              <p className="text-caption mt-1">Produtos válidos</p>
            </div>
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><XCircle size={16} className={summary.invalidProducts > 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'} /></div>
              <p className={`text-display ${summary.invalidProducts > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{summary.invalidProducts}</p>
              <p className="text-caption mt-1">Com erro</p>
            </div>
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><PlusCircle size={16} className="text-fg-subtle" /></div>
              <p className="text-display">{summary.newProducts}</p>
              <p className="text-caption mt-1">Novos produtos</p>
            </div>
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><RefreshCw size={16} className="text-fg-subtle" /></div>
              <p className="text-display">{summary.updateProducts}</p>
              <p className="text-caption mt-1">Atualizações</p>
            </div>
            <div className="text-center px-2 py-3 md:py-0">
              <div className="flex justify-center mb-1"><Package size={16} className="text-fg-subtle" /></div>
              <p className="text-display">{summary.newProducts + summary.updateProducts}</p>
              <p className="text-caption mt-1">Total a importar</p>
            </div>
          </div>
        </PanelSection>
      </Panel>

      {/* Error Alert */}
      {hasErrors && (
        <div className="bg-red-500/10 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-red-700 dark:text-red-400">
                Existem {summary.invalidProducts} linhas com erros que não serão importadas
              </h4>
              <p className="text-sm text-fg-muted mt-1">
                Corrija os erros na planilha e faça o upload novamente, ou prossiga apenas com os produtos válidos.
              </p>
              <button
                onClick={handleDownloadErrors}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
              >
                <Download size={16} />
                Baixar relatório de erros
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Table */}
      <Panel>
        <PanelSection padding="sm" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h3 className="text-title flex items-center gap-2">
            <Table size={16} className="text-fg-subtle" />
            Pré-visualização dos Dados
          </h3>

          {/* Filters */}
          <div className="flex gap-1.5">
            {(['all', 'new', 'update', 'error'] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition ${
                  filter === f
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
                }`}
              >
                {f === 'all' ? 'Todos' : f === 'new' ? 'Novos' : f === 'update' ? 'Atualizações' : 'Erros'}
                <span className="ml-1">
                  ({f === 'all' ? products.length : products.filter(p => p.status === f).length})
                </span>
              </button>
            ))}
          </div>
        </PanelSection>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="border-b border-edge">
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">EAN</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Local</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Preço</th>
                <th className="px-4 py-3 text-left font-medium text-fg-subtle text-xs uppercase tracking-wide">Erro</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-fg-subtle">
                    Nenhum produto encontrado para o filtro selecionado
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product, idx) => {
                  const config = statusConfig[product.status];
                  const IconComponent = config.icon;
                  return (
                    <tr key={idx} className={`border-b border-edge/60 last:border-0 hover:bg-surface-3/40 transition-colors ${product.status === 'error' ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                          <IconComponent size={12} />
                          {config.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-fg">{product.name || '-'}</td>
                      <td className="px-4 py-2.5 font-mono text-fg">{product.sku || '-'}</td>
                      <td className="px-4 py-2.5 font-mono text-fg-muted">{product.ean || '-'}</td>
                      <td className="px-4 py-2.5 text-fg-muted">{product.location || '-'}</td>
                      <td className="px-4 py-2.5 text-fg">{formatPrice(product.price)}</td>
                      <td className="px-4 py-2.5 text-red-600 dark:text-red-400 text-xs">
                        {product.error || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="secondary" onClick={onCancel} disabled={isImporting}>
          Cancelar
        </Button>

        <Button onClick={onConfirm} disabled={!canImport || isImporting}>
          {isImporting ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              Importando...
            </>
          ) : (
            <>
              <FileSpreadsheet size={18} />
              Confirmar Importação ({summary.newProducts + summary.updateProducts} produtos)
            </>
          )}
        </Button>
      </div>

      {!canImport && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          Nenhum produto válido encontrado. Corrija os erros e tente novamente.
        </p>
      )}
    </div>
  );
};
