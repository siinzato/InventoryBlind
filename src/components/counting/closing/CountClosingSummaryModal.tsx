// Resumo de fechamento dentro do FLUXO DE CONTAGEM (contagem manual, importada e
// histórico de contagens). É o mesmo modal de leitura, mais as duas ações que só fazem
// sentido logo depois de contar: reprocessar o resumo e ajustar as categorias.
//
// Elas vivem aqui, e não no ClosingSummaryModal, porque a visualização histórica de
// "Resultados por Linha" é estritamente read-only — abrir um fechamento já gravado não
// pode oferecer regeneração. Nenhuma funcionalidade do fluxo de contagem foi removida.

import { RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '../../ui';
import { ClosingSummaryModal } from './ClosingSummaryModal';
import type { ClosingReport, ClosingReportObservation } from '../../../lib/closingReports/closingReportTypes';

interface CountClosingSummaryModalProps {
  open: boolean;
  onClose: () => void;
  brandName: string;
  report: ClosingReport | null;
  observations: ClosingReportObservation[];
  reprocessing: boolean;
  onReprocess: () => void;
  onManageCategories: () => void;
}

export function CountClosingSummaryModal({
  open, onClose, brandName, report, observations, reprocessing, onReprocess, onManageCategories,
}: CountClosingSummaryModalProps) {
  return (
    <ClosingSummaryModal
      open={open}
      onClose={onClose}
      brandName={brandName}
      report={report}
      observations={observations}
      footerActions={
        <>
          <Button variant="secondary" size="sm" onClick={onManageCategories}>
            <Settings2 size={14} /> Gerenciar categorias
          </Button>
          <Button variant="secondary" size="sm" onClick={onReprocess} disabled={reprocessing}>
            <RefreshCw size={14} className={reprocessing ? 'animate-spin' : ''} /> {reprocessing ? 'Reprocessando...' : 'Reprocessar resumo'}
          </Button>
        </>
      }
    />
  );
}

export default CountClosingSummaryModal;
