import { useMemo, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Printer, RotateCcw } from 'lucide-react';
import { Button, Panel, PanelSection, SegmentedControl } from '../ui';
import { PalletBoxForm } from './PalletBoxForm';
import { PalletSpecForm } from './PalletSpecForm';
import { PalletDiagram } from './PalletDiagram';
import { PalletResultCards } from './PalletResultCards';
import { calculatePallet } from '../../lib/palletCalc/calculatePallet';
import { downloadPalletReportPdf } from '../../lib/palletCalc/palletExportPdf';
import { downloadDiagramPng } from '../../lib/palletCalc/palletExportPng';
import { printPalletReport } from '../../lib/palletCalc/palletPrint';
import { PALLET_PRESETS } from '../../lib/palletCalc/palletPresets';
import type { LengthUnit, WeightUnit } from '../../lib/palletCalc/units';
import type { BoxSpec, PalletSpec } from '../../lib/palletCalc/types';
import type { PalletCalcPrefs } from '../../lib/palletCalc/palletCalcPrefs';

const DEFAULT_BOX: BoxSpec = {
  lengthMm: 400, widthMm: 300, heightMm: 250, weightKg: 5, quantity: 120,
  rotation: 'base90', stackable: true,
};

interface PalletCalcWorkspaceProps {
  initialViewMode: 'detail' | 'compare';
  prefs: PalletCalcPrefs;
  onPrefsChange: (patch: Partial<PalletCalcPrefs>) => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function PalletCalcWorkspace({ initialViewMode, prefs, onPrefsChange, toast }: PalletCalcWorkspaceProps) {
  const [presetId, setPresetId] = useState(prefs.lastPalletPresetId ?? 'pbr');
  const [box, setBox] = useState<BoxSpec>(DEFAULT_BOX);
  const [pallet, setPallet] = useState<PalletSpec>({ name: PALLET_PRESETS[0].label, ...PALLET_PRESETS[0].spec });
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>(prefs.lastLengthUnit ?? 'mm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(prefs.lastWeightUnit ?? 'kg');
  const [viewMode, setViewMode] = useState<'detail' | 'compare'>(initialViewMode);
  const [selectedAltIndex, setSelectedAltIndex] = useState(0);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => calculatePallet(box, pallet), [box, pallet]);
  const activeAlt = result.alternatives[Math.min(selectedAltIndex, result.alternatives.length - 1)] ?? result.recommended;
  const compareList = result.alternatives.slice(0, 3);

  const handlePresetChange = (id: string) => { setPresetId(id); onPrefsChange({ lastPalletPresetId: id }); };
  const handleLengthUnitChange = (unit: LengthUnit) => { setLengthUnit(unit); onPrefsChange({ lastLengthUnit: unit }); };
  const handleWeightUnitChange = (unit: WeightUnit) => { setWeightUnit(unit); onPrefsChange({ lastWeightUnit: unit }); };

  const handleExportPdf = async () => {
    if (!diagramRef.current) return;
    setBusy(true);
    try {
      await downloadPalletReportPdf({ result: { ...result, recommended: activeAlt }, diagramElement: diagramRef.current, filename: `paletizacao-${box.sku ?? 'produto'}.pdf` });
    } catch {
      toast('Falha ao gerar o PDF.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExportPng = async () => {
    if (!diagramRef.current) return;
    try {
      await downloadDiagramPng(diagramRef.current, `paletizacao-${box.sku ?? 'produto'}.png`);
    } catch {
      toast('Falha ao gerar a imagem.', 'error');
    }
  };

  const handlePrint = () => {
    if (!diagramRef.current) return;
    const diagramHtml = diagramRef.current.outerHTML;
    printPalletReport(area => {
      area.innerHTML = `
        <div style="font-family: sans-serif; padding: 12px;">
          <h1 style="font-size: 16px; margin-bottom: 8px;">Relatório de Paletização — ${box.sku ?? 'Produto'}</h1>
          <p style="font-size: 11px; color: #555;">${activeAlt.pattern.label} — ${activeAlt.pattern.boxesPerLayer} caixas/camada × ${activeAlt.layers.layers} camadas = ${activeAlt.capacityPerPallet} caixas/palete</p>
          ${diagramHtml}
          <p style="font-size: 9px; color: #777; margin-top: 8px;">Resultado geométrico estimado. Valide resistência das caixas, amarração e condições reais de transporte.</p>
        </div>`;
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelSection padding="md">
            <h2 className="mb-3 text-sm font-semibold text-fg">Produto / Caixa</h2>
            <PalletBoxForm box={box} onChange={setBox} lengthUnit={lengthUnit} onLengthUnitChange={handleLengthUnitChange} weightUnit={weightUnit} onWeightUnitChange={handleWeightUnitChange} />
          </PanelSection>
        </Panel>
        <Panel>
          <PanelSection padding="md">
            <h2 className="mb-3 text-sm font-semibold text-fg">Palete</h2>
            <PalletSpecForm pallet={pallet} onChange={setPallet} presetId={presetId} onPresetChange={handlePresetChange} lengthUnit={lengthUnit} customPallets={prefs.customPallets ?? []} />
          </PanelSection>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Visualização"
          value={viewMode}
          onChange={setViewMode}
          options={[{ value: 'detail', label: 'Detalhe' }, { value: 'compare', label: 'Comparar alternativas' }]}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSelectedAltIndex(0)} title="Restaurar sugestão automática"><RotateCcw size={14} /> Restaurar sugestão</Button>
          <Button size="sm" variant="secondary" onClick={handleExportPng} disabled={busy}><ImageIcon size={14} /> PNG</Button>
          <Button size="sm" variant="secondary" onClick={handlePrint} disabled={busy}><Printer size={14} /> Imprimir</Button>
          <Button size="sm" onClick={handleExportPdf} disabled={busy}><FileText size={14} /> PDF</Button>
        </div>
      </div>

      {viewMode === 'detail' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div ref={diagramRef}>
            <PalletDiagram pallet={result.pallet} pattern={activeAlt.pattern} />
          </div>
          <Panel>
            <PanelSection padding="md">
              {result.alternatives.length > 1 && (
                <div className="mb-4">
                  <SegmentedControl
                    label="Alternativa"
                    value={result.alternatives[selectedAltIndex] ? String(selectedAltIndex) : '0'}
                    onChange={v => setSelectedAltIndex(Number(v))}
                    options={result.alternatives.slice(0, 6).map((a, i) => ({ value: String(i), label: `${a.pattern.label}${a.requiresTipping ? ' (tombada)' : ''}` }))}
                  />
                </div>
              )}
              <PalletResultCards alt={activeAlt} />
            </PanelSection>
          </Panel>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {compareList.map((alt, i) => (
            <Panel key={alt.pattern.id + (alt.requiresTipping ? '-t' : '')}>
              <PanelSection padding="sm">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-fg">{alt.pattern.label}{alt.requiresTipping ? ' (tombada)' : ''}</h3>
                  <Button size="sm" variant="ghost" onClick={() => { setSelectedAltIndex(i); setViewMode('detail'); }}>Usar esta</Button>
                </div>
                <PalletDiagram pallet={result.pallet} pattern={alt.pattern} showNumbers={false} />
                <div className="mt-3">
                  <PalletResultCards alt={alt} />
                </div>
              </PanelSection>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
