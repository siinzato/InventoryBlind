// Product Import Progress Component

import React from 'react';
import { Loader2, CheckCircle2, Database, Package } from 'lucide-react';
import type { ImportProgress } from '../lib/productImportTypes';

interface ProductImportProgressProps {
  progress: ImportProgress;
}

export const ProductImportProgress: React.FC<ProductImportProgressProps> = ({ progress }) => {
  const statusMessages = {
    idle: 'Aguardando início...',
    reading: 'Lendo planilha...',
    validating: 'Validando dados...',
    importing: 'Importando produtos...',
    completed: 'Importação concluída!',
    error: 'Erro na importação',
  };

  const statusColors = {
    idle: 'bg-zinc-200',
    reading: 'bg-blue-500',
    validating: 'bg-amber-500',
    importing: 'bg-emerald-500',
    completed: 'bg-emerald-600',
    error: 'bg-red-500',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-8">
      <div className="text-center mb-6">
        {progress.status === 'completed' ? (
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-emerald-100 rounded-full">
              <CheckCircle2 size={48} className="text-emerald-600" />
            </div>
          </div>
        ) : (
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-blue-100 rounded-full">
              <Loader2 size={48} className="text-blue-600 animate-spin" />
            </div>
          </div>
        )}

        <h3 className="text-xl font-bold text-zinc-800 mb-2">
          {statusMessages[progress.status]}
        </h3>
        <p className="text-zinc-500">{progress.message}</p>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-zinc-500 mb-2">
          <span>Progresso</span>
          <span>{progress.percentage}%</span>
        </div>
        <div className="h-4 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${statusColors[progress.status]}`}
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex justify-center gap-8 mt-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Package size={20} className="text-zinc-500" />
          </div>
          <p className="text-2xl font-bold text-zinc-800">
            {progress.current} / {progress.total}
          </p>
          <p className="text-xs text-zinc-500">Produtos processados</p>
        </div>

        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Database size={20} className="text-zinc-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600">
            {progress.current}
          </p>
          <p className="text-xs text-zinc-500">Salvos no banco</p>
        </div>
      </div>
    </div>
  );
};
