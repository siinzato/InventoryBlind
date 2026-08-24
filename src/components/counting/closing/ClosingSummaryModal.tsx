import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, Settings2 } from 'lucide-react';
import { Modal, Button, Badge, Panel, PanelSection } from '../../ui';
import type { ClosingReport, ClosingReportObservation } from '../../../lib/closingReports/closingReportTypes';

interface ClosingSummaryModalProps {
  open: boolean;
  onClose: () => void;
  brandName: string;
  report: ClosingReport | null;
  observations: ClosingReportObservation[];
  reprocessing: boolean;
  onReprocess: () => void;
  onManageCategories: () => void;
}

/** Resumo de fechamento de uma linha/marca — só leitura de dados já gerados (ver closingReportService.ts). */
export function ClosingSummaryModal({
  open, onClose, brandName, report, observations, reprocessing, onReprocess, onManageCategories,
}: ClosingSummaryModalProps) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showUnclassified, setShowUnclassified] = useState(false);

  if (!report) return null;

  const unclassified = observations.filter(o => o.isUnclassified);
  const observationsByCategory = (categoryId: string) => observations.filter(o => o.matchedCategoryIds.includes(categoryId));

  return (
    <Modal open={open} onClose={onClose} title={`Resumo de fechamento — ${brandName}`} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="p-3 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg flex items-start gap-2 text-sm">
          <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
          <span>Linha concluída — pendentes chegaram a zero.</span>
        </div>

        <Panel>
          <PanelSection padding="md" className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Stat label="SKUs contados" value={report.skusContados} />
            <Stat label="Divergências encontradas" value={report.divergenciasEncontradas} />
            <Stat label="Divergências recontadas" value={report.divergenciasRecontadas} />
            <Stat label="Divergências reais" value={report.divergenciasReais} />
            <Stat label="Acuracidade inicial" value={report.accuracyInitial !== null ? `${report.accuracyInitial.toFixed(1)}%` : '—'} />
            <Stat label="Acuracidade final" value={report.accuracyFinal !== null ? `${report.accuracyFinal.toFixed(1)}%` : '—'} />
          </PanelSection>
        </Panel>

        <div>
          <p className="text-xs font-semibold text-fg-subtle uppercase tracking-wide mb-2">Categorias identificadas</p>
          {report.categoryCounts.length === 0 && unclassified.length === 0 && (
            <p className="text-sm text-fg-subtle">Nenhuma observação registrada nas contagens deste ciclo.</p>
          )}
          <div className="space-y-1.5">
            {report.categoryCounts.map(c => {
              const isOpen = expandedCategory === c.categoryId;
              const items = observationsByCategory(c.categoryId);
              return (
                <div key={c.categoryId} className="rounded-lg border border-edge">
                  <button
                    type="button"
                    onClick={() => setExpandedCategory(isOpen ? null : c.categoryId)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="text-sm text-fg">{c.name}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="accent">{c.count} registro{c.count === 1 ? '' : 's'}</Badge>
                      {isOpen ? <ChevronDown size={14} className="text-fg-subtle" /> : <ChevronRight size={14} className="text-fg-subtle" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-2.5 space-y-1.5 border-t border-edge/60 pt-2">
                      {items.map(o => (
                        <p key={o.id} className="text-xs text-fg-muted italic">"{o.observationText}"</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {unclassified.length > 0 && (
          <div className="rounded-lg border border-edge">
            <button
              type="button"
              onClick={() => setShowUnclassified(s => !s)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
            >
              <span className="text-sm text-fg">Observações não classificadas</span>
              <span className="flex items-center gap-2">
                <Badge variant="neutral">{unclassified.length}</Badge>
                {showUnclassified ? <ChevronDown size={14} className="text-fg-subtle" /> : <ChevronRight size={14} className="text-fg-subtle" />}
              </span>
            </button>
            {showUnclassified && (
              <div className="px-3 pb-2.5 space-y-1.5 border-t border-edge/60 pt-2">
                {unclassified.map(o => (
                  <p key={o.id} className="text-xs text-fg-muted italic">"{o.observationText}"</p>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-fg-subtle whitespace-pre-line border-t border-edge pt-3">{report.summaryText}</p>

        <div className="flex flex-wrap gap-3 pt-1">
          <Button variant="secondary" size="sm" onClick={onManageCategories}>
            <Settings2 size={14} /> Gerenciar categorias
          </Button>
          <Button variant="secondary" size="sm" onClick={onReprocess} disabled={reprocessing}>
            <RefreshCw size={14} className={reprocessing ? 'animate-spin' : ''} /> {reprocessing ? 'Reprocessando...' : 'Reprocessar resumo'}
          </Button>
          <Button size="sm" onClick={onClose} className="ml-auto">Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-base font-semibold text-fg">{value}</p>
    </div>
  );
}
