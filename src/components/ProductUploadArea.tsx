// Product Upload Area Component

import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { Panel, PanelSection, Table, Thead, Tr, Th, Td } from './ui';

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
    <Panel>
      <PanelSection>
        <h3 className="text-title flex items-center gap-2">
          <FileSpreadsheet size={20} className="text-fg-subtle" />
          Selecione a Planilha
        </h3>

        {/* Accepted formats info */}
        <p className="text-sm text-fg-muted mt-2">
          <strong className="text-fg">Formatos aceitos:</strong> Excel (.xlsx, .xls) ou CSV (.csv)
        </p>
        <p className="text-xs text-fg-subtle mt-1 mb-5">
          Colunas esperadas: Nome, SKU, EAN, Local, Preço
        </p>

        {/* Drop zone */}
        <div
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${isDragging
              ? 'border-accent bg-accent/10'
              : selectedFile
                ? 'border-emerald-500/20 bg-emerald-500/10'
                : 'border-edge hover:border-fg-subtle hover:bg-surface-3'
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
              <div className="animate-spin w-12 h-12 border-4 border-accent border-t-transparent rounded-full" />
              <p className="text-fg-muted font-medium">Processando planilha...</p>
            </div>
          ) : selectedFile ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 size={48} className="text-emerald-600 dark:text-emerald-400" />
              <p className="font-medium text-fg">{selectedFile.name}</p>
              <p className="text-sm text-fg-subtle">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
              <p className="text-xs text-accent mt-2">
                Clique para selecionar outro arquivo
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={48} className={`${isDragging ? 'text-accent' : 'text-fg-subtle'}`} />
              <p className="font-medium text-fg">
                {isDragging ? 'Solte o arquivo aqui' : 'Arraste e solte sua planilha'}
              </p>
              <p className="text-sm text-fg-subtle">ou clique para selecionar</p>
            </div>
          )}
        </div>
      </PanelSection>

      {/* Column information */}
      <PanelSection>
        <p className="text-section mb-3">Estrutura esperada da planilha:</p>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <tr>
                <Th>Nome *</Th>
                <Th>SKU *</Th>
                <Th>EAN</Th>
                <Th>Local</Th>
                <Th>Preço</Th>
              </tr>
            </Thead>
            <tbody>
              <Tr>
                <Td>Case ESR Premium</Td>
                <Td className="font-mono">ESR001</Td>
                <Td className="font-mono">7891234567890</Td>
                <Td>Rua A, Vão 1</Td>
                <Td>49,90</Td>
              </Tr>
              <Tr>
                <Td>Pelicula Nillkin</Td>
                <Td className="font-mono">NIL002</Td>
                <Td className="font-mono">7891234567891</Td>
                <Td>Rua B, Vão 3</Td>
                <Td>29,90</Td>
              </Tr>
            </tbody>
          </Table>
        </div>
        <p className="text-xs text-fg-subtle mt-3">
          * Campos obrigatórios. A ordem das colunas não afeta a importação.
        </p>
      </PanelSection>
    </Panel>
  );
};
