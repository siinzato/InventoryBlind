import { useMemo, useState } from 'react';
import { ClipboardList, Upload, Tablet, Repeat2 } from 'lucide-react';
import { Page, PageHeader, SegmentedControl, type SegmentedOption } from '../ui';
import { BrandData } from '../../lib/supabase';
import { ManualCountTab } from './ManualCountTab';
import { ImportCountTab } from './ImportCountTab';
import { PhysicalCountSessionsTab } from './PhysicalCountSessionsTab';
import { CountSidePanel, LiveCountStats } from './CountSidePanel';
import { CountHistorySection } from './CountHistorySection';
import { AutoRecountSettingsTab } from './AutoRecountSettingsTab';
import { useAuth } from '../../lib/auth';
import { hasPermission } from '../../lib/permissionService';

interface CountManagementCenterProps {
  brandsData: BrandData[];
  companyId: string;
  onBrandsUpdated: (brands: BrandData[]) => void;
}

type Mode = 'manual' | 'import' | 'physical' | 'auto-recount';

const MODES: SegmentedOption<Mode>[] = [
  { value: 'manual', label: 'Contagem Manual', icon: ClipboardList },
  { value: 'import', label: 'Importar Contagem', icon: Upload },
  { value: 'physical', label: 'Contagem Física Digital', icon: Tablet },
  // Aba própria: quem não usa recontagem automática não encontra nada diferente
  // nas outras abas, e a configuração nasce desligada.
  { value: 'auto-recount', label: 'Recontagem Automática', icon: Repeat2 },
];

const EMPTY_STATS: LiveCountStats = { linha: '', totalSku: 0, contados: 0, divergencias: 0, acuracidade: null, active: false };

export function CountManagementCenter({ brandsData, companyId, onBrandsUpdated }: CountManagementCenterProps) {
  const { profile } = useAuth();
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
    <Page>
      <PageHeader title="Centro de Gestão da Contagem" description="Registre contagens manuais ou importe planilhas para auditar o estoque." />

      <SegmentedControl
        label="Modo de contagem"
        options={MODES}
        value={mode}
        onChange={setMode}
      />

      {mode === 'auto-recount' ? (
        // 'counting.approve' é detida por exatamente owner/admin/manager, a mesma
        // lista que a policy de escrita da 049 exige — a UI não oferece um botão
        // que o banco recusaria. 'Ciente' é mais permissivo por decisão da policy
        // (inclui lead), então tem gate próprio.
        <AutoRecountSettingsTab
          canManage={hasPermission(profile?.role, 'counting.approve')}
          canAcknowledge={hasPermission(profile?.role, 'counting.approve') || profile?.role === 'lead'}
        />
      ) : mode === 'physical' ? (
        <PhysicalCountSessionsTab companyId={companyId} />
      ) : (
        <>
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
        </>
      )}
    </Page>
  );
}
