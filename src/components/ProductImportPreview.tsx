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
    new: { label: 'Novo', color: 'bg-emerald-100 text-emerald-700', icon: PlusCircle },
    update: { label: 'Atualizar', color: 'bg-blue-100 text-blue-700', icon: RefreshCw },
    error: { label: 'Erro', color: 'bg-red-100 text-red-700', icon: XCircle },
    skip: { label: 'Ignorado', color: 'bg-zinc-100 text-zinc-600', icon: AlertTriangle },
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={16} className="text-zinc-500" />
          </div>
          <p className="text-2xl font-bold text-zinc-800">{summary.totalRows}</p>
          <p className="text-xs text-zinc-500">Total de linhas</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-700">{summary.validProducts}</p>
          <p className="text-xs text-zinc-500">Produtos válidos</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle size={16} className="text-red-500" />
          </div>
          <p className="text-2xl font-bold text-red-700">{summary.invalidProducts}</p>
          <p className="text-xs text-zinc-500">Com erro</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <PlusCircle size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-700">{summary.newProducts}</p>
          <p className="text-xs text-zinc-500">Novos produtos</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw size={16} className="text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-blue-700">{summary.updateProducts}</p>
          <p className="text-xs text-zinc-500">Atualizações</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Package size={16} className="text-zinc-500" />
          </div>
          <p className="text-2xl font-bold text-zinc-700">{summary.newProducts + summary.updateProducts}</p>
          <p className="text-xs text-zinc-500">Total a importar</p>
        </div>
      </div>

      {/* Error Alert */}
      {hasErrors && (
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold text-red-800">
                Existem {summary.invalidProducts} linhas com erros que não serão importadas
              </h4>
              <p className="text-sm text-red-600 mt-1">
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

      {/* Preview Table Header */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <div className="bg-zinc-900 p-4 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table size={20} className="text-zinc-400" />
              <h3 className="font-bold text-white">Pré-visualização dos Dados</h3>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
              {(['all', 'new', 'update', 'error'] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition ${
                    filter === f
                      ? 'bg-white text-zinc-900'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {f === 'all' ? 'Todos' : f === 'new' ? 'Novos' : f === 'update' ? 'Atualizações' : 'Erros'}
                  <span className="ml-1">
                    ({f === 'all' ? products.length : products.filter(p => p.status === f).length})
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">Nome</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">SKU</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">EAN</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">Local</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">Preço</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-700">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    Nenhum produto encontrado para o filtro selecionado
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product, idx) => {
                  const config = statusConfig[product.status];
                  const IconComponent = config.icon;
                  return (
                    <tr key={idx} className={`hover:bg-zinc-50 ${product.status === 'error' ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                          <IconComponent size={12} />
                          {config.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-zinc-800">{product.name || '-'}</td>
                      <td className="px-4 py-2 font-mono text-zinc-800">{product.sku || '-'}</td>
                      <td className="px-4 py-2 font-mono text-zinc-600">{product.ean || '-'}</td>
                      <td className="px-4 py-2 text-zinc-600">{product.location || '-'}</td>
                      <td className="px-4 py-2 text-zinc-800">{formatPrice(product.price)}</td>
                      <td className="px-4 py-2 text-red-600 text-xs">
                        {product.error || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onCancel}
          disabled={isImporting}
          className="px-6 py-3 bg-zinc-200 text-zinc-700 rounded-lg font-medium hover:bg-zinc-300 transition disabled:opacity-50"
        >
          Cancelar
        </button>

        <button
          onClick={onConfirm}
          disabled={!canImport || isImporting}
          className="flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              Importando...
            </>
          ) : (
            <>
              <FileSpreadsheet size={20} />
              Confirmar Importação ({summary.newProducts + summary.updateProducts} produtos)
            </>
          )}
        </button>
      </div>

      {!canImport && (
        <p className="text-center text-sm text-red-600">
          Nenhum produto válido encontrado. Corrija os erros e tente novamente.
        </p>
      )}
    </div>
  );
};
