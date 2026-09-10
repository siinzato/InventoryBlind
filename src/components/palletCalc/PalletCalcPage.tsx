/**
 * PalletCalcPage — Calculadora de Paletização
 *
 * Ferramenta separada em Ferramentas, mesmo repositório/frontend — sem
 * Supabase, sem cadastro prévio, preferências próprias em localStorage
 * (mesmo padrão de BarcodeLabPage/PdfCenterPage). Todo processamento é
 * local: motor 2D determinístico + camadas/peso, tudo puro e testado em
 * src/lib/palletCalc/.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Boxes, GitCompareArrows, Layers } from 'lucide-react';
import { PalletCalcWorkspace } from './PalletCalcWorkspace';
import { PalletBatchPage } from './PalletBatchPage';
import { loadPalletCalcPrefs, savePalletCalcPrefs, type PalletCalcPrefs } from '../../lib/palletCalc/palletCalcPrefs';
import { ToastStack, useToasts } from '../ui';

type Mode = 'home' | 'unit' | 'compare' | 'batch';

interface PalletCalcPageProps {
  onBack: () => void;
}

export function PalletCalcPage({ onBack }: PalletCalcPageProps) {
  const [mode, setMode] = useState<Mode>('home');
  const { toasts, toast } = useToasts();
  const [prefs, setPrefs] = useState<PalletCalcPrefs>({});

  useEffect(() => {
    const saved = loadPalletCalcPrefs();
    if (saved) setPrefs(saved);
  }, []);

  const handlePrefsChange = useCallback((patch: Partial<PalletCalcPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      savePalletCalcPrefs(next);
      return next;
    });
  }, []);

  if (mode === 'batch') {
    return <PalletBatchPage onBack={() => setMode('home')} toast={toast} customPallets={prefs.customPallets ?? []} />;
  }

  return (
    <div className="min-h-screen bg-surface-3">
      <ToastStack toasts={toasts} />

      <div className="sticky top-0 z-50 bg-surface border-b border-edge">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={mode === 'home' ? onBack : () => setMode('home')} className="flex items-center gap-2 px-3 py-2 text-fg-muted hover:text-fg hover:bg-surface-3 rounded-lg transition text-sm font-medium">
              <ArrowLeft size={16} /><span className="hidden sm:inline">{mode === 'home' ? 'Voltar' : 'Início'}</span>
            </button>
            <div className="flex items-center gap-2">
              <Boxes size={22} className="text-accent" />
              <div>
                <h1 className="text-title leading-tight">Calculadora de Paletização</h1>
                <p className="text-xs text-fg-subtle hidden sm:block">Arranjo 2D, camadas, peso e paletes — cálculo local, sem enviar dados</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {mode === 'home' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button onClick={() => setMode('unit')} className="flex flex-col items-start gap-2 rounded-container border border-edge bg-surface-2 p-5 text-left transition-colors hover:border-accent/50 hover:bg-surface-3">
              <Boxes size={22} className="text-accent" />
              <span className="text-sm font-semibold text-fg">Cálculo unitário</span>
              <span className="text-xs text-fg-subtle">Uma caixa, um palete — resultado detalhado com desenho 2D</span>
            </button>
            <button onClick={() => setMode('compare')} className="flex flex-col items-start gap-2 rounded-container border border-edge bg-surface-2 p-5 text-left transition-colors hover:border-accent/50 hover:bg-surface-3">
              <GitCompareArrows size={22} className="text-accent" />
              <span className="text-sm font-semibold text-fg">Comparação de arranjos</span>
              <span className="text-xs text-fg-subtle">Veja até 3 alternativas lado a lado antes de escolher</span>
            </button>
            <button onClick={() => setMode('batch')} className="flex flex-col items-start gap-2 rounded-container border border-edge bg-surface-2 p-5 text-left transition-colors hover:border-accent/50 hover:bg-surface-3">
              <Layers size={22} className="text-accent" />
              <span className="text-sm font-semibold text-fg">Processamento em lote</span>
              <span className="text-xs text-fg-subtle">CSV, XLS ou XLSX — cada SKU calculado separadamente</span>
            </button>
          </div>
        )}

        {(mode === 'unit' || mode === 'compare') && (
          <PalletCalcWorkspace initialViewMode={mode === 'compare' ? 'compare' : 'detail'} prefs={prefs} onPrefsChange={handlePrefsChange} toast={toast} />
        )}
      </div>
    </div>
  );
}
