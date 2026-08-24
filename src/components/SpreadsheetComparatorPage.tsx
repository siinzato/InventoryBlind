/**
 * SpreadsheetComparatorPage — Comparador de Planilhas
 *
 * Ferramenta independente do Importador de Produtos: compara duas planilhas
 * quaisquer (.xlsx/.xls/.csv) por chave simples ou composta, sem exigir
 * cadastro no InventoryBlind. Todo o processamento é local — nada é enviado
 * ao Supabase. Não persiste dado de planilha, só preferências de UI
 * (`ib_spreadsheet_comparator_prefs`, chave própria).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GitCompareArrows, RefreshCw, X, CheckCircle2, AlertCircle, StopCircle, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from './ui';
import { ComparatorStepper } from './spreadsheet-comparator/ComparatorStepper';
import { PresetStep } from './spreadsheet-comparator/PresetStep';
import { FileUploadPanel } from './spreadsheet-comparator/FileUploadPanel';
import { KeyMappingStep } from './spreadsheet-comparator/KeyMappingStep';
import { FieldMappingStep } from './spreadsheet-comparator/FieldMappingStep';
import { ComparisonSettings } from './spreadsheet-comparator/ComparisonSettings';
import { ComparisonReview } from './spreadsheet-comparator/ComparisonReview';
import { ComparisonDashboard } from './spreadsheet-comparator/ComparisonDashboard';
import { ComparisonTable } from './spreadsheet-comparator/ComparisonTable';
import { ComparisonDetails } from './spreadsheet-comparator/ComparisonDetails';
import {
  ComparatorPresetId, COMPARATOR_PRESETS, ComparatorBaseState, createEmptyBaseState,
  KeyPartMapping, FieldMapping, ComparisonSettings as ComparisonSettingsType, ComparisonResult,
  ComparisonRecord, ComparisonStatus,
} from '../lib/spreadsheet-comparator/types';
import { buildParsedSheet } from '../lib/spreadsheet-comparator/fileParser';
import { runComparison } from '../lib/spreadsheet-comparator/comparisonEngine';
import { buildResultCSV, downloadTextFile, downloadResultWorkbook, buildAndDownloadPdfReport, ComparisonConfigSnapshot } from '../lib/spreadsheet-comparator/exportUtils';
import { loadComparatorPrefs, saveComparatorPrefs } from '../lib/spreadsheet-comparator/prefs';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType }
let _tid = 0;

const DEFAULT_SETTINGS: ComparisonSettingsType = {
  duplicateStrategy: 'aggregate', defaultCaseSensitive: false, defaultToleranceAbsolute: 0, defaultTolerancePercent: 0,
};

let _keyPartId = 0;
const nextKeyPartId = () => `key-init-${++_keyPartId}`;

interface SpreadsheetComparatorPageProps {
  onBack: () => void;
}

export const SpreadsheetComparatorPage: React.FC<SpreadsheetComparatorPageProps> = ({ onBack }) => {
  const [step, setStep] = useState<Step>(1);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [preset, setPreset] = useState<ComparatorPresetId>('custom');
  const [labelA, setLabelA] = useState('Planilha A');
  const [labelB, setLabelB] = useState('Planilha B');

  const [baseA, setBaseA] = useState<ComparatorBaseState>(() => createEmptyBaseState('Planilha A'));
  const [baseB, setBaseB] = useState<ComparatorBaseState>(() => createEmptyBaseState('Planilha B'));

  const [keyParts, setKeyParts] = useState<KeyPartMapping[]>([{ id: nextKeyPartId(), label: 'Chave', columnA: null, columnB: null }]);
  const [fields, setFields] = useState<FieldMapping[]>([]);
  const [settings, setSettings] = useState<ComparisonSettingsType>(DEFAULT_SETTINGS);

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [tableFilter, setTableFilter] = useState<ComparisonStatus | 'all' | 'duplicates-a' | 'duplicates-b'>('all');
  const [detailsRecord, setDetailsRecord] = useState<ComparisonRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [comparisonName, setComparisonName] = useState('');

  useEffect(() => {
    const saved = loadComparatorPrefs();
    if (saved) {
      if (saved.preset) setPreset(saved.preset);
      setSettings(s => ({
        ...s,
        defaultCaseSensitive: saved.defaultCaseSensitive ?? s.defaultCaseSensitive,
        duplicateStrategy: saved.duplicateStrategy ?? s.duplicateStrategy,
        defaultToleranceAbsolute: saved.defaultToleranceAbsolute ?? s.defaultToleranceAbsolute,
        defaultTolerancePercent: saved.defaultTolerancePercent ?? s.defaultTolerancePercent,
      }));
    }
  }, []);

  useEffect(() => {
    saveComparatorPrefs({
      preset, defaultCaseSensitive: settings.defaultCaseSensitive, duplicateStrategy: settings.duplicateStrategy,
      defaultToleranceAbsolute: settings.defaultToleranceAbsolute, defaultTolerancePercent: settings.defaultTolerancePercent,
      visibleColumns: [],
    });
  }, [preset, settings]);

  const toast = (message: string, type: ToastType = 'info') => {
    const id = ++_tid;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  };

  const parsedA = useMemo(() => buildParsedSheet(baseA.grid, baseA.headerRowIndex, baseA.truncated), [baseA.grid, baseA.headerRowIndex, baseA.truncated]);
  const parsedB = useMemo(() => buildParsedSheet(baseB.grid, baseB.headerRowIndex, baseB.truncated), [baseB.grid, baseB.headerRowIndex, baseB.truncated]);

  const handleSelectPreset = (id: ComparatorPresetId) => {
    setPreset(id);
    const p = COMPARATOR_PRESETS.find(x => x.id === id);
    if (p) { setLabelA(p.labelA); setLabelB(p.labelB); }
  };

  const resetAll = () => {
    setStep(1);
    setBaseA(createEmptyBaseState(labelA));
    setBaseB(createEmptyBaseState(labelB));
    setKeyParts([{ id: nextKeyPartId(), label: 'Chave', columnA: null, columnB: null }]);
    setFields([]);
    setResult(null);
    setTableFilter('all');
    setDetailsRecord(null);
    toast('Nova comparação iniciada — arquivos anteriores removidos da memória.', 'info');
  };

  const handleProcess = async () => {
    setStep(6);
    setProcessing(true);
    setProgress({ done: 0, total: 0 });
    cancelRef.current = false;
    try {
      const comparisonResult = await runComparison(parsedA.rows, parsedB.rows, keyParts, fields, settings, {
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelRef.current,
      });
      setResult(comparisonResult);
      setStep(7);
      toast('Comparação concluída.', 'success');
    } catch (err) {
      if (err instanceof Error && err.message === 'CANCELLED') {
        toast('Processamento cancelado.', 'info');
        setStep(5);
      } else {
        console.error('[SpreadsheetComparator] processing error:', err);
        toast('Erro ao processar a comparação.', 'error');
        setStep(5);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = () => { cancelRef.current = true; };

  const configSnapshot: ComparisonConfigSnapshot = {
    labelA, labelB, fileNameA: baseA.meta?.name ?? null, fileNameB: baseB.meta?.name ?? null,
    keyParts, fields, settings,
  };

  const handleExportExcel = async () => {
    if (!result) return;
    setExporting(true);
    try {
      await downloadResultWorkbook(result, configSnapshot, `comparacao-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast('Excel exportado.', 'success');
    } catch (err) {
      console.error('[SpreadsheetComparator] excel export error:', err);
      toast('Erro ao exportar Excel.', 'error');
    } finally { setExporting(false); }
  };

  const handleExportCSV = (subset: 'filtered' | 'divergent' | 'missing' | 'duplicates' | 'invalid') => {
    if (!result) return;
    let records = result.records;
    if (subset === 'divergent') records = records.filter(r => r.status === 'divergent');
    else if (subset === 'missing') records = records.filter(r => r.status === 'only-a' || r.status === 'only-b');
    else if (subset === 'duplicates') records = records.filter(r => r.duplicateGroupSizeA > 1 || r.duplicateGroupSizeB > 1);
    else if (subset === 'invalid') records = records.filter(r => r.status === 'invalid');
    else if (tableFilter !== 'all') {
      records = records.filter(r => {
        if (tableFilter === 'duplicates-a') return r.duplicateGroupSizeA > 1;
        if (tableFilter === 'duplicates-b') return r.duplicateGroupSizeB > 1;
        return r.status === tableFilter;
      });
    }
    downloadTextFile(buildResultCSV(records, fields), `comparacao-${subset}-${new Date().toISOString().slice(0, 10)}.csv`);
    toast('CSV exportado.', 'success');
  };

  const handleExportPDF = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const topDivergences = [...result.records]
        .filter(r => r.status === 'divergent')
        .sort((a, b) => {
          const da = Math.max(...a.fields.map(f => (f.difference !== null ? Math.abs(f.difference) : 0)), 0);
          const db = Math.max(...b.fields.map(f => (f.difference !== null ? Math.abs(f.difference) : 0)), 0);
          return db - da;
        })
        .slice(0, 15);
      await buildAndDownloadPdfReport({
        comparisonName: comparisonName || `${labelA} × ${labelB}`,
        generatedAt: new Date(), config: configSnapshot, result, topDivergences,
      });
      toast('PDF gerado.', 'success');
    } catch (err) {
      console.error('[SpreadsheetComparator] PDF export error:', err);
      toast('Erro ao gerar PDF.', 'error');
    } finally { setExporting(false); }
  };

  const canGoToStep3 = !!baseA.meta && !!baseB.meta && !baseA.error && !baseB.error;

  return (
    <div className="min-h-screen bg-surface p-6 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* TOASTS */}
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-container shadow-panel text-sm font-semibold max-w-xs pointer-events-auto ${
              t.type === 'success' ? 'bg-emerald-600 text-white' : t.type === 'error' ? 'bg-red-600 text-white' : 'bg-surface-2 text-fg border border-edge'}`}>
              {t.type === 'success' ? <CheckCircle2 size={15} /> : t.type === 'error' ? <AlertCircle size={15} /> : null}
              {t.message}
            </div>
          ))}
        </div>

        {/* HEADER */}
        <div className="mb-8">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg transition-colors mb-6">
            <ArrowLeft size={18} />Voltar
          </button>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-accent rounded-xl">
                <GitCompareArrows size={28} className="text-white" />
              </div>
              <div>
                <h1 className="text-title">Comparador de Planilhas</h1>
                <p className="text-sm text-fg-muted mt-1">Compare duas bases por chave, campo a campo — tudo no seu navegador</p>
              </div>
            </div>
            {step > 1 && (
              <Button variant="secondary" size="sm" onClick={resetAll}><X size={14} />Nova comparação</Button>
            )}
          </div>
        </div>

        <ComparatorStepper currentStep={step} />

        {step === 1 && (
          <PresetStep
            preset={preset} labelA={labelA} labelB={labelB}
            onSelectPreset={handleSelectPreset} onLabelAChange={setLabelA} onLabelBChange={setLabelB}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <FileUploadPanel base={{ ...baseA, label: labelA }} onChange={patch => setBaseA(b => ({ ...b, ...patch }))} />
              <FileUploadPanel base={{ ...baseB, label: labelB }} onChange={patch => setBaseB(b => ({ ...b, ...patch }))} />
            </div>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>Voltar</Button>
              <Button onClick={() => setStep(3)} disabled={!canGoToStep3}>Continuar</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <KeyMappingStep
              headersA={parsedA.headers} headersB={parsedB.headers}
              sampleRowA={parsedA.rows[0]} sampleRowB={parsedB.rows[0]}
              keyParts={keyParts} onChange={setKeyParts}
            />
            <FieldMappingStep headersA={parsedA.headers} headersB={parsedB.headers} fields={fields} onChange={setFields} />
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>Voltar</Button>
              <Button onClick={() => setStep(4)}>Continuar</Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <ComparisonSettings settings={settings} onChange={patch => setSettings(s => ({ ...s, ...patch }))} />
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>Voltar</Button>
              <Button onClick={() => setStep(5)}>Continuar</Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <ComparisonReview
              baseA={baseA} baseB={baseB} rowsCountA={parsedA.rows.length} rowsCountB={parsedB.rows.length}
              keyParts={keyParts} fields={fields} settings={settings} onProcess={handleProcess}
            />
            <div className="flex justify-start">
              <Button variant="secondary" onClick={() => setStep(4)}>Voltar</Button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="bg-surface-2 rounded-xl border border-edge p-10 flex flex-col items-center gap-4">
            <RefreshCw size={32} className="animate-spin text-accent" />
            <p className="text-sm text-fg-muted">
              {progress.total > 0 ? `Processando ${progress.done} de ${progress.total} chave(s)...` : 'Processando...'}
            </p>
            <Button variant="secondary" size="sm" onClick={handleCancel} disabled={!processing}>
              <StopCircle size={14} />Cancelar
            </Button>
          </div>
        )}

        {step === 7 && result && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <input value={comparisonName} onChange={e => setComparisonName(e.target.value)} placeholder={`${labelA} × ${labelB}`}
                className="px-3 py-2 border border-edge rounded-lg text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent/40 max-w-xs" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleExportExcel} disabled={exporting}><FileSpreadsheet size={14} />Excel</Button>
                <Button size="sm" variant="secondary" onClick={() => handleExportCSV('filtered')} disabled={exporting}><Download size={14} />CSV (filtro atual)</Button>
                <Button size="sm" variant="secondary" onClick={() => handleExportCSV('divergent')} disabled={exporting}>Divergências</Button>
                <Button size="sm" variant="secondary" onClick={() => handleExportCSV('missing')} disabled={exporting}>Ausentes</Button>
                <Button size="sm" variant="secondary" onClick={() => handleExportCSV('duplicates')} disabled={exporting}>Duplicados</Button>
                <Button size="sm" variant="secondary" onClick={() => handleExportCSV('invalid')} disabled={exporting}>Inválidos</Button>
                <Button size="sm" variant="secondary" onClick={handleExportPDF} disabled={exporting}><FileText size={14} />PDF</Button>
              </div>
            </div>

            <ComparisonDashboard summary={result.summary} activeFilter={tableFilter} onFilterChange={setTableFilter} />
            <ComparisonTable records={result.records} fields={fields} filter={tableFilter} onFilterChange={setTableFilter} onOpenDetails={setDetailsRecord} />
          </div>
        )}
      </div>

      <ComparisonDetails record={detailsRecord} labelA={labelA} labelB={labelB} onClose={() => setDetailsRecord(null)} />
    </div>
  );
};

export default SpreadsheetComparatorPage;
