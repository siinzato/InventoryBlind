// Import History Page Component

import React, { useState, useEffect } from 'react';
import {
  History,
  ArrowLeft,
  FileSpreadsheet,
  RotateCcw,
  AlertTriangle,
  Package,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ImportHistoryRecord } from '../lib/productImportTypes';
import { formatDateTime, formatFileSize, downloadFile } from '../lib/productImportUtils';
import { Page, PageHeader, Panel, PanelSection, Badge, Button } from './ui';

interface ImportHistoryPageProps {
  onBack: () => void;
  isAdmin: boolean;
  onUndoImport: (importId: string) => Promise<void>;
}

export const ImportHistoryPage: React.FC<ImportHistoryPageProps> = ({
  onBack,
  isAdmin,
  onUndoImport,
}) => {
  const [history, setHistory] = useState<ImportHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  // Load import history
  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('import_history')
        .select('id, file_name, file_size, file_content, total_products, new_products, updated_products, errors, imported_by, created_at, status, undone_at, column_mapping, company_id')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (err) {
      console.error('Error loading import history:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Undo import
  const handleUndo = async (importId: string) => {
    if (!isAdmin) return;
    if (!confirm('Tem certeza que deseja desfazer esta importacao? Os produtos adicionados serao removidos e os atualizados serao restaurados.')) return;

    setUndoingId(importId);
    try {
      await onUndoImport(importId);
      await loadHistory();
    } catch (err) {
      console.error('Error undoing import:', err);
      alert('Erro ao desfazer importacao');
    }
    setUndoingId(null);
  };

  // Download original file
  const handleDownloadFile = (record: ImportHistoryRecord) => {
    if (!record.fileContent) {
      alert('Arquivo original nao disponivel');
      return;
    }
    downloadFile(record.fileContent, record.fileName);
  };

  return (
    <Page>
      <PageHeader
        title="Histórico de Importações"
        description={`${history.length} importações realizadas`}
        actions={
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={16} />
            Voltar
          </Button>
        }
      />

      {/* History List */}
      <Panel>
        {loading ? (
          <PanelSection>
            <div className="py-8 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full mx-auto" />
              <p className="text-fg-subtle mt-4">Carregando historico...</p>
            </div>
          </PanelSection>
        ) : history.length === 0 ? (
          <PanelSection>
            <div className="py-8 text-center">
              <History size={48} className="mx-auto text-fg-subtle mb-4" />
              <h3 className="text-body font-semibold mb-2">Nenhuma importacao registrada</h3>
              <p className="text-fg-muted">O historico de importacoes aparecera aqui.</p>
            </div>
          </PanelSection>
        ) : (
          history.map((record) => (
            <PanelSection
              key={record.id}
              className={record.status === 'undone' ? 'bg-surface-3/40' : ''}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet size={18} className="text-fg-subtle mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-fg">{record.fileName}</h3>
                      {record.status === 'undone' && (
                        <Badge variant="neutral">Desfeito</Badge>
                      )}
                    </div>
                    <p className="text-sm text-fg-subtle mt-1">
                      {formatDateTime(record.createdAt)} por {record.importedBy}
                    </p>

                    {/* Statistics */}
                    <div className="flex flex-wrap gap-4 mt-3 text-sm">
                      <span className="text-fg-muted">
                        <Package size={14} className="inline mr-1" />
                        {record.totalProducts} produtos
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{record.newProducts} novos
                      </span>
                      <span className="text-fg-muted">
                        ~{record.updatedProducts} atualizados
                      </span>
                      {record.errors > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          <AlertTriangle size={14} className="inline mr-1" />
                          {record.errors} erros
                        </span>
                      )}
                    </div>

                    {record.undoneAt && (
                      <p className="text-xs text-fg-subtle mt-2">
                        Desfeito em {formatDateTime(record.undoneAt)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {record.fileContent && (
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadFile(record)}>
                      Baixar arquivo
                    </Button>
                  )}
                  {isAdmin && record.status !== 'undone' && (
                    <button
                      onClick={() => handleUndo(record.id)}
                      disabled={undoingId === record.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition disabled:opacity-50"
                    >
                      {undoingId === record.id ? (
                        <div className="animate-spin w-3 h-3 border border-red-600 dark:border-red-400 border-t-transparent rounded-full" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      Desfazer
                    </button>
                  )}
                </div>
              </div>
            </PanelSection>
          ))
        )}
      </Panel>
    </Page>
  );
};
