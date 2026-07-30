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
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-8">
      {/* Success Header */}
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="relative">
            <div className="p-4 bg-emerald-100 rounded-full">
              <CheckCircle2 size={64} className="text-emerald-600" />
            </div>
            <div className="absolute -top-1 -right-1 p-2 bg-blue-600 rounded-full">
              <FileSpreadsheet size={20} className="text-white" />
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-zinc-800 mb-2">
          Importação Concluída com Sucesso!
        </h2>
        <p className="text-zinc-500">
          Todos os produtos válidos foram processados e salvos no banco de dados.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 text-center">
          <div className="flex justify-center mb-2">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <p className="text-3xl font-bold text-emerald-700">{summary.importedCount}</p>
          <p className="text-sm text-emerald-700 font-medium">Total Importados</p>
        </div>

        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 text-center">
          <div className="flex justify-center mb-2">
            <PlusCircle size={28} className="text-emerald-600" />
          </div>
          <p className="text-3xl font-bold text-emerald-700">{summary.newProducts}</p>
          <p className="text-sm text-emerald-700 font-medium">Novos Produtos</p>
        </div>

        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-center">
          <div className="flex justify-center mb-2">
            <RefreshCw size={28} className="text-blue-600" />
          </div>
          <p className="text-3xl font-bold text-blue-700">{summary.updateProducts}</p>
          <p className="text-sm text-blue-700 font-medium">Atualizados</p>
        </div>

        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center">
          <div className="flex justify-center mb-2">
            <XCircle size={28} className="text-red-500" />
          </div>
          <p className="text-3xl font-bold text-red-600">{summary.invalidProducts}</p>
          <p className="text-sm text-red-600 font-medium">Linhas Ignoradas</p>
        </div>
      </div>

      {/* Details */}
      <div className="bg-zinc-50 rounded-xl p-4 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={18} className="text-zinc-500" />
          <h4 className="font-semibold text-zinc-700">Detalhes da Importação</h4>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Total de linhas na planilha:</span>
            <span className="font-medium text-zinc-800">{summary.totalRows}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Produtos válidos:</span>
            <span className="font-medium text-zinc-800">{summary.validProducts}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Produtos com erro:</span>
            <span className="font-medium text-red-600">{summary.invalidProducts}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Linhas vazias ignoradas:</span>
            <span className="font-medium text-zinc-800">{summary.skippedRows}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <button
          onClick={onViewProducts}
          className="flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition"
        >
          <Package size={20} />
          Ver Produtos
          <ArrowRight size={16} />
        </button>
        <button
          onClick={onNewImport}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition"
        >
          <FileSpreadsheet size={20} />
          Nova Importação
        </button>
      </div>
    </div>
  );
};
