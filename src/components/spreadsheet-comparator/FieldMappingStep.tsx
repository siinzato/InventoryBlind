import React from 'react';
import { Plus, Trash2, ListChecks } from 'lucide-react';
import { FieldMapping, FieldDataType } from '../../lib/spreadsheet-comparator/types';

interface FieldMappingStepProps {
  headersA: string[];
  headersB: string[];
  fields: FieldMapping[];
  onChange: (fields: FieldMapping[]) => void;
}

let _fieldId = 0;
const nextFieldId = () => `field-${++_fieldId}-${Date.now()}`;

const DATA_TYPE_LABEL: Record<FieldDataType, string> = { text: 'Texto', number: 'Número', date: 'Data', auto: 'Automático' };

export const FieldMappingStep: React.FC<FieldMappingStepProps> = ({ headersA, headersB, fields, onChange }) => {
  const updateField = (id: string, patch: Partial<FieldMapping>) => onChange(fields.map(f => f.id === id ? { ...f, ...patch } : f));
  const addField = () => onChange([...fields, {
    id: nextFieldId(), label: `Campo ${fields.length + 1}`, columnA: null, columnB: null,
    dataType: 'auto', caseSensitive: false, toleranceAbsolute: 0, tolerancePercent: 0,
  }]);
  const removeField = (id: string) => onChange(fields.filter(f => f.id !== id));

  return (
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-1 flex items-center gap-2"><ListChecks size={16} className="text-fg-subtle" />Campos comparados</h2>
      <p className="text-xs text-fg-subtle mb-4">Opcional — você pode comparar só a existência das chaves, sem mapear nenhum campo adicional.</p>

      <div className="space-y-3">
        {fields.map(field => (
          <div key={field.id} className="border border-edge rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2">
              <input value={field.label} onChange={e => updateField(field.id, { label: e.target.value })} placeholder="Nome amigável (ex.: Quantidade)"
                className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
              <select value={field.columnA ?? ''} onChange={e => updateField(field.id, { columnA: e.target.value || null })}
                className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
                <option value="">Coluna na Planilha A...</option>
                {headersA.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <select value={field.columnB ?? ''} onChange={e => updateField(field.id, { columnB: e.target.value || null })}
                className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
                <option value="">Coluna na Planilha B...</option>
                {headersB.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="text-xs text-fg-subtle mr-1.5">Tipo:</label>
                <select value={field.dataType} onChange={e => updateField(field.id, { dataType: e.target.value as FieldDataType })}
                  className="px-2 py-1.5 border border-edge rounded-lg text-xs bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
                  {(['auto', 'text', 'number', 'date'] as FieldDataType[]).map(t => <option key={t} value={t}>{DATA_TYPE_LABEL[t]}</option>)}
                </select>
              </div>

              {(field.dataType === 'number' || field.dataType === 'auto') && (
                <>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-fg-subtle">Tolerância abs.:</label>
                    <input type="number" min={0} step={0.01} value={field.toleranceAbsolute}
                      onChange={e => updateField(field.id, { toleranceAbsolute: Math.max(0, Number(e.target.value)) })}
                      className="w-20 px-2 py-1.5 border border-edge rounded-lg text-xs font-mono bg-surface text-fg" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-fg-subtle">Tolerância %:</label>
                    <input type="number" min={0} step={0.1} value={field.tolerancePercent}
                      onChange={e => updateField(field.id, { tolerancePercent: Math.max(0, Number(e.target.value)) })}
                      className="w-20 px-2 py-1.5 border border-edge rounded-lg text-xs font-mono bg-surface text-fg" />
                  </div>
                </>
              )}

              {(field.dataType === 'text' || field.dataType === 'auto') && (
                <label className="flex items-center gap-1.5 text-xs text-fg-subtle cursor-pointer">
                  <input type="checkbox" checked={field.caseSensitive} onChange={e => updateField(field.id, { caseSensitive: e.target.checked })} className="accent-accent" />
                  Diferenciar maiúsculas/minúsculas
                </label>
              )}

              <button onClick={() => removeField(field.id)} className="ml-auto p-1.5 text-fg-subtle hover:text-red-600 dark:hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addField} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-strong">
        <Plus size={14} />Adicionar campo comparado
      </button>
    </div>
  );
};

export default FieldMappingStep;
