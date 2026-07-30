// Product Upload Area Component

import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, File, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ProductUploadAreaProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
}

export const ProductUploadArea: React.FC<ProductUploadAreaProps> = ({
  onFileSelect,
  isLoading,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv',
    '.csv',
  ];

  const acceptedExtensions = ['.xlsx', '.xls', '.csv'];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateFile = (file: File): boolean => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    return acceptedExtensions.includes(extension);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        onFileSelect(file);
      } else {
        alert('Formato de arquivo não suportado. Use .xlsx, .xls ou .csv');
      }
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        onFileSelect(file);
      } else {
        alert('Formato de arquivo não suportado. Use .xlsx, .xls ou .csv');
      }
    }
  }, [onFileSelect]);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileSpreadsheet size={20} className="text-zinc-500" />
        <h3 className="font-semibold text-zinc-800">Selecione a Planilha</h3>
      </div>

      {/* Accepted formats info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <p className="text-sm text-blue-800">
          <strong>Formatos aceitos:</strong> Excel (.xlsx, .xls) ou CSV (.csv)
        </p>
        <p className="text-xs text-blue-600 mt-1">
          Colunas esperadas: Nome, SKU, EAN, Local, Preço
        </p>
      </div>

      {/* Drop zone */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : selectedFile
              ? 'border-emerald-500 bg-emerald-50'
              : 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50'
          }
          ${isLoading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedExtensions.join(',')}
          onChange={handleFileChange}
          className="hidden"
        />

        {isLoading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full" />
            <p className="text-zinc-600 font-medium">Processando planilha...</p>
          </div>
        ) : selectedFile ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle2 size={48} className="text-emerald-500" />
            <p className="font-medium text-zinc-800">{selectedFile.name}</p>
            <p className="text-sm text-zinc-500">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
            <p className="text-xs text-blue-600 mt-2">
              Clique para selecionar outro arquivo
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={48} className={`${isDragging ? 'text-blue-500' : 'text-zinc-400'}`} />
            <p className="font-medium text-zinc-800">
              {isDragging ? 'Solte o arquivo aqui' : 'Arraste e solte sua planilha'}
            </p>
            <p className="text-sm text-zinc-500">ou clique para selecionar</p>
          </div>
        )}
      </div>

      {/* Column information */}
      <div className="mt-4 p-4 bg-zinc-50 rounded-lg">
        <p className="text-sm font-medium text-zinc-700 mb-2">Estrutura esperada da planilha:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-200">
                <th className="px-2 py-1 text-left rounded-tl">Nome *</th>
                <th className="px-2 py-1 text-left">SKU *</th>
                <th className="px-2 py-1 text-left">EAN</th>
                <th className="px-2 py-1 text-left">Local</th>
                <th className="px-2 py-1 text-left rounded-tr">Preço</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-white">
                <td className="px-2 py-1 border-b">Case ESR Premium</td>
                <td className="px-2 py-1 border-b font-mono">ESR001</td>
                <td className="px-2 py-1 border-b font-mono">7891234567890</td>
                <td className="px-2 py-1 border-b">Rua A, Vão 1</td>
                <td className="px-2 py-1 border-b">49,90</td>
              </tr>
              <tr className="bg-zinc-50">
                <td className="px-2 py-1">Pelicula Nillkin</td>
                <td className="px-2 py-1 font-mono">NIL002</td>
                <td className="px-2 py-1 font-mono">7891234567891</td>
                <td className="px-2 py-1">Rua B, Vão 3</td>
                <td className="px-2 py-1">29,90</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          * Campos obrigatórios. A ordem das colunas não afeta a importação.
        </p>
      </div>
    </div>
  );
};
