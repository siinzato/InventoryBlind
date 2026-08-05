// Column Mapping Wizard Component

import React, { useState, useMemo } from 'react';
import { MapPin, AlertTriangle, CheckCircle, ArrowRight, Info } from 'lucide-react';
import type { ColumnMapping, DetectedColumn } from '../lib/productImportTypes';
import { detectColumnMappings, suggestMapping, STANDARD_FIELDS } from '../lib/productImportUtils';
import { Panel, PanelSection, Button, Badge, Table, Thead, Tr, Th, Td } from './ui';

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
      case 'high': return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400';
      case 'medium': return 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400';
      case 'low': return 'bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400';
      default: return 'bg-surface-3 border-edge text-fg-muted';
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
    <Panel>
      {/* Header */}
      <PanelSection>
        <div className="flex items-center gap-2 mb-2">
          <MapPin size={20} className="text-fg-subtle" />
          <h3 className="text-title">Mapeamento de Colunas</h3>
        </div>

        <p className="text-sm text-fg-subtle">
          Selecione qual coluna da planilha corresponde a cada campo do sistema. As colunas foram detectadas automaticamente, mas voce pode ajustar conforme necessario.
        </p>
      </PanelSection>

      {/* Info box + validation errors */}
      <PanelSection>
        <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <Info size={16} className="text-accent mt-0.5 flex-shrink-0" />
            <div className="text-sm text-accent">
              <p><strong>Campos obrigatorios:</strong> Nome e SKU precisam ser mapeados.</p>
              <p className="mt-1"><strong>Deteccao automatica:</strong> O sistema detectou {detectedColumns.filter(d => d.confidence !== 'none').length} de {headers.length} colunas.</p>
            </div>
          </div>
        </div>

        {!allRequiredMapped && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-4 mt-4">
            <AlertTriangle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-400">
              Os campos obrigatorios (Nome e SKU) precisam ser mapeados.
            </span>
          </div>
        )}

        {hasDuplicates && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-4 mt-4">
            <AlertTriangle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-400">
              Uma coluna nao pode ser mapeada para mais de um campo.
            </span>
          </div>
        )}
      </PanelSection>

      {/* Mapping table */}
      <PanelSection>
        <Table>
          <Thead>
            <Tr>
              <Th>Campo do Sistema</Th>
              <Th>Coluna da Planilha</Th>
              <Th>Detectado</Th>
              <Th>Exemplo</Th>
            </Tr>
          </Thead>
          <tbody>
            {STANDARD_FIELDS.map((field) => {
              const detected = detectedColumns.find(d => d.detectedField === field.key);
              const currentValue = mapping[field.key as keyof ColumnMapping];
              const sampleValues = currentValue ? getSampleValues(currentValue) : [];

              return (
                <Tr key={field.key}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-fg">{field.label}</span>
                      {field.required && (
                        <Badge variant="danger">Obrigatorio</Badge>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <select
                      value={currentValue || ''}
                      onChange={(e) => handleSelectChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 bg-surface text-fg border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="">-- Selecione --</option>
                      {headers.map(header => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    {detected && detected.confidence !== 'none' ? (
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded border ${getConfidenceStyle(detected.confidence)}`}>
                          {detected.name}
                        </span>
                        {detected.confidence === 'high' && (
                          <CheckCircle size={14} className="text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">Nao detectado</span>
                    )}
                  </Td>
                  <Td>
                    {sampleValues.length > 0 ? (
                      <div className="text-xs text-fg-muted font-mono space-y-1">
                        {sampleValues.slice(0, 2).map((v, i) => (
                          <div key={i} className="truncate max-w-[150px]">{v}</div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-fg-subtle">-</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </PanelSection>

      {/* Preview of mapped data */}
      <PanelSection>
        <h4 className="text-section mb-3">Pre-visualizacao dos dados mapeados</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-edge">
                <th className="px-2 py-2 text-left font-medium uppercase tracking-wide text-fg-subtle">Nome</th>
                <th className="px-2 py-2 text-left font-medium uppercase tracking-wide text-fg-subtle">SKU</th>
                <th className="px-2 py-2 text-left font-medium uppercase tracking-wide text-fg-subtle">EAN</th>
                <th className="px-2 py-2 text-left font-medium uppercase tracking-wide text-fg-subtle">Local</th>
                <th className="px-2 py-2 text-left font-medium uppercase tracking-wide text-fg-subtle">Preco</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {sampleRows.slice(0, 3).map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-2 text-fg truncate max-w-[150px]">
                    {mapping.name ? String(row[mapping.name] || '-') : '-'}
                  </td>
                  <td className="px-2 py-2 text-fg font-mono truncate max-w-[100px]">
                    {mapping.sku ? String(row[mapping.sku] || '-') : '-'}
                  </td>
                  <td className="px-2 py-2 text-fg font-mono truncate max-w-[100px]">
                    {mapping.ean ? String(row[mapping.ean] || '-') : '-'}
                  </td>
                  <td className="px-2 py-2 text-fg truncate max-w-[100px]">
                    {mapping.location ? String(row[mapping.location] || '-') : '-'}
                  </td>
                  <td className="px-2 py-2 text-fg">
                    {mapping.price ? String(row[mapping.price] || '-') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelSection>

      {/* Actions */}
      <PanelSection padding="sm">
        <div className="flex items-center justify-between gap-4">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => onConfirm(mapping)} disabled={!canProceed}>
            Continuar
            <ArrowRight size={18} />
          </Button>
        </div>
      </PanelSection>
    </Panel>
  );
};
