import React, { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, ArrowRight, Info } from 'lucide-react';
import { Panel, PanelSection, Button, Badge, Table, Thead, Tr, Th, Td, Select } from '../ui';
import {
  BarcodeRow, BARCODE_BATCH_FIELDS, BarcodeColumnMapping,
  detectBarcodeColumnMappings, suggestBarcodeMapping, applyBarcodeColumnMapping, parseBarcodeBatchFile,
} from '../../lib/barcode/barcodeBatchUtils';
import { BarcodeSymbology, BARCODE_SYMBOLOGIES } from '../../lib/barcode/barcodeTypes';

interface BarcodeBatchImportProps {
  onConfirm: (rawRows: BarcodeRow[], globalSymbology: BarcodeSymbology | null) => void;
}

type Step = 'upload' | 'mapping';

export const BarcodeBatchImport: React.FC<BarcodeBatchImportProps> = ({ onConfirm }) => {
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<BarcodeRow[]>([]);
  const [mapping, setMapping] = useState<BarcodeColumnMapping | null>(null);
  const [globalSymbology, setGlobalSymbology] = useState<BarcodeSymbology | ''>('');
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const { headers: h, rows: r } = await parseBarcodeBatchFile(file);
      if (r.length === 0) { setError('Nenhuma linha encontrada no arquivo.'); return; }
      setHeaders(h);
      setRawRows(r);
      const detected = detectBarcodeColumnMappings(h);
      setMapping(suggestBarcodeMapping(detected));
      setStep('mapping');
    } catch (err) {
      console.error('[BarcodeLab] batch parse error:', err);
      setError('Não foi possível ler o arquivo. Verifique se é um .xlsx, .xls ou .csv válido.');
    } finally { setLoading(false); }
  };

  const sampleRows = useMemo(() => rawRows.slice(0, 3), [rawRows]);

  const handleConfirm = () => {
    if (!mapping || !mapping.value) return;
    onConfirm(applyBarcodeColumnMapping(rawRows, mapping), globalSymbology || null);
  };

  if (step === 'upload') {
    return (
      <Panel>
        <PanelSection padding="lg" className="space-y-4">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-edge rounded-xl p-10 text-center cursor-pointer transition-colors hover:border-accent hover:bg-accent/5">
            <Upload size={28} className="text-fg-subtle" />
            <p className="text-sm text-fg-muted">{loading ? 'Lendo arquivo...' : 'Arraste ou clique para enviar XLSX, XLS ou CSV'}</p>
            <input type="file" accept=".xlsx,.xls,.csv" disabled={loading} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-start gap-2 text-xs text-fg-subtle">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <p>Colunas aceitas: Valor do Código (obrigatório), Tipo, Nome, SKU, Localização, Lote, Validade, Quantidade, Cópias.</p>
          </div>
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelSection padding="lg" className="space-y-4">
        <p className="text-sm text-fg-muted flex items-center gap-2"><FileSpreadsheet size={16} />Confirme como as colunas do arquivo correspondem aos campos esperados.</p>

        <div>
          <label className="block text-xs font-semibold text-fg-subtle uppercase mb-1.5">Tipo de código para todo o arquivo (opcional)</label>
          <Select value={globalSymbology} onChange={e => setGlobalSymbology(e.target.value as BarcodeSymbology | '')} className="max-w-xs">
            <option value="">Definir por linha (coluna "Tipo")</option>
            {BARCODE_SYMBOLOGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <p className="text-xs text-fg-subtle mt-1">Se nenhum tipo global for escolhido, cada linha deve informar o próprio tipo na coluna mapeada abaixo.</p>
        </div>

        {mapping && BARCODE_BATCH_FIELDS.map(field => (
          <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
            <label className="text-sm text-fg">{field.label}{field.required && ' *'}</label>
            <Select
              value={mapping[field.key] ?? ''}
              onChange={e => setMapping(prev => prev && ({ ...prev, [field.key]: e.target.value || null }))}
            >
              <option value="">— Não mapear —</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </Select>
          </div>
        ))}

        {sampleRows.length > 0 && (
          <div className="overflow-x-auto border border-edge rounded-lg">
            <Table>
              <Thead><Tr>{headers.map(h => <Th key={h}>{h}</Th>)}</Tr></Thead>
              <tbody>
                {sampleRows.map((row, i) => (
                  <Tr key={i}>{headers.map(h => <Td key={h}>{String(row[h] ?? '—')}</Td>)}</Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={() => setStep('upload')}>Voltar</Button>
          <Button onClick={handleConfirm} disabled={!mapping?.value}>
            <ArrowRight size={16} />Continuar para pré-visualização
          </Button>
        </div>
        {!mapping?.value && <Badge variant="warning">Mapeie a coluna "Valor do Código" para continuar.</Badge>}
      </PanelSection>
    </Panel>
  );
};

export default BarcodeBatchImport;
