// Column Mapping Wizard Component

import React, { useState, useMemo } from 'react';
import { MapPin, AlertTriangle, CheckCircle, ArrowRight, Info } from 'lucide-react';
import type { ColumnMapping, DetectedColumn } from '../lib/productImportTypes';
import { detectColumnMappings, suggestMapping, STANDARD_FIELDS } from '../lib/productImportUtils';

interface ColumnMappingWizardProps {
  headers: string[];
  sampleRows: Array<{ [key: string]: string | number | undefined }>;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

export const ColumnMappingWizard: React.FC<ColumnMappingWizardProps> = ({
  headers,
  sampleRows,
  onConfirm,
  onCancel,
}) => {
  const detectedColumns = useMemo(() => detectColumnMappings(headers), [headers]);
  const suggestedMapping = useMemo(() => suggestMapping(detectedColumns), [detectedColumns]);

  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    // Initialize with detected columns
    const m: ColumnMapping = {
      name: null,
      sku: null,
      ean: null,
      location: null,
      price: null,
    };

    detectedColumns.forEach(detected => {
      if (detected.detectedField && detected.confidence !== 'none') {
        (m as Record<string, string | null>)[detected.detectedField] = detected.name;
      }
    });

    return m;
  });

  const handleSelectChange = (field: string, value: string | null) => {
    setMapping(prev => ({
      ...prev,
      [field]: value === '' ? null : value,
    }));
  };

  const getConfidenceStyle = (confidence: string): string => {
    switch (confidence) {
      case 'high': return 'bg-emerald-100 border-emerald-300 text-emerald-700';
      case 'medium': return 'bg-amber-100 border-amber-300 text-amber-700';
      case 'low': return 'bg-orange-100 border-orange-300 text-orange-700';
      default: return 'bg-zinc-100 border-zinc-300 text-zinc-600';
    }
  };

  const getConfidenceIcon = (confidence: string): string => {
    switch (confidence) {
      case 'high': return 'Detectado com alta confiança';
      case 'medium': return 'Possível correspondencia';
      case 'low': return 'Correspondencia aproximada';
      default: return 'Nao detectado';
    }
  };

  // Check if required fields are mapped
  const requiredFields = STANDARD_FIELDS.filter(f => f.required);
  const allRequiredMapped = requiredFields.every(f => mapping[f.key as keyof ColumnMapping]);

  // Check for duplicate mappings
  const mappedValues = Object.values(mapping).filter(v => v !== null);
  const hasDuplicates = mappedValues.length !== new Set(mappedValues).size;

  const canProceed = allRequiredMapped && !hasDuplicates;

  // Get sample values for a column
  const getSampleValues = (columnName: string): string[] => {
    return sampleRows.slice(0, 3).map(row => {
      const val = row[columnName];
      if (val === undefined || val === null) return '';
      return String(val).substring(0, 30);
    }).filter(v => v);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={20} className="text-zinc-500" />
        <h3 className="font-semibold text-zinc-800">Mapeamento de Colunas</h3>
      </div>

      <p className="text-sm text-zinc-500 mb-6">
        Selecione qual coluna da planilha corresponde a cada campo do sistema. As colunas foram detectadas automaticamente, mas voce pode ajustar conforme necessario.
      </p>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p><strong>Campos obrigatorios:</strong> Nome e SKU precisam ser mapeados.</p>
            <p className="mt-1"><strong>Deteccao automatica:</strong> O sistema detectou {detectedColumns.filter(d => d.confidence !== 'none').length} de {headers.length} colunas.</p>
          </div>
        </div>
      </div>

      {/* Validation errors */}
      {!allRequiredMapped && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600" />
            <span className="text-sm text-red-700">
              Os campos obrigatorios (Nome e SKU) precisam ser mapeados.
            </span>
          </div>
        </div>
      )}

      {hasDuplicates && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600" />
            <span className="text-sm text-red-700">
              Uma coluna nao pode ser mapeada para mais de um campo.
            </span>
          </div>
        </div>
      )}

      {/* Mapping table */}
      <div className="border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-zinc-100">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">Campo do Sistema</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">Coluna da Planilha</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">Detectado</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">Exemplo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {STANDARD_FIELDS.map((field) => {
              const detected = detectedColumns.find(d => d.detectedField === field.key);
              const currentValue = mapping[field.key as keyof ColumnMapping];
              const sampleValues = currentValue ? getSampleValues(currentValue) : [];

              return (
                <tr key={field.key} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-800">{field.label}</span>
                      {field.required && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-medium rounded">
                          Obrigatorio
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={currentValue || ''}
                      onChange={(e) => handleSelectChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Selecione --</option>
                      {headers.map(header => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {detected && detected.confidence !== 'none' ? (
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded border ${getConfidenceStyle(detected.confidence)}`}>
                          {detected.name}
                        </span>
                        {detected.confidence === 'high' && (
                          <CheckCircle size={14} className="text-emerald-500" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">Nao detectado</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {sampleValues.length > 0 ? (
                      <div className="text-xs text-zinc-600 font-mono space-y-1">
                        {sampleValues.slice(0, 2).map((v, i) => (
                          <div key={i} className="truncate max-w-[150px]">{v}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Preview of mapped data */}
      <div className="bg-zinc-50 rounded-lg p-4 mb-6">
        <h4 className="font-medium text-zinc-700 mb-3">Pre-visualizacao dos dados mapeados</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-200">
                <th className="px-2 py-1 text-left">Nome</th>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">EAN</th>
                <th className="px-2 py-1 text-left">Local</th>
                <th className="px-2 py-1 text-left">Preco</th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.slice(0, 3).map((row, i) => (
                <tr key={i} className="bg-white">
                  <td className="px-2 py-1 border-b truncate max-w-[150px]">
                    {mapping.name ? String(row[mapping.name] || '-') : '-'}
                  </td>
                  <td className="px-2 py-1 border-b font-mono truncate max-w-[100px]">
                    {mapping.sku ? String(row[mapping.sku] || '-') : '-'}
                  </td>
                  <td className="px-2 py-1 border-b font-mono truncate max-w-[100px]">
                    {mapping.ean ? String(row[mapping.ean] || '-') : '-'}
                  </td>
                  <td className="px-2 py-1 border-b truncate max-w-[100px]">
                    {mapping.location ? String(row[mapping.location] || '-') : '-'}
                  </td>
                  <td className="px-2 py-1 border-b">
                    {mapping.price ? String(row[mapping.price] || '-') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-zinc-200 text-zinc-700 rounded-lg font-medium hover:bg-zinc-300 transition"
        >
          Cancelar
        </button>
        <button
          onClick={() => onConfirm(mapping)}
          disabled={!canProceed}
          className="flex items-center gap-2 px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continuar
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
};
