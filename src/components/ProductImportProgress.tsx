// Product Import Progress Component

import React from 'react';
import { Loader2, CheckCircle2, Database, Package } from 'lucide-react';
import type { ImportProgress } from '../lib/productImportTypes';
import { Panel, PanelSection } from './ui';

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
    idle: 'bg-edge',
    reading: 'bg-accent',
    validating: 'bg-accent',
    importing: 'bg-accent',
    completed: 'bg-emerald-500',
    error: 'bg-red-500',
  };

  return (
    <Panel>
      <PanelSection padding="lg">
        <div className="text-center mb-6">
          {progress.status === 'completed' ? (
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-emerald-500/10 rounded-full">
                <CheckCircle2 size={40} className="text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          ) : (
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-accent/10 rounded-full">
                <Loader2 size={40} className="text-accent animate-spin" />
              </div>
            </div>
          )}

          <h3 className="text-title mb-2">
            {statusMessages[progress.status]}
          </h3>
          <p className="text-fg-muted">{progress.message}</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-fg-muted mb-2">
            <span>Progresso</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="h-1.5 bg-edge rounded-full overflow-hidden">
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
              <Package size={18} className="text-fg-subtle" />
            </div>
            <p className="text-display">
              {progress.current} / {progress.total}
            </p>
            <p className="text-caption">Produtos processados</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Database size={18} className="text-fg-subtle" />
            </div>
            <p className="text-display text-emerald-600 dark:text-emerald-400">
              {progress.current}
            </p>
            <p className="text-caption">Salvos no banco</p>
          </div>
        </div>
      </PanelSection>
    </Panel>
  );
};
