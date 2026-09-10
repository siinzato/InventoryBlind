import { AlertTriangle, XCircle } from 'lucide-react';
import { Stat, StatRow, StatCell } from '../ui';
import type { PalletCalcAlternative } from '../../lib/palletCalc/calculatePallet';

interface PalletResultCardsProps {
  alt: PalletCalcAlternative;
}

export function PalletResultCards({ alt }: PalletResultCardsProps) {
  return (
    <div className="space-y-4">
      <StatRow>
        <StatCell><Stat label="Caixas/camada" value={String(alt.pattern.boxesPerLayer)} /></StatCell>
        <StatCell><Stat label="Camadas" value={String(alt.layers.layers)} context={alt.layers.limitingFactor !== 'nenhum' ? `limitado por ${alt.layers.limitingFactor}` : undefined} /></StatCell>
        <StatCell><Stat label="Caixas/palete" value={String(alt.capacityPerPallet)} /></StatCell>
        <StatCell><Stat label="Total de paletes" value={String(alt.palletsNeeded.totalPallets)} /></StatCell>
      </StatRow>
      <StatRow>
        <StatCell><Stat label="Último palete" value={`${alt.palletsNeeded.lastPalletQty} caixas`} /></StatCell>
        <StatCell><Stat label="Ocupação da base" value={`${alt.pattern.occupationPct.toFixed(0)}%`} valueTone={alt.pattern.occupationPct < 70 ? 'warning' : 'default'} /></StatCell>
        <StatCell><Stat label="Altura total" value={`${alt.totalHeightMm.toFixed(0)} mm`} /></StatCell>
        <StatCell><Stat label="Peso bruto" value={`${alt.grossKg.toFixed(1)} kg`} /></StatCell>
      </StatRow>

      {alt.alerts.length > 0 && (
        <div className="space-y-1.5">
          {alt.alerts.map(a => (
            <div key={a.code} className={`flex items-start gap-2 rounded-container border p-2.5 text-xs ${
              a.severity === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
              {a.severity === 'error' ? <XCircle size={14} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-fg-subtle italic">Resultado geométrico estimado. Valide resistência das caixas, amarração e condições reais de transporte.</p>
    </div>
  );
}
