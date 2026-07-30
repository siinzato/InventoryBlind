// Import History Page Component

import React, { useState, useEffect } from 'react';
import {
  History,
  ArrowLeft,
  FileSpreadsheet,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ImportHistoryRecord } from '../lib/productImportTypes';
import { formatDateTime, formatFileSize, downloadFile } from '../lib/productImportUtils';

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
    <div className="min-h-screen bg-zinc-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-zinc-600 hover:text-zinc-800 transition mb-4"
        >
          <ArrowLeft size={20} />
          Voltar
        </button>

        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-600 rounded-xl">
            <History size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-800">Historico de Importacoes</h1>
            <p className="text-zinc-500">{history.length} importacoes realizadas</p>
          </div>
        </div>
      </div>

      {/* History List */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-zinc-500 mt-4">Carregando historico...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center">
            <History size={48} className="mx-auto text-zinc-300 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-700 mb-2">Nenhuma importacao registrada</h3>
            <p className="text-zinc-500">O historico de importacoes aparecera aqui.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {history.map((record) => (
              <div
                key={record.id}
                className={`p-4 ${record.status === 'undone' ? 'bg-zinc-100' : ''}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${
                      record.status === 'undone' ? 'bg-zinc-200' : 'bg-emerald-100'
                    }`}>
                      {record.status === 'undone' ? (
                        <XCircle size={20} className="text-zinc-500" />
                      ) : (
                        <CheckCircle size={20} className="text-emerald-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet size={16} className="text-zinc-500" />
                        <h3 className="font-medium text-zinc-800">{record.fileName}</h3>
                        {record.status === 'undone' && (
                          <span className="text-xs px-2 py-0.5 bg-zinc-200 text-zinc-600 rounded-full">
                            Desfeito
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-500 mt-1">
                        {formatDateTime(record.createdAt)} por {record.importedBy}
                      </p>

                      {/* Statistics */}
                      <div className="flex flex-wrap gap-4 mt-3 text-sm">
                        <span className="text-zinc-600">
                          <Package size={14} className="inline mr-1" />
                          {record.totalProducts} produtos
                        </span>
                        <span className="text-emerald-600">
                          +{record.newProducts} novos
                        </span>
                        <span className="text-blue-600">
                          ~{record.updatedProducts} atualizados
                        </span>
                        {record.errors > 0 && (
                          <span className="text-red-600">
                            <AlertTriangle size={14} className="inline mr-1" />
                            {record.errors} erros
                          </span>
                        )}
                      </div>

                      {record.undoneAt && (
                        <p className="text-xs text-zinc-400 mt-2">
                          Desfeito em {formatDateTime(record.undoneAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {record.fileContent && (
                      <button
                        onClick={() => handleDownloadFile(record)}
                        className="px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 rounded-lg transition"
                      >
                        Baixar arquivo
                      </button>
                    )}
                    {isAdmin && record.status !== 'undone' && (
                      <button
                        onClick={() => handleUndo(record.id)}
                        disabled={undoingId === record.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                      >
                        {undoingId === record.id ? (
                          <div className="animate-spin w-3 h-3 border border-red-600 border-t-transparent rounded-full" />
                        ) : (
                          <RotateCcw size={14} />
                        )}
                        Desfazer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Import Package icon
import { Package } from 'lucide-react';
