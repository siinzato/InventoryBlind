import { useMemo, useState } from 'react';
import { ClipboardList, Upload } from 'lucide-react';
import { PageHeader } from '../ui';
import { BrandData } from '../../lib/supabase';
import { ManualCountTab } from './ManualCountTab';
import { ImportCountTab } from './ImportCountTab';
import { CountSidePanel, LiveCountStats } from './CountSidePanel';
import { CountHistorySection } from './CountHistorySection';

interface CountManagementCenterProps {
  brandsData: BrandData[];
  companyId: string;
  onBrandsUpdated: (brands: BrandData[]) => void;
}

type Mode = 'manual' | 'import';

const EMPTY_STATS: LiveCountStats = { linha: '', totalSku: 0, contados: 0, divergencias: 0, acuracidade: null, active: false };

export function CountManagementCenter({ brandsData, companyId, onBrandsUpdated }: CountManagementCenterProps) {
  const [mode, setMode] = useState<Mode>('manual');
  const [liveStats, setLiveStats] = useState<LiveCountStats>(EMPTY_STATS);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [sidePanelResetKey, setSidePanelResetKey] = useState(0);

  const brandsById = useMemo(() => new Map(brandsData.map(b => [b.id, b.brand])), [brandsData]);

  const handleSaved = () => {
    setHistoryRefreshKey(k => k + 1);
    setSidePanelResetKey(k => k + 1);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
      <PageHeader title="Centro de Gestão da Contagem" description="Registre contagens manuais ou importe planilhas para auditar o estoque." />

      <div className="flex gap-2">
        <button
          onClick={() => setMode('manual')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'manual' ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'}`}
        >
          <ClipboardList size={16} /> Contagem Manual
        </button>
        <button
          onClick={() => setMode('import')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${mode === 'import' ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'}`}
        >
          <Upload size={16} /> Importar Contagem
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          {mode === 'manual' ? (
            <ManualCountTab
              brandsData={brandsData}
              companyId={companyId}
              onBrandsUpdated={onBrandsUpdated}
              onSaved={handleSaved}
              onStatsChange={setLiveStats}
            />
          ) : (
            <ImportCountTab
              brandsData={brandsData}
              companyId={companyId}
              onBrandsUpdated={onBrandsUpdated}
              onSaved={handleSaved}
              onStatsChange={setLiveStats}
            />
          )}
        </div>
        <div className="lg:col-span-1">
          <CountSidePanel stats={liveStats} resetKey={sidePanelResetKey} />
        </div>
      </div>

      <CountHistorySection companyId={companyId} brandsById={brandsById} refreshKey={historyRefreshKey} />
    </div>
  );
}
