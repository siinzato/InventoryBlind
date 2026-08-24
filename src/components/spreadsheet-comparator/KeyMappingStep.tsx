import React from 'react';
import { Plus, Trash2, KeyRound } from 'lucide-react';
import { KeyPartMapping, SpreadsheetDataRow } from '../../lib/spreadsheet-comparator/types';
import { normalizeIdentifier, buildCompositeKey } from '../../lib/spreadsheet-comparator/normalization';

interface KeyMappingStepProps {
  headersA: string[];
  headersB: string[];
  sampleRowA: SpreadsheetDataRow | undefined;
  sampleRowB: SpreadsheetDataRow | undefined;
  keyParts: KeyPartMapping[];
  onChange: (parts: KeyPartMapping[]) => void;
}

let _partId = 0;
const nextPartId = () => `key-${++_partId}-${Date.now()}`;

export const KeyMappingStep: React.FC<KeyMappingStepProps> = ({ headersA, headersB, sampleRowA, sampleRowB, keyParts, onChange }) => {
  const updatePart = (id: string, patch: Partial<KeyPartMapping>) => {
    onChange(keyParts.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const addPart = () => onChange([...keyParts, { id: nextPartId(), label: `Parte ${keyParts.length + 1}`, columnA: null, columnB: null }]);
  const removePart = (id: string) => onChange(keyParts.filter(p => p.id !== id));

  const previewA = keyParts.every(p => p.columnA)
    ? buildCompositeKey(keyParts.map(p => normalizeIdentifier(sampleRowA?.data[p.columnA!]).value)).replace(/␟/g, ' + ')
    : null;
  const previewB = keyParts.every(p => p.columnB)
    ? buildCompositeKey(keyParts.map(p => normalizeIdentifier(sampleRowB?.data[p.columnB!]).value)).replace(/␟/g, ' + ')
    : null;

  return (
    <div className="bg-surface-2 rounded-xl border border-edge p-5">
      <h2 className="font-bold text-fg text-sm mb-1 flex items-center gap-2"><KeyRound size={16} className="text-fg-subtle" />Chave de comparação</h2>
      <p className="text-xs text-fg-subtle mb-4">Simples (uma parte) ou composta (várias). As colunas podem ter nomes diferentes em cada base.</p>

      <div className="space-y-2">
        {keyParts.map(part => (
          <div key={part.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
            <input value={part.label} onChange={e => updatePart(part.id, { label: e.target.value })} placeholder="Nome da parte"
              className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40" />
            <select value={part.columnA ?? ''} onChange={e => updatePart(part.id, { columnA: e.target.value || null })}
              className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
              <option value="">Coluna na Planilha A...</option>
              {headersA.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <select value={part.columnB ?? ''} onChange={e => updatePart(part.id, { columnB: e.target.value || null })}
              className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40">
              <option value="">Coluna na Planilha B...</option>
              {headersB.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <button onClick={() => removePart(part.id)} disabled={keyParts.length <= 1}
              className="p-2 text-fg-subtle hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <button onClick={addPart} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-strong">
        <Plus size={14} />Adicionar parte à chave composta
      </button>

      {(previewA || previewB) && (
        <div className="mt-4 p-3 bg-surface-3 rounded-lg text-xs space-y-1">
          <p className="text-fg-subtle font-semibold uppercase">Prévia da chave final (primeira linha de cada base)</p>
          {previewA && <p className="font-mono text-fg">A: {previewA}</p>}
          {previewB && <p className="font-mono text-fg">B: {previewB}</p>}
        </div>
      )}
    </div>
  );
};

export default KeyMappingStep;
